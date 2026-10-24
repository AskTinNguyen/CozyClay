#!/usr/bin/env node
// director-packet A4 (and the live half of A5): File > Export > Director
// packet in a running Studio. The coverage fixture gains Sela; `cclay live run
// camera.cover` lays a triangle dialogue over the Dialogue shot and master and
// coverage for Mara and Joon over the Exchange shot, with a push-in on its
// second shot. The dialog takes a range, previews the plan, the shot list with
// its flags and the notes; QA_SHOT_DIR keeps the preview of each range and the
// plan it draws. Download writes the sequence pack with packet/ inside: the
// script reads the downloaded zip (`unzip -t`, its file list, the CSV rows).
// Then `cclay live run export.directorPacket` writes a pack for one shot and
// `cclay live tool render_packet` answers the data. Runs inside
// tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on the dev server's hub.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterPageLoad } from "./bus/browser-navigation.mjs";
import { waitForFrameState } from "./bus/browser-frame-state.mjs";
import { SCENES_STORAGE_KEY } from "../src/scenes.js";

const port = Number(process.env.CDP_PORT || 9222), out = resolve(process.env.QA_SHOT_DIR ?? "."), downloads = mkdtempSync(join(tmpdir(), "director-packet-qa-"));
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
const waitFor = (expression, timeout = 15000) => waitForFrameState(evaluate, expression, timeout);
let workspace = null;
/** One `cclay live` invocation, JSON out, as a terminal agent runs it. */
const live = (...args) => {
	console.log(`$ cclay live ${args.map((arg) => (/[\s{]/.test(arg) ? `'${arg}'` : arg)).join(" ")}`);
	for (let attempt = 0; ; attempt++) {
		try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args, ...(workspace ? ["--workspace", workspace] : [])], { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 })); }
		catch (error) {
			const answer = JSON.parse(error.stdout || "{}"), mine = answer.error?.details?.candidates?.find((row) => row.project === "Director Packet");
			if (!workspace && mine) { workspace = mine.handle; continue; }
			if (attempt < 10 && /loaded rig/.test(answer.error?.message ?? "")) { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); continue; }
			return answer.error ? { ok: false, ...answer.error } : answer;
		}
	}
};
const run = (action, args) => {
	const receipt = live("run", action, "--args", JSON.stringify(args), "--timeout", "300000");
	console.log(`  ${receipt.summary}`);
	expect(`${action} applied`, receipt.ok === true, JSON.stringify(receipt).slice(0, 400));
	return receipt;
};
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const choose = (testid, value) => evaluate(`(() => { const el = document.querySelector('[data-testid=${testid}]'); if (!el) return false;
	Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value; })()`);
const view = () => evaluate(`(() => { const q = (id) => document.querySelector('[data-testid=' + id + ']');
	return { summary: q('packet-summary')?.textContent ?? null, cameras: Number(q('packet-plan')?.dataset.cameras), lines: Number(q('packet-plan')?.dataset.lines),
		rows: [...document.querySelectorAll('[data-packet-shot]')].map((tr) => [Number(tr.dataset.packetShot), Number(tr.dataset.flags), tr.lastElementChild.textContent]),
		files: q('packet-files')?.textContent ?? null, notes: [...document.querySelectorAll('[data-note]')].map((li) => li.dataset.note) }; })()`);
