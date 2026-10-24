#!/usr/bin/env node
// depth-staging A5: shot checks on the timeline and in the Coverage panel.
// A pillar placed between the Dialogue shot's camera and the two (cclay live
// run object.add) flags the shot BLOCKED on the Shots lane; camera.checkShots
// over the hub reads occluded with the same frames; the Shot check readout
// explains the flag and its fix; Apply fix runs camera.fixShot (one undo
// entry) and the flag goes, the hub re-check agrees. Then a floor lamp held in
// the foreground (camera.applyTechnique composition.foreground), captured
// through the lens. Runs in tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on the
// dev server's hub; QA_SHOT_DIR keeps the shots.
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
async function shoot(file, selector = ".tl-track.shots") {
	if (!process.env.QA_SHOT_DIR) return;
	await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
	await pause(1200);
	const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
	const capture = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
	writeFileSync(join(process.env.QA_SHOT_DIR, file), Buffer.from(capture.data, "base64"));
	console.log(`saved ${file}`);
}
const flags = () => evaluate("[...document.querySelectorAll('[data-shot-check]')].map((el) => `${el.dataset.shotCheck}:${el.dataset.shotCheckRule}`).join(',')");

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
expect("an empty set flags nothing", await waitFor("!!document.querySelector('.tl-shot-block')") && (await flags()) === "", await flags());

// 1. A pillar between the Dialogue camera (0, 1.6, 6) and the two at the origin.
const added = live("run", "object.add", "--args", JSON.stringify({ kind: "cube", placement: { x: 0, z: 3 }, name: "Pillar" }));
const pillar = added.affectedIds?.[0];
live("run", "object.set", "--args", JSON.stringify({ id: pillar, set: { scale: { x: 1.4, y: 3, z: 0.4 } } }));
console.log(`  $ cclay live run object.add + object.set: ${pillar}`);
expect("the Shots lane flags the Dialogue shot BLOCKED", await waitFor("document.querySelector('[data-shot-check=\"shot-dialogue\"]')?.dataset.shotCheckRule === 'occluded'", 20000), await flags());
const seen = await evaluate(`(() => { const flag = document.querySelector('[data-shot-check="shot-dialogue"]'), r = flag.getBoundingClientRect(), lane = flag.closest('.tl-lane').getBoundingClientRect();
	return { onTop: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === flag, inLane: r.top >= lane.top && r.bottom <= lane.bottom, width: Math.round(r.width) }; })()`);
expect("the flag is drawn on the lane, on top, spanning its frames", seen.onTop && seen.inLane && seen.width > 100, JSON.stringify(seen));
const flagTitle = await evaluate("document.querySelector('[data-shot-check=\"shot-dialogue\"]')?.title ?? ''");
console.log(`  flag: ${flagTitle.replace(/\n/g, " / ")}`);
const asked = live("run", "camera.checkShots", "--args", JSON.stringify({ request: "is anything blocking her face?" }));
console.log(`  $ cclay live run camera.checkShots: ${asked.summary}`);
const issue = asked.output?.shots?.find((row) => row.shotId === "shot-dialogue")?.issues?.[0];
expect("camera.checkShots over the hub reads occluded by the pillar, with a fix", asked.ok && asked.output.rule === "occluded" && issue?.rule === "occluded" && issue.by?.includes(pillar) && Boolean(issue.fix.delta), JSON.stringify(asked).slice(0, 400));
expect("the flag and the hub name the same issue", flagTitle.includes(issue?.message ?? "-") && flagTitle.includes(issue?.fix.text ?? "-"), flagTitle);
await clickBlock(0);
expect("the Shot check readout explains the flag and its fix", await waitFor("!!document.querySelector('[data-shot-check-issue=\"occluded\"] [data-shot-check-fix]')"), await text("[data-shot-checks]"));
const readout = await text("[data-shot-check-issue='occluded']");
console.log(`  readout: ${readout}`);
expect("the readout states the blocker, the frames and the fix", /Blocked · high/.test(readout) && /Pillar hides/.test(readout) && readout.includes(issue?.fix.text ?? "-"), readout);
await shoot("shot-check-flagged.png");
await shoot("shot-check-readout.png", "[data-shot-checks]");

// 2. Apply fix: camera.fixShot moves the shot's keys; the flag goes and the hub agrees.
await click("[data-shot-check-fix='occluded']");
expect("Apply fix runs camera.fixShot and checks again", await waitFor("/checked again, clean/.test(document.querySelector('[data-shot-check-status]')?.textContent ?? '')"), await text("[data-shot-check-status]"));
console.log(`  ${await text("[data-shot-check-status]")}`);
expect("the flag is gone from the Shots lane", await waitFor("!document.querySelector('[data-shot-check=\"shot-dialogue\"][data-shot-check-rule=\"occluded\"]')"), await flags());
const after = live("run", "camera.checkShots", "--args", JSON.stringify({ shotIds: ["shot-dialogue"] }));
console.log(`  $ cclay live run camera.checkShots: ${after.summary}`);
expect("the hub re-check finds the Dialogue shot clean", after.ok && after.checks.issues === 0, JSON.stringify(after.output ?? after).slice(0, 300));

// 3. A floor lamp held in the foreground of Mara's medium shot, through the lens.
await open();
const lamp = live("run", "object.add", "--args", JSON.stringify({ kind: "cylinder", placement: { x: -0.4, z: 2.2 }, name: "Floor lamp" })).affectedIds?.[0];
live("run", "object.set", "--args", JSON.stringify({ id: lamp, set: { scale: { x: 0.35, y: 1.6, z: 0.35 } } }));
const held = live("run", "camera.applyTechnique", "--args", JSON.stringify({ shotId: "shot-dialogue", subjectId: "char-mara", stack: ["medium-shot"], composition: { foreground: { id: lamp, share: 0.3 } } }));
console.log(`  $ cclay live run camera.applyTechnique: ${held.summary} (share ${held.checks?.foregroundShare})`);
expect("the lamp is held in the foreground at about the asked share", held.ok && Math.abs((held.checks?.foregroundShare ?? 0) - 0.3) < 0.05 && held.output?.layers?.foreground?.includes("Floor lamp"), JSON.stringify(held).slice(0, 400));
if (process.env.QA_SHOT_DIR) {
	const shot = live("capture", "--framing", "--out", join(process.env.QA_SHOT_DIR, "foreground-lamp-lens.png"));
	expect("the lens view is captured", shot.ok !== false, JSON.stringify(shot).slice(0, 200));
}
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("shot checks browser QA passed");
