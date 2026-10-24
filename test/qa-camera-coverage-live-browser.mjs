#!/usr/bin/env node
// A6: camera coverage through the lens, against a running Studio and its live
// hub. Each step is a real `cclay live` call: camera.cover lays a
// shot-reverse-shot and (routed from camera.applyTechnique) a master and
// coverage from words, camera.checkCuts reads every cut clean, a frame grab of
// each shot becomes a contact sheet per pattern, a close-up is composed on the
// left third and seen through the lens with the Thirds guide, and a dissolve is
// captured at its midpoint. Runs inside tools/qa-browser.mjs with
// COZYCLAY_LIVE_PORT on the dev server's hub; QA_SHOT_DIR keeps the PNGs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
let workspace = null;
/** One `cclay live` invocation, JSON out, as a terminal agent runs it. */
const live = (...args) => {
	console.log(`$ cclay live ${args.map((arg) => (/[\s{]/.test(arg) ? `'${arg}'` : arg)).join(" ")}`);
	for (let attempt = 0; ; attempt++) {
		try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args, ...(workspace ? ["--workspace", workspace] : [])], { encoding: "utf8", env: process.env })); }
		catch (error) {
			const answer = JSON.parse(error.stdout || "{}"), mine = answer.error?.details?.candidates?.find((row) => row.project === "Camera Coverage");
			// A stale editor on the hub: name the fixture project's workspace and go again.
			if (!workspace && mine) { workspace = mine.handle; continue; }
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
const tiles = mkdtempSync(join(tmpdir(), "cclay-coverage-"));
/** A contact sheet composed in the page: the captured frame of each shot, two per row, its name under it. */
async function sheet(file, entries, title) {
	const images = entries.map((row) => ({ name: row.name, data: readFileSync(row.path).toString("base64") }));
	const url = await evaluate(`(async () => {
		const rows = ${JSON.stringify(images)}, w = 640, h = 360, pad = 12, label = 26, head = 40, cols = 2, lines = Math.ceil(rows.length / cols);
		const canvas = document.createElement("canvas"); canvas.width = cols * w + (cols + 1) * pad; canvas.height = head + lines * (h + label + pad) + pad;
		const g = canvas.getContext("2d"); g.fillStyle = "#1d1d21"; g.fillRect(0, 0, canvas.width, canvas.height);
		g.fillStyle = "#f4f4f5"; g.font = "600 20px system-ui"; g.fillText(${JSON.stringify(title)}, pad, 28);
		for (const [i, row] of rows.entries()) {
			const img = new Image(); img.src = "data:image/png;base64," + row.data; await img.decode();
			const x = pad + (i % cols) * (w + pad), y = head + Math.floor(i / cols) * (h + label + pad);
			g.drawImage(img, x, y, w, h); g.fillStyle = "#e4e4e7"; g.font = "15px system-ui"; g.fillText(row.name, x, y + h + 19);
		}
		return canvas.toDataURL("image/png");
	})()`);
	writeFileSync(join(out, file), Buffer.from(url.split(",")[1], "base64"));
	console.log(`saved ${file}`);
}
const shotsOf = () => {
	const doc = live("describe"), found = new Map();
	JSON.stringify(doc, (key, value) => { if (value && typeof value === "object" && typeof value.id === "string" && Array.isArray(value.cameraKeys)) found.set(value.id, value); return value; });
	return [...found.values()].sort((a, b) => a.startFrame - b.startFrame);
};
async function grabEach(shots, prefix) {
	const entries = [];
	for (const shot of shots) {
		const frame = Math.round((shot.startFrame + shot.endFrame) / 2);
		await at(frame);
		const path = join(tiles, `${prefix}-${shot.startFrame}.png`), result = live("capture", "--framing", "--out", path);
		expect(`${shot.name} captured at frame ${frame}`, result.width >= 640 && result.bytes > 10000, JSON.stringify(result));
		entries.push({ name: `${shot.name} · frames ${shot.startFrame}-${shot.endFrame} · ${shot.technique?.label ?? ""}`, path });
	}
	return entries;
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
expect("studio renders", await waitForFrameState(evaluate, "!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
expect("the rigs load", await waitForFrameState(evaluate, "(() => { const c = window.__cozyclay; return !!c?.rigA && !!c?.shotCam; })()", 30000));
await pause(1500);
const status = live("status", "--wait");
expect("an editor is attached to the live hub", status.editors?.length >= 1, JSON.stringify(status));

// 1. Coverage from words, laid through the hub.
const srs = run("camera.cover", { request: "cover this conversation between Mara and Joon", shotId: "shot-dialogue" });
expect("a shot-reverse-shot of four shots", srs.checks?.pattern === "shot-reverse-shot" && srs.checks.shots === 4, JSON.stringify(srs.checks));
const master = run("camera.applyTechnique", { request: "give me master and coverage", shotId: "shot-exchange" });
expect("master and coverage, five shots, routed from camera.applyTechnique", master.checks?.pattern === "master-coverage" && master.checks.shots === 5, JSON.stringify(master.checks));
const clean = run("camera.checkCuts", {});
expect("every cut of both patterns is clean", clean.checks?.cuts === 8 && clean.checks.issues === 0, JSON.stringify(clean.output?.cuts?.filter((cut) => cut.issues.length)));
const shots = shotsOf();
await sheet("contact-shot-reverse-shot.png", await grabEach(shots.filter((row) => row.coverage?.pattern === "shot-reverse-shot"), "srs"), "Shot-Reverse-Shot (camera.cover): every camera on one side of the Mara-Joon line");
await sheet("contact-master-coverage.png", await grabEach(shots.filter((row) => row.coverage?.pattern === "master-coverage"), "master"), "Master and Coverage (camera.cover)");

// 2. Rule of thirds, through the lens with the Thirds guide.
const cu = shots.find((row) => row.name === "MASTER+ 4 · CU Mara");
const thirds = run("camera.applyTechnique", { shotId: cu.id, request: "rule of thirds left, more headroom" });
expect("the close-up puts Mara's eyes on the left third", Math.abs(thirds.checks?.screenX - 1 / 3) < 0.012 && thirds.checks.eyeLineY > 0.38, JSON.stringify(thirds.checks));
await at(cu.startFrame + 10);
await evaluate("[...document.querySelectorAll('button')].find((el) => /Look through/.test(el.textContent))?.click()");
await pause(1500);
expect("the main viewport looks through the shot camera with the Thirds guide", await evaluate("!!document.querySelector('.lookthrough')"));
const lookthrough = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(out, "rule-of-thirds-lookthrough.png"), Buffer.from(lookthrough.data, "base64"));
console.log("saved rule-of-thirds-lookthrough.png");
await evaluate("[...document.querySelectorAll('button')].find((el) => /Look through/.test(el.textContent))?.click()");

// 3. A dissolve into SRS 2, at its midpoint.
const into = shots.find((row) => row.name === "SRS 2 · OTS Joon");
run("camera.setTransition", { shotId: into.id, type: "dissolve", frames: 16 });
const blend = await at(into.startFrame);
expect("the shot camera carries the dissolve at the cut", (await evaluate("window.__cozyclay.shotCam.userData.lens?.transition?.type")) === "dissolve", JSON.stringify(blend));
const weights = await evaluate("(() => { const t = window.__cozyclay.shotCam.userData.lens?.transition; return t && [t.selfWeight, t.otherWeight]; })()");
console.log(`  dissolve weights at frame ${into.startFrame}: ${JSON.stringify(weights)}`);
expect("half of each picture at the midpoint", weights && Math.abs(weights[0] - 0.53) < 0.05 && Math.abs(weights[0] + weights[1] - 1) < 1e-6, JSON.stringify(weights));
capture("dissolve-midpoint.png");
const prompt = live("tool", "render_prompt", "--args", JSON.stringify({ mode: "video", environment: "a city rooftop at dusk" }));
console.log(`  render_prompt: ${JSON.stringify(prompt).slice(0, 200)}`);
ws.close();
rmSync(tiles, { recursive: true, force: true });
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera coverage live path QA passed");
