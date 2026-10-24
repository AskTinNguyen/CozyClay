#!/usr/bin/env node
// group-coverage A4: the Coverage section with three people. The coverage
// fixture gains Sela; the Coverage check readout shows the gaps of the plain
// shots; the cast picker takes all three and lays triangle-dialogue over the
// Dialogue shot (camera.cover); the live document holds the 13 shots with
// each pair's line, every camera of a pair on one side of it; the readout and
// camera.checkCoverage over the hub agree. QA_SHOT_DIR keeps the panel shot
// and a contact sheet of the triangle (one frame of each shot, its pair line
// and side under it). Runs in tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on
// the dev server's hub.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterPageLoad } from "./bus/browser-navigation.mjs";
import { waitForFrameState } from "./bus/browser-frame-state.mjs";
import { SCENES_STORAGE_KEY } from "../src/scenes.js";
import { lineSide } from "../src/camera-coverage/cut-geometry.js";

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
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(String(value))});
	el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const clickBlock = (index) => evaluate(`(() => { const el = document.querySelectorAll('.tl-shot-block')[${index}]; if (!el) return false; el.click(); return true; })()`);
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
const data = (selector, key) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.dataset[${JSON.stringify(key)}] ?? null`);
let workspace = null;
/** One `cclay live` call; with a stale editor still on the hub, the fixture project's workspace is named explicitly. */
const live = (...args) => {
	console.log(`$ cclay live ${args.map((arg) => (/[\s{]/.test(arg) ? `'${arg}'` : arg)).join(" ")}`);
	for (let attempt = 0; ; attempt++) {
		try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args, ...(workspace ? ["--workspace", workspace] : [])], { encoding: "utf8", env: process.env })); }
		catch (error) {
			const answer = JSON.parse(error.stdout || "{}"), mine = answer.error?.details?.candidates?.find((row) => row.project === "Group Coverage");
			if (!workspace && mine) { workspace = mine.handle; continue; }
			if (attempt < 10 && /loaded rig/.test(answer.error?.message ?? "")) { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); continue; }
			return answer.error ? { ok: false, ...answer.error } : answer;
		}
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
// The coverage fixture with a third person: Sela watches Mara and Joon from 2.1 m off their line.
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-coverage.cclayproject", import.meta.url), "utf8"));
project.name = "Group Coverage";
const stage = project.scenes.scenes[0].stage, mara = stage.characters.find((row) => row.id === "char-mara");
stage.characters.push({ ...structuredClone(mara), id: "char-sela", x: 0, z: 2.1, rot: 180, subject: "Sela, a girl in a yellow coat" });
const CAST = stage.characters.map((row) => ({ id: row.id, x: row.x, z: row.z }));
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders the two fixture shots", await waitFor("!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
expect("the rigs load", await waitFor("!!window.__cozyclay?.rigA && !!window.__cozyclay?.shotCam", 30000));
await pause(1500);
expect("an editor is attached to the live hub", live("status", "--wait").editors?.length >= 1);
await clickBlock(0);
expect("Camera mode shows the Coverage section and its check", await waitFor("!!document.querySelector('[data-coverage-action]') && !!document.querySelector('[data-coverage-readout]')"));
const before = Number(await data("[data-coverage-readout]", "coverageReadout"));
expect("the readout shows the plain shots' gaps", before > 0 && (await data("[data-coverage-readout]", "coverageComplete")) === "no", await text("[data-coverage-readout]"));
console.log(`  readout before: ${await text("[data-coverage-readout]")}`);

// The cast picker takes three for the triangle.
await setValue("[data-coverage-pattern]", "triangle-dialogue");
expect("a group pattern shows the cast picker with all three ticked", await waitFor("document.querySelector('[data-coverage-members]')?.dataset.coverageMembers === '3' && document.querySelectorAll('[data-coverage-member]:checked').length === 3"));
await click("[data-coverage-member='char-sela']");
expect("unticking one leaves two: Lay is disabled for a triangle", await waitFor("document.querySelector('[data-coverage-lay]')?.disabled === true"));
await click("[data-coverage-member='char-sela']");
expect("ticked again, Lay is enabled", await waitFor("document.querySelector('[data-coverage-lay]')?.disabled === false"));
await click("[data-coverage-lay]");
expect("the Coverage action lays the triangle", await waitFor("/Laid Triangle Dialogue over 0-191/.test(document.querySelector('[data-coverage-status]')?.textContent ?? '')"), await text("[data-coverage-status]"));
console.log(`  ${await text("[data-coverage-status]")}`);
expect("the timeline shows fourteen shot blocks (13 TRI and Exchange)", await waitFor("document.querySelectorAll('.tl-shot-block').length === 14"));
expect("no cut is flagged", await waitFor("document.querySelectorAll('[data-cut-flag]').length === 0"), await evaluate("[...document.querySelectorAll('[data-cut-flag]')].map((el) => el.dataset.cutFlag + ':' + el.dataset.cutRules).join(',')"));

// The document: 13 shots, a line per pair, each pair's cameras on one side of it.
const shots = liveShots().filter((row) => row.coverage?.pattern === "triangle-dialogue");
expect("the live document holds the 13 triangle shots with their coverage record", shots.length === 13 && shots[0].name === "TRI 1 · Master", shots.map((row) => row.name).join(" | "));
const sides = new Map();
for (const shot of shots.filter((row) => row.line)) {
	const [a, b] = [...shot.line.between].sort().map((id) => CAST.find((row) => row.id === id)), key = [...shot.line.between].sort().join("|");
	for (const key0 of shot.cameraKeys) sides.set(key, [...(sides.get(key) ?? []), lineSide(key0.framing.pos, a, { x: b.x - a.x, z: b.z - a.z })]);
}
expect("three pair lines, each kept on one side by its cameras", sides.size === 3 && [...sides.values()].every((values) => values.every((value) => Math.sign(value) === Math.sign(values[0]) || Math.abs(value) <= 0.2)),
	JSON.stringify([...sides].map(([key, values]) => [key, values.map((v) => v.toFixed(2))])));
const hub = live("run", "camera.checkCoverage", "--args", JSON.stringify({ range: { startFrame: 0, endFrameExclusive: 192 } }));
expect("camera.checkCoverage over the hub reads the triangle as enough to edit", hub.ok && hub.checks?.complete === true, JSON.stringify(hub.output?.gaps ?? hub).slice(0, 400));
const all = live("run", "camera.checkCoverage", "--args", "{}");
expect("the readout and camera.checkCoverage agree on the whole timeline", await waitFor(`document.querySelector('[data-coverage-readout]')?.dataset.coverageReadout === '${all.checks?.gaps}'`), `${await data("[data-coverage-readout]", "coverageReadout")} vs ${all.checks?.gaps}`);
console.log(`  readout after: ${await text("[data-coverage-readout]")}`);
await shoot("coverage-group-controls.png", "[data-coverage-readout]");

// The contact sheet: one frame of each triangle shot, its pair line and side under it.
if (process.env.QA_SHOT_DIR) {
	const tiles = mkdtempSync(join(tmpdir(), "cclay-group-")), names = Object.fromEntries(CAST.map((row) => [row.id, stage.characters.find((c) => c.id === row.id).subject.split(",")[0]]));
	const entries = [];
	for (const shot of shots) {
		live("operate", "--frame", String(Math.round((shot.startFrame + shot.endFrame) / 2)), "--mode", "camera");
		await pause(700);
		const path = join(tiles, `${shot.startFrame}.png`), grabbed = live("capture", "--framing", "--out", path);
		expect(`${shot.name} captured`, grabbed.width >= 640 && grabbed.bytes > 10000, JSON.stringify(grabbed));
		const key = [...shot.line.between].sort().join("|"), side = Math.sign(sides.get(key)[0]) > 0 ? "left" : "right";
		entries.push({ name: `${shot.name} · ${shot.line.between.map((id) => names[id]).join("-")} line, camera ${side}`, data: readFileSync(path).toString("base64") });
	}
	const url = await evaluate(`(async () => {
		const rows = ${JSON.stringify(entries)}, w = 480, h = 270, pad = 10, label = 22, head = 40, cols = 4, lines = Math.ceil(rows.length / cols);
		const canvas = document.createElement("canvas"); canvas.width = cols * w + (cols + 1) * pad; canvas.height = head + lines * (h + label + pad) + pad;
		const g = canvas.getContext("2d"); g.fillStyle = "#1d1d21"; g.fillRect(0, 0, canvas.width, canvas.height);
		g.fillStyle = "#f4f4f5"; g.font = "600 20px system-ui"; g.fillText("Triangle Dialogue (camera.cover, three cast): each pair's cameras on one side of that pair's line", pad, 28);
		for (const [i, row] of rows.entries()) {
			const img = new Image(); img.src = "data:image/png;base64," + row.data; await img.decode();
			const x = pad + (i % cols) * (w + pad), y = head + Math.floor(i / cols) * (h + label + pad);
			g.drawImage(img, x, y, w, h); g.fillStyle = "#e4e4e7"; g.font = "13px system-ui"; g.fillText(row.name, x, y + h + 16);
		}
		return canvas.toDataURL("image/png");
	})()`);
	writeFileSync(join(process.env.QA_SHOT_DIR, "contact-triangle-dialogue.png"), Buffer.from(url.split(",")[1], "base64"));
	console.log("saved contact-triangle-dialogue.png");
}
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("group coverage browser QA passed");
