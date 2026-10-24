#!/usr/bin/env node
// A7 (and A6 page shots): the coverage controls in Camera mode. The Coverage
// panel lays a shot-reverse-shot over the selected shot (camera.cover); the
// technique popover's composition fields put the subject on the left third
// (with the Thirds guide on); the Cut inspector sets a dissolve; a reverse
// re-laid on the wrong side of the line is flagged on the timeline and read
// out in the inspector. Every step is checked in the live document over the
// hub (`cclay live describe`). Runs in tools/qa-browser.mjs with
// COZYCLAY_LIVE_PORT on the dev server's hub; QA_SHOT_DIR keeps the shots.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterPageLoad } from "./bus/browser-navigation.mjs";
import { waitForFrameState } from "./bus/browser-frame-state.mjs";
import { SCENES_STORAGE_KEY } from "../src/scenes.js";

const port = Number(process.env.CDP_PORT || 9222);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
if (!page) throw new Error("no page target on the QA browser");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (!message.id || !pending.has(message.id)) return;
	const { resolve, reject } = pending.get(message.id);
	pending.delete(message.id);
	if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
};
const send = (method, params = {}) => afterPageLoad(ws, method, () => new Promise((resolve, reject) => {
	const id = nextId++;
	pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
}));
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
	return result.result.value;
};
const waitFor = (expression, timeoutMs = 15000) => waitForFrameState(evaluate, expression, timeoutMs);
let failures = 0;
const expect = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setValue = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
	if (el.type === "checkbox") { if (el.checked !== ${JSON.stringify(value)}) el.click(); return true; }
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(String(value))});
	el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const clickBlock = (index) => evaluate(`(() => { const el = document.querySelectorAll('.tl-shot-block')[${index}]; if (!el) return false; el.click(); return true; })()`);
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
// One `cclay live` call; with a stale editor still on the hub, the fixture project's workspace is named explicitly.
let workspace = null;
const live = (...args) => {
	try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args, ...(workspace ? ["--workspace", workspace] : [])], { encoding: "utf8", env: process.env })); }
	catch (error) {
		const answer = JSON.parse(error.stdout || "{}"), mine = answer.error?.details?.candidates?.find((row) => row.project === "Camera Coverage");
		if (!workspace && mine) { workspace = mine.handle; return live(...args); }
		throw error;
	}
};
function liveShots() {
	const doc = live("describe"), found = new Map();
	JSON.stringify(doc, (key, value) => { if (value && typeof value === "object" && typeof value.id === "string" && Array.isArray(value.cameraKeys)) found.set(value.id, value); return value; });
	return [...found.values()].sort((a, b) => a.startFrame - b.startFrame);
}
async function shoot(file, selector = null) {
	if (!process.env.QA_SHOT_DIR) return;
	if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
	await pause(1200);
	const capture = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(process.env.QA_SHOT_DIR, file), Buffer.from(capture.data, "base64"));
	console.log(`saved ${file}`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-coverage.cclayproject", import.meta.url), "utf8"));
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en"); localStorage.setItem("cozyclay.shot-guides.v1", "thirds");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders the two fixture shots", await waitFor("!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
expect("the rigs load", await waitFor("!!window.__cozyclay?.rigA && !!window.__cozyclay?.shotCam", 30000));
await clickBlock(0);
expect("Camera mode shows the Coverage panel", await waitFor("!!document.querySelector('[data-coverage-action]')"));

// 1. Coverage: shot-reverse-shot over the Dialogue shot.
await setValue("[data-coverage-pattern]", "shot-reverse-shot");
await setValue("[data-coverage-cast='a']", "char-mara");
await setValue("[data-coverage-cast='b']", "char-joon");
await setValue("[data-coverage-shots]", 4);
await pause(200);
await click("[data-coverage-lay]");
expect("the Coverage action lays the pattern", await waitFor("/Laid Shot-Reverse-Shot over 0-191/.test(document.querySelector('[data-coverage-status]')?.textContent ?? '')"), await text("[data-coverage-status]"));
console.log(`  ${await text("[data-coverage-status]")}`);
expect("the timeline shows five shot blocks (four SRS and Exchange)", await waitFor("document.querySelectorAll('.tl-shot-block').length === 5"));
let shots = liveShots();
expect("the live document holds the four SRS shots with their coverage record", shots.filter((row) => row.coverage?.pattern === "shot-reverse-shot").map((row) => `${row.name}:${row.coverage.subjectId}`).join("|")
	=== "SRS 1 · OTS Mara:char-mara|SRS 2 · OTS Joon:char-joon|SRS 3 · OTS Mara:char-mara|SRS 4 · OTS Joon:char-joon", JSON.stringify(shots.map((row) => [row.name, row.coverage])));
await clickBlock(4);
await pause(400);
await setValue("[data-coverage-pattern]", "master-coverage");
await pause(200);
await click("[data-coverage-lay]");
expect("master and coverage is laid over the Exchange shot", await waitFor("/Laid Master and Coverage over 192-431/.test(document.querySelector('[data-coverage-status]')?.textContent ?? '')"), await text("[data-coverage-status]"));
expect("the timeline shows nine shot blocks", await waitFor("document.querySelectorAll('.tl-shot-block').length === 9"));
expect("no cut is flagged after laying the patterns", await waitFor("document.querySelectorAll('[data-cut-flag]').length === 0") && (await text("[data-cut-summary]")).includes("0 flagged"), await text("[data-cut-summary]"));
await shoot("coverage-controls.png", "[data-coverage-action]");

// 2. Composition in the technique popover: SRS 1 on the left third.
await clickBlock(0);
await pause(400);
await click("[data-technique-id='over-the-shoulder']");
expect("the technique popover opens on OTS", await waitFor("document.querySelector('[data-technique-detail]')?.dataset.techniqueDetail === 'over-the-shoulder'"));
await setValue("[data-composition-on]", true);
await waitFor("!!document.querySelector('[data-composition=place]')");
await setValue("[data-composition='place']", "left-third");
await pause(300);
await setValue("[data-composition='leadRoom']", "none");
expect("the composition fields re-apply the stack", await waitFor("document.querySelector('[data-technique-composition]')?.dataset.techniqueComposition === 'left-third/normal/none'"), await evaluate("document.querySelector('[data-technique-composition]')?.dataset.techniqueComposition"));
shots = liveShots();
const first = shots[0];
expect("SRS 1 stores the composition with its stack", first.technique?.composition?.place === "left-third" && first.technique.stack[0].id === "over-the-shoulder", JSON.stringify(first.technique));
const placed = await text("[data-technique-status]");
console.log(`  ${placed}`);
expect("the receipt says the stack was applied", /^Applied OTS/.test(placed), placed);
await evaluate("window.__cozyclay.scrub?.(20)");
await shoot("rule-of-thirds.png", "[data-technique-composition]");

// 3. The Cut inspector: a dissolve into SRS 2.
await clickBlock(1);
expect("the Cut inspector shows the cut into SRS 2", await waitFor("document.querySelector('[data-cut-inspector]')?.dataset.cutInspector === '48'"), await evaluate("document.querySelector('[data-cut-inspector]')?.dataset.cutInspector"));
await setValue("[data-cut-transition-type]", "dissolve");
expect("the dissolve is set", await waitFor("/12-frame dissolve/.test(document.querySelector('[data-cut-status]')?.textContent ?? '')"), await text("[data-cut-status]"));
await setValue("[data-cut-transition-frames]", 16);
await pause(500);
shots = liveShots();
expect("SRS 2 stores a 16-frame dissolve", JSON.stringify(shots[1].transition) === JSON.stringify({ type: "dissolve", frames: 16 }), JSON.stringify(shots[1].transition));
expect("the timeline tags the cut DISS", await waitFor("document.querySelector('[data-cut-flag=\"48\"] [data-cut-transition]')?.dataset.cutTransition === 'dissolve'"));

// 4. A reverse re-laid on the far side of the line is flagged.
const third = shots[2], side = third.technique?.side === "left" ? "right" : "left";
const crossed = live("run", "camera.applyTechnique", "--args", JSON.stringify({ shotId: third.id, subjectId: "char-mara", stack: ["over-the-shoulder"], side }));
console.log(`  $ cclay live run camera.applyTechnique (side ${side}): ${crossed.summary}`);
expect("the timeline flags the cut into SRS 3 as a line crossing", await waitFor(`/line/.test(document.querySelector('[data-cut-flag="${third.startFrame}"]')?.dataset.cutRules ?? '')`), await evaluate("[...document.querySelectorAll('[data-cut-flag]')].map((el) => el.dataset.cutFlag + ':' + el.dataset.cutRules).join(',')"));
const checked = live("run", "camera.checkCuts", "--args", JSON.stringify({ frame: third.startFrame }));
expect("camera.checkCuts agrees over the hub", checked.output?.cuts?.[0]?.issues?.some((issue) => issue.rule === "line"), JSON.stringify(checked).slice(0, 300));
await clickBlock(2);
expect("the Cut inspector reads the crossing out with its fix", await waitFor("!!document.querySelector('[data-cut-issue=\"line\"]')"), await text("[data-cut-inspector]"));
console.log(`  readout: ${await text("[data-cut-rules-readout]")}`);
await evaluate(`window.__cozyclay.scrub?.(${third.startFrame})`);
await shoot("timeline-flagged-cut.png", "[data-cut-inspector]");
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera coverage browser QA passed");
