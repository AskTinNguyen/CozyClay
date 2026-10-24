// A5: the coverage resolver (src/camera-coverage/resolve.js). A director's
// words map to the action that answers them: coverage requests to camera.cover
// with the pattern and cast, composition words to a composition on
// camera.applyTechnique, cut questions to camera.checkCuts; technique phrases
// are left to the technique resolver. Also the compact coverage index and the
// agent prompt pointer inside its budget. Pure.
import assert from "node:assert/strict";
import { parseComposition, resolveCameraRequest } from "../src/camera-coverage/resolve.js";
import { coverageIndex, COVERAGE_PATTERNS } from "../src/camera-coverage/patterns.js";
import { parseRequest } from "../src/camera-techniques/resolve.js";
import { STUDIO_SYSTEM_PROMPT } from "../bin/agent/studio-prompt.mjs";

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`ok - ${label}`); };
const cast = [{ id: "mara", name: "Mara, a woman in a tan coat" }, { id: "joon", name: "Joon" }];
const route = (text) => resolveCameraRequest(text, { cast });

const COVER = [
	["cover this conversation", "shot-reverse-shot"], ["cover the dialogue between Mara and Joon", "shot-reverse-shot", ["mara", "joon"]],
	["give me master and coverage", "master-coverage"], ["master and coverage on Joon and Mara", "master-coverage", ["joon", "mara"]], ["full coverage please", "master-coverage"],
	["walk and talk", "walk-and-talk"], ["a walk & talk down the corridor", "walk-and-talk"], ["reverse on Joon", "shot-reverse-shot", ["joon"]],
	["clean singles", "dialogue-singles"], ["shot reverse shot", "shot-reverse-shot"], ["cover the action", "action-coverage"], ["fight coverage", "action-coverage"],
	["establish to detail on Mara", "establish-detail", ["mara"]], ["funnel in from wide to close", "establish-detail"],
];
check(`${COVER.length} coverage requests route to camera.cover with the pattern and cast`, () => {
	for (const [text, pattern, castIds] of COVER) {
		const hit = route(text);
		assert.equal(hit?.action, "camera.cover", text);
		assert.equal(hit.args.pattern, pattern, text);
		if (castIds) assert.deepEqual(hit.args.cast, castIds, text);
	}
});

const COMPOSE = [
	["rule of thirds left", { place: "left-third" }], ["frame her on the right third", { place: "right-third" }], ["keep him centred", { place: "centre" }],
	["more lead room", { place: "auto", leadRoom: "more" }], ["give her lead room in the direction she is walking", { place: "auto", leadRoom: "travel" }],
	["tight headroom", { headroom: "tight" }], ["more headroom, centered", { place: "centre", headroom: "loose" }], ["looking room", { place: "auto", leadRoom: "facing" }],
];
check(`${COMPOSE.length} composition phrases become a composition on camera.applyTechnique`, () => {
	for (const [text, composition] of COMPOSE) {
		const hit = route(text);
		assert.equal(hit?.action, "camera.applyTechnique", text);
		assert.deepEqual(hit.args.composition, composition, text);
	}
	assert.equal(route("rule of thirds left on Joon").args.subjectId, "joon");
	assert.deepEqual(parseComposition("medium shot, rule of thirds left"), { place: "left-third" });
});

const CHECKS = [["check my cuts", undefined], ["is the cut at 96 crossing the line?", 96], ["any jump cuts?", undefined], ["did we break the 180 line at frame 140", 140],
	["are the eyelines ok", undefined], ["check screen direction", undefined]];
check(`${CHECKS.length} cut questions route to camera.checkCuts, with the frame when one is named`, () => {
	for (const [text, frame] of CHECKS) {
		const hit = route(text);
		assert.equal(hit?.action, "camera.checkCuts", text);
		assert.equal(hit.args.frame, frame, text);
	}
});

check("technique phrases are left to the technique resolver", () => {
	for (const text of ["low-angle slow push-in on her", "give me a vertigo shot", "over the shoulder close-up", "dutch angle, handheld", "make the reveal feel epic", "whip pan to Joon"]) {
		assert.equal(route(text), null, text);
		assert.ok(parseRequest(text).stack.length, `${text}: still a technique stack`);
	}
});

check("the coverage index lists every pattern with its shots, and the agent prompt points at coverage inside its budget", () => {
	const index = coverageIndex();
	assert.equal(index.length, 6);
	assert.deepEqual(index.map((row) => row[0]), COVERAGE_PATTERNS.map((pattern) => pattern.id));
	assert.equal(index.find((row) => row[0] === "master-coverage")[1], "Master / MS / MS / CU / CU");
	assert.ok(STUDIO_SYSTEM_PROMPT.includes("Film terms (push-in, OTS, coverage, a mood): camera.applyTechnique { request }."));
	assert.ok(STUDIO_SYSTEM_PROMPT.includes("camera.checkCuts checks cuts."));
	assert.ok(STUDIO_SYSTEM_PROMPT.length <= 12790, `${STUDIO_SYSTEM_PROMPT.length}`);
	for (const pattern of COVERAGE_PATTERNS) assert.ok(pattern.description.length >= 60 && pattern.description.length <= 240, pattern.id);
});

console.log(`\n${passed} checks passed`);