const shoot = async (file) => {
	await pause(600);
	const shot = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(out, file), Buffer.from(shot.data, "base64"));
	console.log(`saved ${file}`);
};
/** The preview canvas as the PNG the packet's plan.png is drawn the same way. */
const savePlan = async (file) => {
	const url = await evaluate("document.querySelector('[data-testid=packet-plan]')?.toDataURL('image/png') ?? ''");
	writeFileSync(join(out, file), Buffer.from(url.split(",")[1] ?? "", "base64"));
	console.log(`saved ${file}`);
};
const zips = () => readdirSync(downloads).filter((name) => name.endsWith(".zip"));
const openDialog = async () => {
	await click("[data-testid=menu-file]");
	expect("File shows the Export trigger", await waitFor("!!document.querySelector('[data-testid=topbar-export]')", 5000));
	await click("[data-testid=topbar-export]");
	expect("Export lists Director packet", await waitFor("!!document.querySelector('[data-testid=export-director-packet]')", 5000));
	await click("[data-testid=export-director-packet]");
	expect("the Director packet dialog opens with its plan", await waitFor("!!document.querySelector('[data-testid=packet-plan]') && document.querySelectorAll('[data-packet-shot]').length > 0", 8000));
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-coverage.cclayproject", import.meta.url), "utf8"));
project.name = "Director Packet";
const stage = project.scenes.scenes[0].stage, mara = stage.characters.find((row) => row.id === "char-mara");
stage.characters.push({ ...structuredClone(mara), id: "char-sela", x: 0, z: 2.1, rot: 180, subject: "Sela, a girl in a yellow coat" });
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders", await waitFor("!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
expect("the rigs load", await waitFor("(() => { const c = window.__cozyclay; return !!c?.rigA && !!c?.shotCam; })()", 30000));
await pause(1500);
expect("an editor is attached to the live hub", live("status", "--wait").editors?.length >= 1);

// A triangle over the Dialogue shot, master and coverage over the Exchange, a push-in on its second shot.
const triangle = run("camera.cover", { pattern: "triangle-dialogue", cast: ["char-mara", "char-joon", "char-sela"], shotId: "shot-dialogue" });
expect("the triangle lays thirteen shots", triangle.output?.shots?.length === 13, JSON.stringify(triangle.checks));
const master = run("camera.cover", { pattern: "master-coverage", cast: ["char-mara", "char-joon"], shotId: "shot-exchange" });
const laid = master.output?.shots ?? [];
expect("master and coverage lays five shots", laid.length === 5, JSON.stringify(master.checks));
if (laid[1]) run("camera.applyTechnique", { shotId: laid[1].id, subjectId: "char-mara", stack: [{ id: "medium-shot" }, { id: "push-in" }] });
await pause(800);

// The dialog: the triangle range, then the master and coverage range.
await openDialog();
const all = await view();
console.log(`  all: ${all.summary}`);
expect("every shot: 18 rows, 18 cameras on the plan", all.rows.length === 18 && all.cameras === 18, JSON.stringify(all).slice(0, 300));
await choose("packet-from", 1); await choose("packet-to", 13); await pause(400);
const tri = await view();
console.log(`  triangle: ${tri.summary}`);
expect("the triangle range: 13 shots, its three pair lines on the plan", tri.rows.length === 13 && tri.cameras === 13 && tri.lines === 3, JSON.stringify(tri).slice(0, 300));
expect("the triangle cuts clean", tri.rows.every((row) => !/cuts\//.test(row[2])), JSON.stringify(tri.rows));
await shoot("packet-preview-triangle-dialogue.png");
await savePlan("plan-triangle-dialogue.png");
await choose("packet-to", 18); await choose("packet-from", 14); await pause(400);
const mc = await view();
console.log(`  master and coverage: ${mc.summary}`);
expect("the master and coverage range: 5 shots, one line", mc.rows.length === 5 && mc.cameras === 5 && mc.lines === 1, JSON.stringify(mc).slice(0, 300));
expect("the push-in is flagged unmotivated in its row", mc.rows[1]?.[1] >= 1 && /motivation\/unmotivated/.test(mc.rows[1][2]), JSON.stringify(mc.rows));
expect("the dialog names the packet's files", /packet\/index\.html, packet\/shot-list\.csv, packet\/shot-list\.md, packet\/packet\.json, packet\/plan\.png, packet\/contact-sheet\.png, packet\/intensity\.png/.test(mc.files ?? ""), mc.files);
await shoot("packet-preview-master-coverage.png");
await savePlan("plan-master-coverage.png");

// Download shots 14-15: the sequence pack with packet/ inside.
await choose("packet-to", 15); await pause(300);
await click("[data-testid=packet-download]");
const packed = await waitFor("document.body.innerText.includes('cozyclay-sequence-coverage.zip exported')", 240000);
expect("Download director packet exports cozyclay-sequence-coverage.zip", packed, await evaluate("document.querySelector('[role=status]')?.textContent ?? ''"));
for (let i = 0; i < 40 && !zips().length; i++) await pause(250);
const zip = zips()[0] ? join(downloads, zips()[0]) : null;
expect("the browser download landed", Boolean(zip), readdirSync(downloads).join(", "));
const PACKET = ["packet/index.html", "packet/shot-list.csv", "packet/shot-list.md", "packet/packet.json", "packet/plan.png", "packet/contact-sheet.png"];
const checkZip = (path, shots, label) => {
	const tested = execFileSync("unzip", ["-t", path], { encoding: "utf8" }), names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n");
	const folder = names.filter((name) => name.startsWith("packet/"));
	console.log(`  ${label}: ${names.length} entries; packet/: ${folder.join(", ")}`);
	expect(`${label}: unzip -t passes`, /No errors detected in compressed data/.test(tested), tested.slice(-200));
	const want = shots >= 2 ? [...PACKET, "packet/intensity.png"] : PACKET;
	expect(`${label}: packet/ holds ${want.map((name) => name.slice(7)).join(", ")}`, JSON.stringify(folder) === JSON.stringify(want), JSON.stringify(folder));
	expect(`${label}: the sequence pack around it`, names.includes("sequence-prompt.txt") && names.includes("references.json") && names.filter((name) => name.endsWith("/first.png")).length === shots, JSON.stringify(names));
	const csv = execFileSync("unzip", ["-p", path, "packet/shot-list.csv"], { encoding: "utf8" }).trim().split("\r\n");
	expect(`${label}: shot-list.csv has a row per shot`, csv.length === 1 + shots && csv[0].startsWith("number,name,start_frame"), csv.join(" / ").slice(0, 300));
	const png = execFileSync("unzip", ["-p", path, "packet/contact-sheet.png"]);
	expect(`${label}: contact-sheet.png is a PNG`, png.subarray(1, 4).toString() === "PNG" && png.length > 1000, `${png.length} bytes`);
	return names;
};
if (zip) checkZip(zip, 2, "Download");

// The live half: cclay live writes the pack for one shot; render_packet answers the data.
const before = new Set(zips());
const exported = run("export.directorPacket", { from: 16, to: 16 });
expect("export.directorPacket answers the file and the packet files", exported.output?.fileName === "cozyclay-sequence-coverage.zip" && exported.output?.files?.length === 6 && exported.output?.shots?.length === 1, JSON.stringify(exported.output).slice(0, 400));
for (let i = 0; i < 40 && !zips().some((name) => !before.has(name)); i++) await pause(250);
const second = zips().find((name) => !before.has(name));
expect("cclay live run export.directorPacket wrote a second zip", Boolean(second), zips().join(", "));
if (second) checkZip(join(downloads, second), 1, "cclay live");
const tool = live("tool", "render_packet", "--args", JSON.stringify({ from_shot: 14, to_shot: 18, include_plan: false }));
const toolText = tool?.content?.[0]?.text ?? JSON.stringify(tool), toolData = JSON.parse(tool?.content?.[1]?.text ?? "{}");
console.log(`  render_packet: ${toolText.split("\n")[0]}`);
expect("cclay live tool render_packet answers the editor's five master and coverage shots", /^Director packet: .+, shots 14-18 of 18, /.test(toolText) && toolData.shots?.length === 5 && toolData.shots[1].flags.some((flag) => flag.rule === "unmotivated"), toolText.slice(0, 300));
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("director packet browser QA passed");
