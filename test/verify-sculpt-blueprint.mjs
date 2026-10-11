#!/usr/bin/env node
// verify-sculpt-blueprint (#739): the model-sheet request is subject-agnostic,
// lays four orthographic views out on a fixed 2 x 2 grid, and goes to the
// sidecar as a "sheet" so nothing is added to the prompt.
import assert from "node:assert/strict";
import { BLUEPRINT_LAYOUT, BLUEPRINT_SIZE, blueprintErrorMessage, blueprintRequest, buildBlueprintPrompt } from "../src/sculpt-blueprint.js";

let failures = 0;
function check(name, fn) {
	try { fn(); console.log(`PASS ${name}`); }
	catch (error) { failures += 1; console.log(`FAIL ${name}\n${error.stack}`); }
}

check("the layout is four equal quarters that tile the sheet, FRONT beside SIDE on the top row", () => {
	assert.deepEqual(BLUEPRINT_LAYOUT.map((panel) => panel.view), ["front", "side", "back", "top"]);
	const area = BLUEPRINT_LAYOUT.reduce((sum, panel) => sum + panel.width * panel.height, 0);
	assert.equal(area, 1);
	const front = BLUEPRINT_LAYOUT[0], side = BLUEPRINT_LAYOUT[1];
	assert.equal(front.y, side.y, "front and side share a row, so their head and foot lines are the same pixels");
	assert.equal(front.height, side.height);
	for (const a of BLUEPRINT_LAYOUT) for (const b of BLUEPRINT_LAYOUT) {
		if (a === b) continue;
		const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
		assert.ok(apart, `${a.view} and ${b.view} do not overlap`);
	}
	assert.equal(BLUEPRINT_SIZE, "1536x1024");
});

check("the prompt names the views, orthographic projection, one scale, shared lines and a white background", () => {
	const prompt = buildBlueprintPrompt();
	for (const phrase of ["2 x 2 grid", "Top-left: FRONT view", "Top-right: LEFT SIDE view", "subject faces image left", "Bottom-left: BACK view", "Bottom-right: TOP view", "true orthographic", "One scale for all four panels", "same horizontal line", "pure white (#FFFFFF)", "Do not write any text", "exactly the pose in the reference", "motion lines", "not part of the subject itself"]) {
		assert.ok(prompt.toLowerCase().includes(phrase.toLowerCase()), `prompt says "${phrase}"`);
	}
});

check("the template names no subject: everything specific comes from the reference and the notes", () => {
	const prompt = buildBlueprintPrompt();
	for (const word of ["snorlax", "turtle", "character", "pokemon", "animal", "person", "robot"]) assert.ok(!prompt.toLowerCase().includes(word), `no "${word}"`);
	assert.ok(prompt.includes("main subject in the attached reference image"));
});

check("neutral pose swaps only the pose rule", () => {
	const keep = buildBlueprintPrompt({ pose: "keep" }).split("\n");
	const neutral = buildBlueprintPrompt({ pose: "neutral" }).split("\n");
	assert.equal(keep.length, neutral.length);
	const changed = keep.filter((line, index) => line !== neutral[index]);
	assert.equal(changed.length, 1);
	assert.match(neutral.find((line) => line.startsWith("Pose:")), /neutral rest pose/);
	assert.throws(() => buildBlueprintPrompt({ pose: "dance" }), /pose must be one of keep, neutral/);
});

check("operator notes are appended as written, trimmed, single-line and capped", () => {
	assert.ok(!buildBlueprintPrompt({ notes: "   " }).includes("Notes from the operator"));
	const prompt = buildBlueprintPrompt({ notes: "  a ceramic teapot,\n  spout on its left  " });
	assert.ok(prompt.endsWith("Notes from the operator: a ceramic teapot, spout on its left"));
	assert.ok(buildBlueprintPrompt({ notes: "x".repeat(2000) }).length < buildBlueprintPrompt().length + 700);
});

check("the request sends the reference as the edited image, as a high-quality landscape sheet", () => {
	const request = blueprintRequest({ reference: { dataUrl: "data:image/png;base64,AA==", name: "ref.png" }, pose: "neutral", notes: "teapot" });
	assert.equal(request.imageDataUrl, "data:image/png;base64,AA==");
	assert.equal(request.composition, "sheet");
	assert.equal(request.quality, "high");
	assert.equal(request.size, "1536x1024");
	assert.equal(request.prompt, buildBlueprintPrompt({ pose: "neutral", notes: "teapot" }));
	assert.throws(() => blueprintRequest({ reference: null }), /needs a reference image/);
});

check("a safety refusal says what usually causes it and what to try; anything else keeps its message", () => {
	const refusal = blueprintErrorMessage(new Error("400 — Your request was rejected by the safety system. If you believe this is an error…"), "fallback");
	assert.match(refusal, /refused this reference/);
	assert.match(refusal, /original design/);
	assert.equal(blueprintErrorMessage(new Error("upstream timeout"), "upstream timeout"), "upstream timeout");
});

if (failures) {
	console.log(`${failures} check(s) failed`);
	process.exit(1);
}
console.log("verify-sculpt-blueprint: all checks passed");
