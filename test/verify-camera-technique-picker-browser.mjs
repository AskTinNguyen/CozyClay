#!/usr/bin/env node
// Browser contract for the camera technique picker (src/panels/TechniquePicker.jsx):
// in Camera mode the Techniques panel searches, filters by kind and mood, draws a
// technique's top-down plan, applies a pick to the selected shot (stacking an
// angle and a move), retunes it from the parameter popover, and the timeline
// Shot block shows the applied stack. QA_SHOT_DIR saves the two proof screenshots.
import { writeFileSync } from "node:fs";
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
const shot = async (name) => {
	if (!process.env.QA_SHOT_DIR) return;
	const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	writeFileSync(join(process.env.QA_SHOT_DIR, name), Buffer.from(capture.data, "base64"));
	console.log(`saved ${name}`);
};
// React listens for the native input event; set the value through the prototype setter.
const typeInto = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
	el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const shotCam = () => evaluate("(() => { const c = window.__cozyclay?.shotCam; return c ? [c.position.x, c.position.y, c.position.z, c.fov].map(v => Math.round(v * 1000) / 1000) : null; })()");

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => {
	const shot = { id: "technique-qa", name: "Reveal", startFrame: 0, endFrame: 119, kind: "clip",
		cameraKeys: [{ id: "key-0", frame: 0, framing: { pos: { x: 1.5, y: 1.6, z: 4.5 }, yaw: 0.32, pitch: -0.05, fovDeg: 40 } }], camera: { mode: "keys" } };
	const scene = { version: 4, activeSceneId: "scene-technique-qa", scenes: [{ id: "scene-technique-qa", name: "TECHNIQUE QA", objects: [],
		shotDocument: { version: 5, frameCount: 120, shots: [shot], waypoints: [] },
		stage: { characters: [{ id: "char-a", model: "y-bot-tpose", x: 0, z: 0, rot: 0, hidden: false, pose: null, subject: "a woman in a red coat" },
			{ id: "char-b", model: "x-bot-tpose", x: 1.6, z: 1.5, rot: -135, hidden: false, pose: null, subject: "a man in a grey suit" }], hasCharSheet: false, shotAspect: "16:9" } }] };
	localStorage.clear();
	localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: "Technique QA", updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", JSON.stringify(scene));
})()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders", await waitFor("!!document.querySelector('canvas')"));
expect("the shot block renders", await waitFor("!!document.querySelector('.tl-shot-block')"));
await click(".tl-shot-block");
expect("Camera mode shows the Techniques picker", await waitFor("!!document.querySelector('[data-technique-picker]')"));
expect("all 65 techniques are listed", await waitFor("document.querySelector('.technique-list')?.dataset.techniqueCount === '65'"));
const before = await shotCam();

await typeInto("[data-technique-search]", "hitchcok zoom");
expect("search forgives spelling: Vertigo Effect first", await waitFor("document.querySelector('[data-technique-id]')?.dataset.techniqueId === 'vertigo-effect'"));
await typeInto("[data-technique-search]", "");
await click("[data-technique-kind='angle']");
expect("the Angle tab lists only the 11 angles", await waitFor("document.querySelector('.technique-list')?.dataset.techniqueCount === '11'"));
await typeInto("[data-technique-mood]", "uneasy");
expect("the mood filter keeps Dutch Angle", await waitFor("!!document.querySelector('[data-technique-id=\"dutch-angle\"]') && !document.querySelector('[data-technique-id=\"eye-level\"]')"));
await typeInto("[data-technique-mood]", "");
await click("[data-technique-kind='all']");

await click("[data-technique-id='low-angle']");
expect("picking Low Angle applies it to the shot", await waitFor("document.querySelector('[data-technique-status]')?.textContent.startsWith('Applied LOW')"), await evaluate("document.querySelector('[data-technique-status]')?.textContent"));
await click("[data-technique-id='push-in']");
expect("picking Push In stacks it on the angle", await waitFor("/^LOW · PUSH-IN · \\d+mm$/.test(document.querySelector('[data-technique-applied]')?.dataset.techniqueApplied ?? '')"),
	await evaluate("document.querySelector('[data-technique-applied]')?.dataset.techniqueApplied"));
expect("the receipt verified the move", await waitFor("/Push-in \\(dolly in\\) \\(verified\\)/.test(document.querySelector('[data-technique-status]')?.textContent ?? '')"), await evaluate("document.querySelector('[data-technique-status]')?.textContent"));
expect("the plan diagram draws the keyed path", await waitFor("document.querySelector('[data-technique-diagram]')?.dataset.techniqueDiagram === 'keys' && !!document.querySelector('.technique-diagram .path')"));
expect("the timeline Shot block shows the stack", await waitFor("/^LOW · PUSH-IN · \\d+mm$/.test(document.querySelector('.tl-shot-block [data-shot-technique]')?.dataset.shotTechnique ?? '')"));
const after = await shotCam();
expect("the shot camera moved", JSON.stringify(after) !== JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
await typeInto("[data-technique-param='speed']", "fast");
expect("the parameter popover retunes the move", await waitFor("document.querySelector('[data-technique-param=\"speed\"]')?.value === 'fast' && /PUSH-IN/.test(document.querySelector('[data-technique-applied]')?.dataset.techniqueApplied ?? '')"));
await evaluate("document.querySelector('[data-technique-detail]')?.scrollIntoView({ block: 'end' })");
await shot("picker.png");
await click("[data-technique-id='over-the-shoulder']");
expect("an over-the-shoulder replaces nothing it should not: the angle and move stay", await waitFor("/^LOW · OTS · PUSH-IN/.test(document.querySelector('[data-technique-applied]')?.dataset.techniqueApplied ?? '')"),
	await evaluate("document.querySelector('[data-technique-applied]')?.dataset.techniqueApplied"));
await evaluate("window.__cozyclay.scrub?.(119)");
await shot("applied.png");
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers: 2, code: "KeyZ", key: "z", windowsVirtualKeyCode: 90 });
expect("one undo takes the last pick back", await waitFor("/^LOW · PUSH-IN/.test(document.querySelector('.tl-shot-block [data-shot-technique]')?.dataset.shotTechnique ?? '')"),
	await evaluate("document.querySelector('.tl-shot-block [data-shot-technique]')?.dataset.shotTechnique"));
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera technique picker browser QA passed");
