#!/usr/bin/env node
/**
 * verify-sculpt-panel (#739): the Sculpt mode side panel renders every run state from props
 * alone — idle, running, done and failed — with the controls the run controller relies on.
 *
 * The panel is JSX that imports its stylesheet. A module loader hook hands `.jsx` through
 * Vite's oxc transform (the same one the build uses) and stubs `.css` imports.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

const hook = `
let transform;
export async function initialize({ viteUrl }) { ({ transformWithOxc: transform } = await import(viteUrl)); }
export async function load(url, context, nextLoad) {
	if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
	if (!url.endsWith(".jsx")) return nextLoad(url, context);
	const { readFileSync } = await import("node:fs");
	const { fileURLToPath } = await import("node:url");
	const path = fileURLToPath(url);
	const { code } = await transform(readFileSync(path, "utf8"), path, { lang: "jsx", jsx: { runtime: "automatic" } });
	return { format: "module", source: code, shortCircuit: true };
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, { data: { viteUrl: import.meta.resolve("vite") } });

// locale.js reads localStorage once at import; without one it is English.
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { default: SculptPanel } = await import("../src/panels/SculptPanel.jsx");

const baseRun = { stage: "idle", round: 0, maxRounds: 3, iou: null, targetIou: 0.92, elapsedMs: 0, sheetDataUrl: null, message: null, error: null };
const noop = () => {};
const render = (props) => renderToStaticMarkup(h(SculptPanel, {
	run: baseRun, reference: null, onReference: noop, onStart: noop, onCancel: noop, onPlaceInScene: noop,
	canStart: true, startRefusal: null, sculptName: null, hidden: false, ...props,
}));
const tag = (html, testid) => html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`))?.[0] ?? null;
const reference = { dataUrl: "data:image/png;base64,AAAA", name: "hero.png" };
const sheet = "data:image/png;base64,BBBB";

/* ---------------------------------------------------------------- idle --- */
{
	const html = render({});
	assert.ok(tag(html, "sculpt-dropzone"), "empty reference shows the drop zone");
	assert.match(html, /Drop or paste a reference image/);
	assert.match(tag(html, "sculpt-dropzone"), /role="button"/);
	assert.match(tag(html, "sculpt-dropzone"), /tabindex="0"/, "drop zone is keyboard reachable");
	assert.match(tag(html, "sculpt-reference-input"), /accept="image\/png,image\/jpeg,image\/webp"/);
	assert.ok(tag(html, "sculpt-start"), "Start shows when idle");
	assert.doesNotMatch(tag(html, "sculpt-start"), /disabled/, "Start is enabled when canStart and no refusal");
	assert.equal(tag(html, "sculpt-cancel"), null, "no Cancel when idle");
	assert.equal(tag(html, "sculpt-progress"), null, "no progress before a run");
	assert.equal(tag(html, "sculpt-sheet-toggle"), null, "no sheet toggle without a sheet");
	assert.match(tag(html, "sculpt-place"), /disabled/, "Place in scene needs a sculpt");
	assert.match(html, /Fix details by chatting with the Agent \(⌘B\) while the sculpt is selected\./);
	assert.equal(tag(html, "sculpt-start-refusal"), null);

	const refused = render({ canStart: false, startRefusal: "Sign in with ChatGPT in the Agent panel first." });
	assert.match(tag(refused, "sculpt-start"), /disabled=""/, "Start is disabled with a refusal");
	assert.match(tag(refused, "sculpt-start"), /aria-describedby="sculpt-start-refusal"/);
	assert.match(refused, /data-testid="sculpt-start-refusal">Sign in with ChatGPT in the Agent panel first\.</);
	assert.match(tag(render({ canStart: true, startRefusal: "Busy" }), "sculpt-start"), /disabled=""/, "a refusal alone disables Start");
	assert.match(tag(render({ canStart: false }), "sculpt-start"), /disabled=""/, "canStart false disables Start");

	const filled = render({ reference });
	assert.equal(tag(filled, "sculpt-dropzone"), null, "a reference replaces the drop zone");
	assert.match(filled, /<img src="data:image\/png;base64,AAAA" alt="Reference: hero\.png"/);
	assert.match(tag(filled, "sculpt-reference-replace"), /aria-label="Replace reference image"/);
	assert.ok(!/<section[^>]*hidden/.test(filled));
	assert.match(render({ hidden: true }), /<section[^>]*hidden=""/, "hidden hides the panel");
	console.log("PASS sculpt panel: idle (drop zone, reference, Start, refusal)");
}

