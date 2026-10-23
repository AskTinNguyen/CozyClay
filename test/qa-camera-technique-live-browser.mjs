#!/usr/bin/env node
// The natural-language path end to end against a running Studio: a director's
// sentence goes through `cclay live run camera.applyTechnique { request }`
// (the editor's resolver turns it into a stack), moves the real shot camera,
// and `cclay live capture --framing` renders the result through the lens.
// Needs the dev server with its live hub (COZYCLAY_LIVE_PORT) and runs inside
// tools/qa-browser.mjs, which owns the editor tab. QA_SHOT_DIR keeps the PNGs.
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
/** One `cclay live` invocation, JSON out, as a terminal agent runs it. */
const live = (...args) => {
	console.log(`$ cclay live ${args.map((arg) => (/[\s{]/.test(arg) ? `'${arg}'` : arg)).join(" ")}`);
	for (let attempt = 0; ; attempt++) {
		try { return JSON.parse(execFileSync(process.execPath, ["bin/cozyclay.mjs", "live", ...args], { encoding: "utf8", env: process.env })); }
		catch (error) {
			const answer = JSON.parse(error.stdout || "{}");
			// A rig still loading answers TARGET_NOT_READY; anything else is the answer.
			if (attempt < 10 && /loaded rig/.test(answer.error?.message ?? "")) { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); continue; }
			return answer.error ? { ok: false, ...answer.error } : answer;
		}
	}
};
const apply = (request, name) => {
	const receipt = live("run", "camera.applyTechnique", "--args", JSON.stringify({ shotId: "shot-reveal", request }));
	console.log(`  ${receipt.summary} checks=${JSON.stringify(receipt.checks)} warnings=${JSON.stringify(receipt.warnings ?? [])}`);
	expect(`${name}: "${request}" applied`, receipt.ok === true, JSON.stringify(receipt).slice(0, 400));
	return receipt;
};
const capture = (file) => {
	const result = live("capture", "--framing", "--out", join(out, file));
	expect(`${file} captured`, result.width >= 640 && result.bytes > 10000, JSON.stringify(result));
};

await send("Runtime.enable");
await send("Page.enable");
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
const project = JSON.parse(readFileSync(new URL("./fixtures/camera-techniques.cclayproject", import.meta.url), "utf8"));
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => { localStorage.clear(); localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: ${JSON.stringify(project.name)}, updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", ${JSON.stringify(JSON.stringify(project.scenes))}); })()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders", await waitForFrameState(evaluate, "!!document.querySelector('canvas') && !!document.querySelector('.tl-shot-block')", 20000));
// Framing measures the characters' rigs, so wait until both have loaded.
expect("both rigs load", await waitForFrameState(evaluate, "(() => { const c = window.__cozyclay; return !!c?.rigA && document.querySelectorAll('canvas').length > 0; })()", 30000));
await new Promise((done) => setTimeout(done, 1500));
const status = live("status", "--wait");
expect("an editor is attached to the live hub", status.editors?.length >= 1, JSON.stringify(status));

const still = apply("low-angle close-up on Mara", "static framing");
expect("the low-angle close-up is a held framing", still.checks.technique?.startsWith("LOW · CU") && still.checks.move === "static", JSON.stringify(still.checks));
live("operate", "--frame", "0");
capture("live-low-angle-close-up.png");

const push = apply("slow push-in on Mara", "move");
expect("the push-in verifies as a push-in", push.checks.move === "push-in" && push.checks.moveVerified === true, JSON.stringify(push.checks));
live("operate", "--frame", "0");
capture("live-push-in-start.png");
live("operate", "--frame", "95");
capture("live-push-in-end.png");

const ots = apply("over the shoulder of Joon onto Mara, medium close-up", "group framing");
expect("the over-the-shoulder holds", /OTS/.test(ots.checks.technique ?? ""), JSON.stringify(ots.checks));
live("operate", "--frame", "0");
capture("live-over-the-shoulder.png");

const vertigo = apply("give me a vertigo shot on Mara", "lens move");
expect("the vertigo request verifies as a dolly-zoom", vertigo.checks.move === "dolly-zoom" && vertigo.checks.moveVerified === true, JSON.stringify(vertigo.checks));
const prompt = live("tool", "render_prompt", "--args", JSON.stringify({ mode: "video", environment: "a rain-slicked city rooftop at dusk" }));
console.log(`  render_prompt: ${JSON.stringify(prompt).slice(0, 600)}`);
expect("render_prompt over the live hub states the applied technique", /technique VERTIGO/.test(JSON.stringify(prompt)), JSON.stringify(prompt).slice(0, 300));
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("camera technique live path QA passed");
