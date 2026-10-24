#!/usr/bin/env node
// A8: the Camera rig panel (src/panels/CameraRigPanel.jsx) in Camera mode.
// Each control (roll, aperture, focus, shake and its amount, mount and its
// bone, speed, shutter) writes the selected shot's camera, read back from the
// live document over the hub (`cclay live describe`) and from the shot camera
// the renderer holds; roll and focus keys land on the timeline camera lane;
// and the technique picker applies the seven capability techniques. Runs in
// tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on the dev server's hub;
// QA_SHOT_DIR keeps the panel screenshot.
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
const field = (name) => `[data-camera-rig-field='${name}']`;
// React listens for the native input event; set the value through the prototype setter.
const setValue = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(String(value))});
	el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
	if (el.tagName === "INPUT") el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const status = () => evaluate("document.querySelector('[data-camera-rig-status]')?.textContent ?? ''");
/** The shot as the live document holds it, over the hub. */
function liveShot(id) {
	const doc = JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", "describe"], { encoding: "utf8", env: process.env }));
	const found = [];
	JSON.stringify(doc, (key, value) => { if (value && typeof value === "object" && value.id === id && Array.isArray(value.cameraKeys)) found.push(value); return value; });
	return found[0] ?? null;
}
async function control(label, selector, value, read, expected) {
	await setValue(selector, value);
	await pause(400);
	const shot = liveShot("shot-dutch"), got = read(shot?.camera ?? {});
	console.log(`  ${label}: ${await status()}`);
	expect(`${label} writes the shot camera (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(expected), `${JSON.stringify(got)} !== ${JSON.stringify(expected)}`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-capabilities.cclayproject", import.meta.url), "utf8"));
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders", await waitFor("!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 5", 20000));
expect("the rigs load", await waitFor("!!window.__cozyclay?.rigA && !!window.__cozyclay?.shotCam", 30000));
await click(".tl-shot-block");
expect("Camera mode shows the Camera rig panel for the selected shot", await waitFor("document.querySelector('[data-camera-rig]')?.dataset.cameraRig === 'shot-dutch'"));
await pause(1000);

await control("roll", field("roll"), 12, (camera) => camera.rollDeg, 12);
expect("the shot camera the renderer holds is rolled 12 degrees", await waitFor("Math.abs(window.__cozyclay.shotCam.rotation.z * 180 / Math.PI - 12) < 0.01"), await evaluate("window.__cozyclay.shotCam.rotation.z"));
await control("aperture", field("fstop"), 2, (camera) => camera.lens?.fStop, 2);
await control("focus target", field("focus"), "char-joon", (camera) => camera.lens, { fStop: 2, focusTarget: "char-joon" });
await control("shake", field("shake"), "handheld", (camera) => camera.shake?.style, "handheld");
await control("shake amount", field("shake-amplitude"), 0.6, (camera) => camera.shake?.amplitude, 0.6);
await control("mount", field("mount"), "char-ana", (camera) => camera.mount?.characterId, "char-ana");
await control("mount bone", field("mount-bone"), "head", (camera) => camera.mount?.bone, "head");
await control("mount off", field("mount"), "", (camera) => camera.mount ?? null, null);
await control("speed", field("speed"), 0.5, (camera) => camera.speed, 0.5);
expect("the timeline Shot block reports the speed", await waitFor("document.querySelector('.tl-shot-block [data-shot-speed]')?.dataset.shotSpeed === '0.5×'"));
await control("shutter", field("shutter"), 180, (camera) => camera.shutterDeg, 180);

await evaluate("window.__cozyclay.scrub?.(8)");
await pause(500);
await click("[data-camera-rig-key='roll']");
await pause(400);
await setValue(field("roll"), -6);
await evaluate("window.__cozyclay.scrub?.(40)");
await pause(500);
await click("[data-camera-rig-key='roll']");
await click("[data-camera-rig-key='focus']");
await pause(500);
const keyed = liveShot("shot-dutch")?.camera?.rigKeys ?? [];
console.log(`  rig keys: ${JSON.stringify(keyed)}`);
expect("Key roll and Key focus write rig keys at the playhead", keyed.length === 2 && keyed[0].offset === 8 && keyed[0].rollDeg === 12 && keyed[1].offset === 40 && keyed[1].rollDeg === -6 && keyed[1].focus?.targetId === "char-joon", JSON.stringify(keyed));
expect("the keys show on the timeline camera lane", await waitFor("[...document.querySelectorAll('[data-rig-key]')].map((el) => el.dataset.rigKey).join(',') === '8,40'"), await evaluate("[...document.querySelectorAll('[data-rig-key]')].map((el) => el.dataset.rigKey).join(',')"));
expect("and in the panel's key list", await waitFor("document.querySelector('[data-camera-rig-keys]')?.dataset.cameraRigKeys === '2'"));
await evaluate("window.__cozyclay.scrub?.(24)");
await evaluate("document.querySelector('[data-camera-rig]')?.scrollIntoView({ block: 'center' })");
await pause(1200);
if (process.env.QA_SHOT_DIR) {
	const capture = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(process.env.QA_SHOT_DIR, "camera-rig-panel.png"), Buffer.from(capture.data, "base64"));
	console.log("saved camera-rig-panel.png");
}

// The technique picker applies the seven capability techniques on the Handheld shot.
await click(".tl-shot-block:nth-of-type(5)");
await evaluate("(() => { const blocks = document.querySelectorAll('.tl-shot-block'); blocks[blocks.length - 1].click(); })()");
expect("the Handheld shot is selected", await waitFor("document.querySelector('[data-camera-rig]')?.dataset.cameraRig === 'shot-handheld'"));
const READS = { "dutch-angle": /roll 20°/, "canted-frame": /roll 8°/, "rack-focus": /focus .+ → .+/, "handheld-shot": /handheld shake 0\.25/, snorricam: /mounted on .+'s chest/, "slow-motion": /speed 0\.5×/, "whip-pan": /270° shutter/ };
for (const [id, read] of Object.entries(READS)) {
	expect(`${id} is a real capability in the picker list, not prompt words`, await evaluate(`document.querySelector('[data-technique-id="${id}"] small')?.textContent !== 'prompt'`));
	await click(`[data-technique-id='${id}']`);
	const ok = await waitFor(`${read}.test(document.querySelector('[data-technique-status]')?.textContent ?? '')`);
	expect(`picking ${id} applies it and the receipt reads it back`, ok, await evaluate("document.querySelector('[data-technique-status]')?.textContent"));
}
const final = liveShot("shot-handheld")?.camera ?? {};
console.log(`  shot-handheld camera after the picks: ${JSON.stringify(final)}`);
expect("the stacked picks left their capabilities on the shot", final.shake && final.mount && final.speed === 0.5 && final.shutterDeg === 270 && final.rigKeys?.length === 2 && final.rollDeg === 8, JSON.stringify(final));
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera rig panel browser QA passed");
