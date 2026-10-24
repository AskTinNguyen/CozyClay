#!/usr/bin/env node
// shot-prompt-engine A7 (and the live half of A6): the Sequence prompt view in
// a running Studio. The camera-coverage fixture is covered through the live hub
// (`cclay live run camera.cover`, a push-in, a dissolve), then File > Export >
// Sequence prompt opens the brief. The script picks a range of shots, switches
// model profiles and checks that the brief and its warnings change with them,
// screenshots the view with a real brief (all shots, and Veo 3.1 with its
// warnings), copies the brief, and asks `cclay live tool render_prompt` for the
// same sequence. Runs inside tools/qa-browser.mjs with COZYCLAY_LIVE_PORT on the
// dev server's hub; QA_SHOT_DIR keeps the PNGs.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
			if (!workspace && mine) { workspace = mine.handle; continue; }
			if (attempt < 10 && /loaded rig/.test(answer.error?.message ?? "")) { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); continue; }
			return answer.error ? { ok: false, ...answer.error } : answer;
		}
	}
};
const run = (action, args) => {
	const receipt = live("run", action, "--args", JSON.stringify(args));
	console.log(`  ${receipt.summary}`);
	expect(`${action} applied`, receipt.ok === true, JSON.stringify(receipt).slice(0, 400));
	return receipt;
};
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
/** Pick an option the way a user does: React reads the native value setter and a change event. */
const choose = (testid, value) => evaluate(`(() => { const el = document.querySelector('[data-testid=${testid}]'); if (!el) return false;
	Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value; })()`);
const view = () => evaluate(`(() => { const q = (id) => document.querySelector('[data-testid=' + id + ']');
	return { text: q('sequence-brief')?.value ?? null, summary: q('sequence-summary')?.textContent ?? null, warnings: [...document.querySelectorAll('[data-testid=sequence-warnings] li')].map((li) => li.dataset.code + ': ' + li.textContent),
		ok: q('sequence-no-warnings')?.textContent ?? null, copy: q('sequence-copy')?.textContent ?? null }; })()`);
const shoot = async (file) => {
	const shot = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(out, file), Buffer.from(shot.data, "base64"));
	console.log(`saved ${file}`);
};
const beats = (text) => (text ?? "").split("\n").filter((line) => /^(\d+\.|Shot \d+,) \d\d:\d\d:\d\d:\d\d-/.test(line));

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
expect("studio renders", await waitForFrameState(evaluate, "!!document.querySelector('canvas') && document.querySelectorAll('.tl-shot-block').length === 2", 20000));
expect("the rigs load", await waitForFrameState(evaluate, "(() => { const c = window.__cozyclay; return !!c?.rigA && !!c?.shotCam; })()", 30000));
await pause(1500);
const status = live("status", "--wait");
expect("an editor is attached to the live hub", status.editors?.length >= 1, JSON.stringify(status));

// A sequence: master and coverage over the exchange, a push-in on its first medium, a dissolve into the next.
const cover = run("camera.cover", { pattern: "master-coverage", cast: ["char-mara", "char-joon"], shotId: "shot-exchange" });
const laid = cover.output?.shots ?? [];
expect("master and coverage lays five shots", laid.length === 5, JSON.stringify(cover.checks));
if (laid[1]) run("camera.applyTechnique", { shotId: laid[1].id, subjectId: "char-mara", stack: [{ id: "medium-shot" }, { id: "push-in" }] });
if (laid[2]) run("camera.setTransition", { shotId: laid[2].id, type: "dissolve", frames: 12 });
await pause(800);

// File > Export > Sequence prompt.
await click("[data-testid=menu-file]");
expect("File shows the Export trigger", await waitForFrameState(evaluate, "!!document.querySelector('[data-testid=topbar-export]')", 5000));
await click("[data-testid=topbar-export]");
expect("Export lists Sequence prompt", await waitForFrameState(evaluate, "!!document.querySelector('[data-testid=export-sequence-prompt]')", 5000));
await click("[data-testid=export-sequence-prompt]");
expect("the Sequence prompt view opens", await waitForFrameState(evaluate, "!!document.querySelector('[data-testid=sequence-brief]')", 5000));
await pause(500);
const all = await view();
console.log(`  summary: ${all.summary}\n  first lines: ${all.text?.split("\n").slice(0, 4).join(" | ")}`);
expect("the brief covers every shot: six beats", beats(all.text).length === 6 && /^SEQUENCE: COVERAGE: 6 shots, /m.test(all.text), all.text?.split("\n")[0]);
expect("the push-in beat states its measured move", /Camera: a medium shot from the waist up; .*push-in/.test(all.text) && /Measured: travels [\d.]+ m at [\d.]+ m\/s/.test(all.text), "");
expect("the dissolve is stated", /In: a 12-frame dissolve from the previous shot \(0\.5s\)\./.test(all.text));
expect("a continuity line closes it", /^CONTINUITY: /m.test(all.text));
expect("no profile: no warnings", /No model limits applied/.test(all.ok ?? ""), JSON.stringify(all.warnings));
await shoot("sequence-prompt-all.png");

