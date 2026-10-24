#!/usr/bin/env node
// camera-motivation A5: the motivation controls. A story beat is added from
// the Motivation panel at the playhead; a push-in laid on the Dialogue shot
// (cclay live run camera.applyTechnique) starts off it, so the timeline flags
// the move and the panel reads the flag out with its fix; Apply fix runs
// camera.alignMove and the move then starts on the beat, in the live document
// and in camera.checkMotivation over the hub (cclay live run). Runs in
// tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on the dev server's hub;
// QA_SHOT_DIR keeps the shots.
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
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders the two fixture shots", await waitFor("!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
expect("the rigs load", await waitFor("!!window.__cozyclay?.rigA && !!window.__cozyclay?.shotCam", 60000));
await clickBlock(0);
expect("Camera mode shows the Motivation panel", await waitFor("!!document.querySelector('[data-motivation-panel]')"));
const dialogue = liveShots()[0];

// 1. A story beat at frame 60, from the panel.
console.log(`  $ cclay live run timeline.seek: ${live("run", "timeline.seek", "--args", JSON.stringify({ frame: 60 })).summary}`);
expect("the panel adds at the playhead", await waitFor("/Beat at 60/.test(document.querySelector('[data-motivation-panel]')?.textContent ?? '')"), await text("[data-motivation-panel]"));
await setValue("[data-story-beat-label]", "Mara makes her admission");
await setValue("[data-story-beat-kind]", "disclosure");
await pause(200);
await click("[data-story-beat-add]");
expect("story.addBeat answers in the panel", await waitFor("/Story beat disclosure \"Mara makes her admission\" at f60/.test(document.querySelector('[data-motivation-status]')?.textContent ?? '')"), await text("[data-motivation-status]"));
expect("the timeline draws the beat", await waitFor("document.querySelector('[data-story-beat]')?.dataset.storyBeat === '60'"));

// 2. A push-in laid over the whole shot starts before the beat: flagged on the timeline and read out.
const pushed = live("run", "camera.applyTechnique", "--args", JSON.stringify({ shotId: dialogue.id, subjectId: "char-mara", stack: ["medium-shot", "push-in"] }));
console.log(`  $ cclay live run camera.applyTechnique (push-in): ${pushed.summary}`);
expect("the timeline flags the push as starting off the beat", await waitFor("document.querySelector('[data-motivation-flag]')?.dataset.motivationRule === 'starts-off-beat'"),
	await evaluate("[...document.querySelectorAll('[data-motivation-flag]')].map((el) => el.dataset.motivationFlag + ':' + el.dataset.motivationRule).join(',')"));
expect("the panel reads the flag out with its fix", await waitFor("!!document.querySelector('[data-motivation-issue=\"starts-off-beat\"] [data-motivation-fix]')"), await text("[data-motivation-readout]"));
const readout = await text("[data-motivation-issue='starts-off-beat']");
console.log(`  readout: ${readout}`);
expect("the readout names the beat and the fix", /'Mara makes her admission' \(f60\)/.test(readout) && /Fix: start the push at f60 on 'Mara makes her admission'\./.test(readout), readout);
const before = live("run", "camera.checkMotivation", "--args", "{}");
console.log(`  $ cclay live run camera.checkMotivation: ${before.summary}`);
expect("camera.checkMotivation agrees over the hub", before.checks?.issues === 1 && before.output?.shots?.[0]?.moves?.[0]?.issues?.[0]?.rule === "starts-off-beat", JSON.stringify(before).slice(0, 400));
await evaluate("window.__cozyclay.scrub?.(60)");
await shoot("timeline-flagged-move.png", "[data-motivation-panel]");

// 3. Apply fix: camera.alignMove starts the push on the beat.
await click("[data-motivation-fix]");
expect("Apply fix answers with the retime and a clean re-check", await waitFor("/^Started the move .* on 'Mara makes her admission' at f60: .*re-check clean\\./.test(document.querySelector('[data-motivation-status]')?.textContent ?? '')"), await text("[data-motivation-status]"));
console.log(`  ${await text("[data-motivation-status]")}`);
expect("the flag is gone from the timeline and the panel", await waitFor("document.querySelectorAll('[data-motivation-flag]').length === 0 && document.querySelector('[data-motivation-summary]')?.dataset.motivationSummary === '0'"));
const fixed = liveShots()[0];
expect("the live document's push now starts on the beat", fixed.cameraKeys[0]?.frame === 60 || (fixed.cameraKeys.find((key) => key.frame >= 60)?.frame === 60), JSON.stringify(fixed.cameraKeys.map((key) => key.frame)));
const after = live("run", "camera.checkMotivation", "--args", "{}");
console.log(`  $ cclay live run camera.checkMotivation: ${after.summary}`);
expect("the re-check over the hub is clean", after.checks?.issues === 0, JSON.stringify(after).slice(0, 400));
await shoot("timeline-fixed-move.png", "[data-motivation-panel]");
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera motivation browser QA passed");
