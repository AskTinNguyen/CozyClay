#!/usr/bin/env node
// A7: the camera capabilities through the lens, against a running Studio and
// its live hub. Each step is a real `cclay live` call, as a terminal agent
// makes it: camera.applyTechnique sets a Dutch angle, a rack focus, a
// handheld shake, a Snorricam and a whip pan (blur on its shutter), and
// `cclay live capture --framing` renders the shot camera, lens included.
// The shot camera's own state (roll, lens, pose) is read back per frame so
// each picture has numbers beside it. Runs inside tools/qa-browser.mjs with
// COZYCLAY_LIVE_PORT on the dev server's hub; QA_SHOT_DIR keeps the PNGs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterPageLoad } from "./bus/browser-navigation.mjs";
import { waitForFrameState } from "./bus/browser-frame-state.mjs";
import { SCENES_STORAGE_KEY } from "../src/scenes.js";

const port = Number(process.env.CDP_PORT || 9222), out = resolve(process.env.QA_SHOT_DIR ?? ".");
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
if (!page) throw new Error("no page target on the QA browser");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (!message.id || !pending.has(message.id)) return;
	const { resolve: done, reject } = pending.get(message.id);
	pending.delete(message.id);
	if (message.error) reject(new Error(JSON.stringify(message.error))); else done(message.result);
};
const send = (method, params = {}) => afterPageLoad(ws, method, () => new Promise((done, reject) => {
	const id = nextId++;
	pending.set(id, { resolve: done, reject });
	ws.send(JSON.stringify({ id, method, params }));
}));
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
	return result.result.value;
};
let failures = 0;
const expect = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** One `cclay live` invocation, JSON out, as a terminal agent runs it. */
const live = (...args) => {
	console.log(`$ cclay live ${args.map((arg) => (/[\s{]/.test(arg) ? `'${arg}'` : arg)).join(" ")}`);
	for (let attempt = 0; ; attempt++) {
		try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args], { encoding: "utf8", env: process.env })); }
		catch (error) {
			const answer = JSON.parse(error.stdout || "{}");
			if (attempt < 10 && /loaded rig/.test(answer.error?.message ?? "")) { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); continue; }
			return answer.error ? { ok: false, ...answer.error } : answer;
		}
	}
};
const run = (action, args) => {
	const receipt = live("run", action, "--args", JSON.stringify(args));
	console.log(`  ${receipt.summary} checks=${JSON.stringify(receipt.checks ?? {})}`);
	expect(`${action} ${JSON.stringify(args.stack ?? args).slice(0, 80)} applied`, receipt.ok === true, JSON.stringify(receipt).slice(0, 400));
	return receipt;
};
/** The shot camera as the renderer holds it: pose, roll and the lens state the lens renderer reads. */
const camera = () => evaluate(`(() => { const c = window.__cozyclay?.shotCam; if (!c) return null; const r = (v) => Math.round(v * 10000) / 10000; const lens = c.userData.lens;
	return { pos: [c.position.x, c.position.y, c.position.z].map(r), yaw: r(c.rotation.y), pitch: r(c.rotation.x), rollDeg: r(c.rotation.z * 180 / Math.PI), fov: r(c.fov),
		lens: lens ? { fStop: lens.fStop, focusDistance: lens.focusDistance && r(lens.focusDistance), blurPoses: lens.blur?.length ?? 0 } : null }; })()`);
const at = async (frame) => {
	live("operate", "--frame", String(frame), "--mode", "camera");
	await pause(700);
	const state = await camera();
	console.log(`  frame ${frame}: shot camera ${JSON.stringify(state)}`);
	return state;
};
const capture = (file) => {
	const result = live("capture", "--framing", "--out", join(out, file));
	expect(`${file} captured`, result.width >= 640 && result.bytes > 10000, JSON.stringify(result));
};

await send("Runtime.enable");
await send("Page.enable");
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-capabilities.cclayproject", import.meta.url), "utf8"));
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders", await waitForFrameState(evaluate, "!!document.querySelector('canvas') && !!document.querySelector('.tl-shot-block')", 20000));
expect("the rigs load", await waitForFrameState(evaluate, "(() => { const c = window.__cozyclay; return !!c?.rigA && !!c?.shotCam; })()", 30000));
await pause(1500);
const status = live("status", "--wait");
expect("an editor is attached to the live hub", status.editors?.length >= 1, JSON.stringify(status));