// A range: shots 2-4.
await choose("sequence-from", 2); await choose("sequence-to", 4); await pause(300);
const range = await view();
expect("a range of shots 2-4 briefs three beats from 00:00:00:00", beats(range.text).length === 3 && beats(range.text)[0].startsWith("1. 00:00:00:00-") && /^SEQUENCE: COVERAGE: 3 shots, /m.test(range.text), range.summary);
expect("the range changes the brief", range.text !== all.text);

// Profiles: Veo 3.1 (one clip per beat, 4/6/8 s), Kling 3.0 (shot labels, 15 s clips), MiniMax H3 (bracket tags), then none.
await choose("sequence-from", 1); await choose("sequence-to", 6);
await choose("sequence-profile", "veo-3.1"); await pause(300);
const veo = await view();
console.log(`  veo warnings: ${veo.warnings.slice(0, 3).join(" || ")}`);
expect("Veo 3.1 shapes the brief", /^FOR: Veo 3\.1 \(4, 6, 8 s clips; 16:9, 9:16; checked 2026-10-24\)/m.test(veo.text) && /^DELIVERY: one clip per beat \(6 clips\)/m.test(veo.text), veo.text?.split("\n").slice(3, 5).join(" | "));
expect("Veo 3.1 warns about lengths off its grid, each with a fix", veo.warnings.length >= 1 && veo.warnings.every((row) => /^LENGTH_GRID: .*makes 4, 6, 8 s clips\. (Trim|Extend) to /.test(row)), JSON.stringify(veo.warnings));
await shoot("sequence-prompt-veo-warnings.png");
await choose("sequence-profile", "kling-3"); await pause(300);
const kling = await view();
expect("Kling 3.0 labels shots with their length", /^Shot 1, [\d.]+s 00:00:00:00-/m.test(kling.text) && /^FOR: Kling 3\.0/m.test(kling.text), kling.text?.split("\n").find((line) => line.startsWith("Shot 1")));
expect("the warnings change with the profile", JSON.stringify(kling.warnings) !== JSON.stringify(veo.warnings), JSON.stringify(kling.warnings));
await choose("sequence-profile", "minimax-h3"); await pause(300);
const h3 = await view();
expect("MiniMax H3 leads camera lines with bracket tags", /^ {3}Camera: \[(Static|Push in)\] /m.test(h3.text) && h3.warnings.some((row) => /^(WHOLE_SECONDS|TOO_SHORT|LENGTH_GRID)/.test(row)), JSON.stringify(h3.warnings).slice(0, 300));
await choose("sequence-profile", ""); await pause(300);
expect("back to any model: no warnings again", /No model limits applied/.test((await view()).ok ?? ""));

// Copy.
await click("[data-testid=sequence-copy]"); await pause(300);
expect("the copy button copies the brief", (await view()).copy === "Copied");
await choose("sequence-profile", "veo-3.1"); await pause(300);

// The live half of A6: the same sequence through `cclay live tool render_prompt`.
const tool = live("tool", "render_prompt", "--args", JSON.stringify({ scope: "sequence", profile: "veo-3.1" }));
const toolText = tool?.content?.[0]?.text ?? JSON.stringify(tool);
console.log(`  render_prompt sequence: ${toolText.split("\n").slice(0, 3).join(" | ")}`);
expect("cclay live tool render_prompt scope sequence answers the editor's six shots for Veo 3.1", /^SEQUENCE: .+: 6 shots, /m.test(toolText) && /^FOR: Veo 3\.1/m.test(toolText) && /^WARNINGS:/m.test(toolText), toolText.slice(0, 300));

// The sequence pack: every shot's keyframe pack in one zip with the brief and the manifest, through the export job.
await choose("sequence-from", 2); await choose("sequence-to", 3); await pause(300);
await click("[data-testid=sequence-pack]");
const packed = await waitForFrameState(evaluate, "document.body.innerText.includes('cozyclay-sequence-coverage.zip exported')", 120000);
expect("Download sequence pack exports cozyclay-sequence-coverage.zip", packed, await evaluate("document.querySelector('[role=status]')?.textContent ?? ''"));
console.log(`  ${await evaluate("(() => { const t = document.body.innerText, at = t.indexOf('cozyclay-sequence-coverage.zip exported'); return t.slice(at, t.indexOf(String.fromCharCode(10), at)); })()")}`);
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("sequence prompt view QA passed");
