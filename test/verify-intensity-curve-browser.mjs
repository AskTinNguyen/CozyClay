#!/usr/bin/env node
// intensity-curve A3: the intensity strip under the timeline's shot blocks.
// A shot-reverse-shot laid over the Dialogue shot (cclay live run camera.cover)
// holds one size and lens, so the strip flags it flat and camera.checkStructure
// agrees over the hub; a component toggle draws its line; Apply suggestion in
// the Structure panel runs the technique stack and the curve changes, the flag
// goes. Then master and coverage with a reveal on a close-up, shot for review.
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
const combined = () => evaluate("document.querySelector('[data-intensity-strip]')?.dataset.intensityCombined ?? ''");
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
async function shoot(file) {
	if (!process.env.QA_SHOT_DIR) return;
	await evaluate("document.querySelector('[data-intensity-strip]')?.scrollIntoView({ block: 'center' })");
	await pause(1200);
	// The timeline, at twice the pixels: the strip is what the shot is for.
	const box = await evaluate("(() => { const r = document.querySelector('.v2-sequencer').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()");
	const capture = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
	writeFileSync(join(process.env.QA_SHOT_DIR, file), Buffer.from(capture.data, "base64"));
	console.log(`saved ${file}`);
}

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
expect("the strip sits under the shot blocks", await waitFor("document.querySelector('[data-intensity-strip]')?.dataset.intensityStrip === '2'"));
const geometry = await evaluate(`(() => { const strip = document.querySelector('[data-intensity-strip]').getBoundingClientRect(), block = document.querySelector('.tl-shot-block').getBoundingClientRect();
	return { stripTop: strip.top, blockBottom: block.bottom, stripHeight: strip.height }; })()`);
expect("below the blocks, not over them", geometry.stripTop >= geometry.blockBottom && geometry.stripHeight > 20, JSON.stringify(geometry));

// 1. A flat sequence: shot-reverse-shot over the Dialogue shot, every OTS one size and lens.
const covered = live("run", "camera.cover", "--args", JSON.stringify({ pattern: "shot-reverse-shot", shotId: "shot-dialogue", cast: ["char-mara", "char-joon"] }));
console.log(`  $ cclay live run camera.cover: ${covered.summary}`);
expect("the strip flags the flat stretch", await waitFor("document.querySelector('[data-intensity-flag]')?.dataset.intensityFlag === 'flat'", 20000),
	await evaluate("[...document.querySelectorAll('[data-intensity-flag]')].map((el) => el.dataset.intensityFlag).join(',') + ' ' + document.querySelector('[data-intensity-strip]')?.dataset.intensityCombined"));
const flatTitle = await evaluate("document.querySelector('[data-intensity-flag=\"flat\"]')?.title ?? ''");
console.log(`  flag: ${flatTitle}`);
const asked = live("run", "camera.checkStructure", "--args", JSON.stringify({ request: "where does this sequence go flat?" }));
console.log(`  $ cclay live run camera.checkStructure: ${asked.summary}`);
expect("camera.checkStructure agrees over the hub", asked.ok && asked.output?.issues?.[0]?.rule === "flat" && asked.output?.resolved === "flat words" && asked.output.shots.length === 5, JSON.stringify(asked).slice(0, 400));
const before = await combined();
await click("[data-intensity-toggle='size']");
expect("a component toggle draws its line", await waitFor("!!document.querySelector('[data-intensity-series=\"size\"]') && document.querySelector('[data-intensity-toggle=\"size\"]').getAttribute('aria-pressed') === 'true'"));
await clickBlock(0);
expect("Camera mode shows the Structure panel with the flag and its suggestion", await waitFor("!!document.querySelector('[data-structure-issue=\"flat\"] [data-structure-apply]')"), await text("[data-structure-panel]"));
console.log(`  panel: ${await text("[data-structure-issue='flat']")}`);
await shoot("strip-flat.png");

// 2. Apply suggestion: the technique stack on the run's middle shot.
await click("[data-structure-apply]");
expect("the suggestion applies through camera.applyTechnique", await waitFor("/^Applied /.test(document.querySelector('[data-structure-status]')?.textContent ?? '')"), await text("[data-structure-status]"));
console.log(`  ${await text("[data-structure-status]")}`);
expect("the curve changes", await waitFor(`(document.querySelector('[data-intensity-strip]')?.dataset.intensityCombined ?? '') !== ${JSON.stringify(before)}`), `${before} -> ${await combined()}`);
console.log(`  curve: ${before} -> ${await combined()}`);
expect("the flat flag is gone", await waitFor("!document.querySelector('[data-intensity-flag=\"flat\"]')"));
const after = live("run", "camera.checkStructure", "--args", "{}");
console.log(`  $ cclay live run camera.checkStructure: ${after.summary}`);
expect("the hub re-check finds no flat run", after.ok && !after.output.issues.some((issue) => issue.rule === "flat"), JSON.stringify(after.output?.issues ?? after).slice(0, 300));

// 3. Master and coverage with a reveal on the first close-up, for the review shot.
await open();
const master = live("run", "camera.cover", "--args", JSON.stringify({ pattern: "master-coverage", shotId: "shot-dialogue", cast: ["char-mara", "char-joon"] }));
console.log(`  $ cclay live run camera.cover master-coverage: ${master.summary}`);
expect("master and coverage lays five shots before the Exchange", await waitFor("document.querySelector('[data-intensity-strip]')?.dataset.intensityStrip === '6'", 20000));
const shots = live("run", "camera.checkStructure", "--args", "{}").output.shots;
live("run", "story.addBeat", "--args", JSON.stringify({ frame: shots[3].frames[0] + 6, label: "the letter", kind: "reveal" }));
expect("the strip draws the beat", await waitFor("!!document.querySelector('.tl-intensity-beat')"));
await click("[data-intensity-toggle='size']");
await click("[data-intensity-toggle='cutting']");
const climb = (await combined()).split(" ").map(Number);
console.log(`  master coverage curve: ${climb.join(" ")}`);
expect("master and coverage climbs from the master to the close-ups", climb[0] < climb[1] && climb[0] < climb[3] && climb[3] > climb[2], climb.join(" "));
await shoot("strip-master-coverage.png");
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("intensity curve browser QA passed");
