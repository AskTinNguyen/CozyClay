#!/usr/bin/env node
// colour-script A7 (and the A3 shot): a shot look set over the hub (cclay live
// run shot.setLook) is in the document and its capture measures warmer
// (shot.colourScript renders each shot's middle frame through the export path
// and measures it), while the other shot's capture is unchanged. The Look
// section in Camera mode shows the recipe and the measured swatches, and a
// recipe picked there applies and re-measures. Then a warm-to-cold sequence
// (master and coverage) in File > Export > Colour script, shot for review.
// Runs in tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on the dev server's hub;
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
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const clickBlock = (index) => evaluate(`(() => { const el = document.querySelectorAll('.tl-shot-block')[${index}]; if (!el) return false; el.click(); return true; })()`);
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
// One `cclay live` call. A reload leaves the old editor on the hub for a while, so a handle that times out is set aside and the next candidate tried.
let workspace = null, tries = 0;
const stale = new Set();
const live = (...args) => {
	try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args, ...(workspace ? ["--workspace", workspace] : [])], { encoding: "utf8", env: process.env })); }
	catch (error) {
		const answer = JSON.parse(error.stdout || "{}");
		if (workspace && answer.error?.code === "TIMEOUT" && stale.size < 4) { stale.add(workspace); workspace = null; return live(...args); }
		const mine = answer.error?.details?.candidates?.find((row) => row.project === "Camera Coverage" && !stale.has(row.handle));
		if (!workspace && mine) { workspace = mine.handle; return live(...args); }
		// A fresh editor's first attach can time out once under load: wait and ask again.
		if (tries++ < 3) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); return live(...args); }
		throw error;
	}
};
async function shoot(file, selector) {
	if (!process.env.QA_SHOT_DIR) return;
	await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
	await pause(1200);
	const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
	const capture = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
	writeFileSync(join(process.env.QA_SHOT_DIR, file), Buffer.from(capture.data, "base64"));
	console.log(`saved ${file}`);
}
const choose = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
	Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value; })()`);
const script = () => live("run", "shot.colourScript", "--args", "{}");

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-coverage.cclayproject", import.meta.url), "utf8"));
async function open() {
	if (workspace) { stale.add(workspace); workspace = null; }
	await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
	await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
		localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
		localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
	await send("Page.navigate", { url: studioUrl });
	expect("studio renders the two fixture shots", await waitFor("!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
	expect("the rigs load", await waitFor("!!window.__cozyclay?.rigA && !!window.__cozyclay?.shotCam", 60000));
}
await open();

// 1. One shot gets a look over the hub; the document holds it and its capture measures warmer.
const plain = script();
console.log(`  $ cclay live run shot.colourScript: ${plain.summary}`);
expect("the colour script measures both stage-look shots", plain.ok && plain.output.measured && plain.output.shots.length === 2 && plain.output.shots.every((row) => row.measured?.swatches.length), JSON.stringify(plain).slice(0, 400));
const set = live("run", "shot.setLook", "--args", JSON.stringify({ shotId: "shot-dialogue", recipe: "warm-safety" }));
console.log(`  $ cclay live run shot.setLook: ${set.summary}`);
expect("shot.setLook applies over the hub", set.ok && /^Look on Dialogue/.test(set.summary), JSON.stringify(set).slice(0, 300));
const warm = script(), [dialogue, exchange] = warm.output.shots;
expect("the document holds the look on that shot only", dialogue.look?.recipe === "warm-safety" && dialogue.look.preset === "interior" && !exchange.look, JSON.stringify(warm.output.shots.map((row) => row.look)));
console.log(`  measured warmth: Dialogue ${plain.output.shots[0].measured.warmth} -> ${dialogue.measured.warmth}; Exchange ${plain.output.shots[1].measured.warmth} -> ${exchange.measured.warmth}`);
expect("the look's capture measures warmer than before and than the stage-look shot", dialogue.measured.warmth > plain.output.shots[0].measured.warmth + 0.03 && dialogue.measured.warmth > exchange.measured.warmth + 0.03,
	`${plain.output.shots[0].measured.warmth} -> ${dialogue.measured.warmth} vs ${exchange.measured.warmth}`);
expect("the other shot's capture is unchanged", Math.abs(exchange.measured.warmth - plain.output.shots[1].measured.warmth) < 0.005, `${plain.output.shots[1].measured.warmth} -> ${exchange.measured.warmth}`);

// 2. The Look section in Camera mode: the recipe, the measured swatches, a recipe picked in the panel.
await clickBlock(0);
expect("Camera mode shows the Look section for the shot", await waitFor("document.querySelector('[data-look-panel]')?.dataset.lookPanel === 'shot-dialogue' && document.querySelector('[data-look-panel]')?.dataset.lookRecipe === 'warm-safety'"), await text("[data-look-panel]"));
expect("it shows the measured swatches", await waitFor("Number(document.querySelector('[data-look-measured]')?.dataset.lookMeasured) > 0", 20000));
console.log(`  panel: ${await text("[data-look-words]")} · measured warmth ${await evaluate("document.querySelector('[data-look-measured]')?.dataset.lookWarmth")}`);
await shoot("look-panel-warm-safety.png", "[data-look-panel]");
await choose("[data-look-recipe-select]", "cold-isolation");
expect("a recipe picked in the panel runs shot.setLook", await waitFor("document.querySelector('[data-look-panel]')?.dataset.lookRecipe === 'cold-isolation'"), await text("[data-look-status]"));
const picked = script().output.shots[0];
expect("the document has the panel's recipe and the capture turns cold", picked.look?.recipe === "cold-isolation" && picked.measured.warmth < dialogue.measured.warmth - 0.05, `${picked.look?.recipe} ${picked.measured.warmth}`);
expect("the panel re-measures it", await waitFor(`Number(document.querySelector('[data-look-measured]')?.dataset.lookWarmth) < ${dialogue.measured.warmth - 0.05}`, 20000), `panel warmth ${await evaluate("document.querySelector('[data-look-measured]')?.dataset.lookWarmth")}, document ${picked.measured.warmth}, status ${await text("[data-look-status]")}`);

// 3. A warm-to-cold sequence: master and coverage, warm for the master and the first two, cold after, a beat; File > Export > Colour script.
await open();
const covered = live("run", "camera.cover", "--args", JSON.stringify({ pattern: "master-coverage", shotId: "shot-dialogue", cast: ["char-mara", "char-joon"] }));
console.log(`  $ cclay live run camera.cover master-coverage: ${covered.summary}`);
const ids = script().output.shots.map((row) => row.shotId);
for (const [i, recipe] of [[0, "warm-safety"], [1, "warm-safety"], [2, "tender-memory"], [3, "cold-isolation"], [4, "cold-isolation"], [5, "night-menace"]]) live("run", "shot.setLook", "--args", JSON.stringify({ shotId: ids[i], recipe }));
const shots = script().output.shots;
live("run", "story.addBeat", "--args", JSON.stringify({ frame: shots[3].frames[0] + 6, label: "the letter", kind: "reveal" }));
const read = script();
console.log(`  colour script: ${read.output.words}`);
expect("the warm-to-cold turn is a hard, measured colour cut", read.output.cuts.some((cut) => cut.kind === "hard" && cut.source === "measured" && cut.warmth < 0), JSON.stringify(read.output.cuts.map((cut) => [cut.kind, cut.warmth])));
await click("[data-testid=menu-file]");
await waitFor("!!document.querySelector('[data-testid=topbar-export]')", 5000);
await click("[data-testid=topbar-export]");
expect("Export lists Colour script", await waitFor("!!document.querySelector('[data-testid=export-colour-script]')", 5000));
await click("[data-testid=export-colour-script]");
expect("the dialog draws one column per shot", await waitFor(`document.querySelector('[data-testid=colour-script-dialog]')?.dataset.colourScript === '${ids.length}'`, 30000));
expect("it lists the hard cut", await waitFor("!!document.querySelector('[data-colour-cut=\"hard\"]')"));
const strip = await evaluate("(() => { const c = document.querySelector('[data-testid=colour-script-strip]'); return [c.width, c.height]; })()");
expect("the strip is 960 x 200", strip[0] === 960 && strip[1] === 200, JSON.stringify(strip));
await shoot("colour-script-warm-to-cold.png", "[data-testid=colour-script-dialog]");
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("colour script browser QA passed");