// Dutch angle: a tilted horizon.
const dutch = run("camera.applyTechnique", { shotId: "shot-dutch", subjectId: "char-mara", stack: ["dutch-angle"] });
expect("the Dutch angle reads back 20 degrees of roll", dutch.checks?.rollDeg === 20 && !(dutch.warnings ?? []).some((row) => row.code === "PROMPT_ONLY"), JSON.stringify(dutch.checks));
const dutchCam = await at(20);
expect("the shot camera is rolled 20 degrees", Math.abs(dutchCam.rollDeg - 20) < 0.01, JSON.stringify(dutchCam));
capture("dutch-angle.png");

// Rack focus: from Mara (near) to Joon (far) on an 85 mm lens at f/1.4.
const rack = run("camera.applyTechnique", { shotId: "shot-rack", subjectId: "char-mara", stack: [{ id: "rack-focus", params: { from: "char-mara", to: "char-joon" } }] });
expect("the rack reads back two subjects at two distances", /Mara → Joon/.test(rack.checks?.focus ?? "") && rack.checks.focusDistances?.[1] - rack.checks.focusDistances?.[0] > 2, JSON.stringify(rack.checks));
const rackStart = await at(56);
capture("rack-focus-start.png");
const rackEnd = await at(130);
capture("rack-focus-end.png");
expect("the lens focus pulls from Mara to Joon", rackStart.lens?.fStop === 1.4 && rackEnd.lens?.focusDistance - rackStart.lens?.focusDistance > 2, `${JSON.stringify(rackStart.lens)} -> ${JSON.stringify(rackEnd.lens)}`);

// Handheld: two nearby frames differ slightly.
const handheld = run("camera.applyTechnique", { shotId: "shot-handheld", subjectId: "char-mara", stack: [{ id: "handheld-shot", params: { intensity: "strong" } }] });
expect("the handheld shake reads back its amplitude", handheld.checks?.shakeAmplitude === 0.8, JSON.stringify(handheld.checks));
const shakeA = await at(352);
capture("handheld-a.png");
const shakeB = await at(355);
capture("handheld-b.png");
const moved = Math.hypot(...shakeA.pos.map((value, i) => value - shakeB.pos[i])), turned = Math.abs(shakeA.yaw - shakeB.yaw) * 180 / Math.PI;
console.log(`  handheld: ${moved.toFixed(4)} m and ${turned.toFixed(3)} deg yaw between frames 352 and 355`);
expect("three frames apart the camera moved a little", moved > 0.0005 && moved < 0.05 && turned < 2, `${moved} m, ${turned} deg`);

// Snorricam: the camera rides Ana's chest while she walks 8 m.
const snorri = run("camera.applyTechnique", { shotId: "shot-snorri", subjectId: "char-ana", stack: ["snorricam"] });
expect("the Snorricam reads back the chest mount", snorri.checks?.mountBone === "chest", JSON.stringify(snorri.checks));
const snorriA = await at(150);
capture("snorricam-start.png");
const snorriB = await at(232);
capture("snorricam-end.png");
expect("the rig travelled with Ana (world moved) at the same height", Math.abs(snorriB.pos[2] - snorriA.pos[2]) > 5 && Math.abs(snorriB.pos[1] - snorriA.pos[1]) < 1e-3, `${JSON.stringify(snorriA.pos)} -> ${JSON.stringify(snorriB.pos)}`);

// Whip pan with a 270-degree shutter: the snap smears.
const whip = run("camera.applyTechnique", { shotId: "shot-whip", subjectId: "char-mara", stack: ["whip-pan"] });
expect("the whip pan verifies and reads back its shutter", whip.checks?.moveVerified === true && whip.checks.shutterDeg === 270, JSON.stringify(whip.checks));
const whipCam = await at(284);
expect("mid-snap the lens carries the shutter's poses", whipCam.lens?.blurPoses === 9, JSON.stringify(whipCam.lens));
capture("whip-pan-blur.png");
run("camera.set", { shotId: "shot-whip", shutterDeg: null });
await at(285);
await at(284);
capture("whip-pan-no-blur.png");

const prompt = live("tool", "render_prompt", "--args", JSON.stringify({ mode: "video", environment: "a rain-slicked city rooftop at dusk" }));
console.log(`  render_prompt: ${JSON.stringify(prompt).slice(0, 500)}`);
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera capabilities live path QA passed");