/* ------------------------------------------------------------- running --- */
{
	const html = render({ reference, sculptName: "Hero sculpt", run: { ...baseRun, stage: "score", round: 2, iou: 0.81, elapsedMs: 74_000, sheetDataUrl: sheet, message: "Scoring 4 candidates" } });
	assert.equal(tag(html, "sculpt-start"), null, "no Start while running");
	assert.ok(tag(html, "sculpt-cancel"), "Cancel while running");
	const steps = [...html.matchAll(/<li class="sculpt-step" data-state="(\w+)" data-stage="(\w+)"( aria-current="step")?>/g)].map((m) => [m[2], m[1], Boolean(m[3])]);
	assert.deepEqual(steps, [["measure", "complete", false], ["draft", "complete", false], ["score", "current", true], ["refine", "pending", false]]);
	assert.match(html, /data-testid="sculpt-round">Round 2 \/ 3</);
	assert.match(html, /data-testid="sculpt-iou">0\.810<span class="sculpt-iou-target"> \/ 0\.920</);
	assert.match(html, /role="meter"[^>]*aria-valuenow="0\.81"/);
	assert.match(html, /--sculpt-iou:0\.81;--sculpt-target:0\.92/);
	assert.ok(tag(html, "sculpt-iou-target"), "target marker renders");
	assert.match(html, /data-testid="sculpt-elapsed">1:14</);
	assert.match(html, /Scoring 4 candidates/);
	assert.match(tag(html, "sculpt-sheet-toggle"), /aria-pressed="false"/, "sheet toggle shows when a sheet exists");
	assert.match(tag(html, "sculpt-place"), /disabled/, "no placing while running");
	assert.match(tag(html, "sculpt-reference-replace"), /disabled/, "reference is locked while running");
	console.log("PASS sculpt panel: running (stepper, round, IoU bar + target, Cancel)");
}

/* ---------------------------------------------------------------- done --- */
{
	const html = render({ reference, sculptName: "Hero sculpt", run: { ...baseRun, stage: "done", round: 1, iou: 0.945, elapsedMs: 41_000, sheetDataUrl: sheet } });
	assert.ok(tag(html, "sculpt-start"), "Start returns when done");
	assert.equal(tag(html, "sculpt-cancel"), null);
	assert.ok([...html.matchAll(/data-state="complete"/g)].length === 4 && !/aria-current/.test(html), "every stage complete, none current");
	assert.match(html, /Final IoU/);
	assert.match(html, /data-testid="sculpt-done"[^>]*>Done — IoU 0\.945</);
	assert.match(html, /data-reached="true"/, "IoU at or above target marks the bar reached");
	assert.ok(tag(html, "sculpt-sheet-toggle"));
	const place = tag(html, "sculpt-place");
	assert.doesNotMatch(place, /disabled/, "Place in scene enabled once a sculpt exists");
	assert.match(place, /aria-label="Place Hero sculpt in scene"/);
	console.log("PASS sculpt panel: done (final IoU, Place in scene, sheet toggle)");
}

/* -------------------------------------------------------------- failed --- */
{
	const html = render({ reference, run: { ...baseRun, stage: "failed", round: 1, iou: 0.42, elapsedMs: 9_000, error: "The model returned no recipe." } });
	assert.match(html, /data-testid="sculpt-error"[^>]*>The model returned no recipe\.</);
	assert.match(tag(html, "sculpt-error"), /role="alert"/);
	assert.ok(tag(html, "sculpt-start"), "Start is offered again after a failure");
	assert.equal(tag(html, "sculpt-cancel"), null);
	assert.match(tag(html, "sculpt-place"), /disabled/, "nothing to place without a sculpt");
	assert.ok(!/aria-current/.test(html), "a failed run has no current stage");

	const cancelled = render({ reference, run: { ...baseRun, stage: "cancelled", round: 1 } });
	assert.ok(tag(cancelled, "sculpt-cancelled"));
	assert.ok(tag(cancelled, "sculpt-start"));
	console.log("PASS sculpt panel: failed and cancelled");
}
