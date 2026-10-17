#!/usr/bin/env node
// Lane P (docs/motion-api-v3.1.md): the Studio prompt states the motion procedure in a short part,
// keeps the coordinate rules, leaves the field tables to motion.describe, and the action help
// says what each motion action takes and answers without repeating the prompt.
import assert from "node:assert/strict";
import { STUDIO_SYSTEM_PROMPT as prompt } from "../../bin/agent/studio-prompt.mjs";
import { MOTION_ACTION_HELP as HELP } from "../../src/motion3/docs.js";
import { declarations } from "../../src/commands/motion3.js";
import { DESCRIBE_TOPICS } from "../../src/motion3/schema/fields.js";
import { describe } from "../../src/motion3/describe.js";
import { MOTION_REFERENCE_TOPICS, motionReference, studioSystemPrompt } from "../../bin/agent/studio-motion-reference.mjs";

const check = (name, fn) => { fn(); console.log(`ok - ${name}`); };
const motion = prompt.slice(prompt.indexOf("Motion is computed"), prompt.indexOf("The context scene.previsMode"));
const sentences = text => text.split(/(?<=[.;:])\s+/).map(s => s.trim()).filter(s => s.length >= 40);

// +291 characters for the efficiency round (the motion reference, describe topics, one script for sweeps): budgets +300
check("the whole prompt is at most 11,550 characters", () => assert.ok(prompt.length <= 11550, `${prompt.length}`));
check("the motion part is at most 1,800 characters", () => {
	assert.ok(motion.length > 0 && motion.length <= 1800, `${motion.length}`);
});
check("the prompt names describe, grab, goals, repair, base, beats and the 0.01 m scale floor", () => {
	for (const word of ["motion.describe", "grab", "goals", "repair", "base", "\"beats\"", "0.01 m"]) assert.ok(prompt.includes(word), word);
	assert.doesNotMatch(prompt, /at least 0\.1 m/);
});
check("the motion part keeps the coordinate rules", () => {
	for (const rule of [/metres/, /\+Y up/, /yaw 0 faces \+Z/, /positive yaw turns toward \+X/, /left is \+X/, /base pivot/]) assert.match(motion, rule);
});
check("the motion part states the procedure", () => {
	for (const rule of [/The <motion-reference> block below is motion\.describe/, /read them there, not by a call/, /topics: \[\.\.\.\]/, /never probe the schema/, /reachGrip/, /grab\/release/, /frames: "auto"/,
		/group \(Empty\) is carried or hinged as one unit/, /at least one goals entry per motion request: first list its causes, contacts, effects and what must not happen/, /report the lines no goal measures \(Unmeasured/, /install: "ifClean" and repair: \{ rounds \}/, /topic: "essentials"/, /topic: "goals"/, /never sweep values by hand/, /loop in one script without repair \(tools\.run_action/, /repair only the pick/, /independent calls in the same turn/,
		/base .*plus patch/, /probes and output\.timeline instead of .*motion\.sample/, /qa\.ok, which includes the goals\) installs in that call/,
		/visual: "contact_sheet", frames: "beats"/, /visual: "trace"/, /Report the QA numbers, the goals and output\.fixed/, /read output\.observations near and wrist and verify_result exportFraming/, /output\.observations, not QA/, /views, focus, trail/]) assert.match(motion, rule);
});
check("no sentence describes objects only as hinged doors", () => {
	assert.doesNotMatch(prompt, /\(doors\)/);
	for (const s of prompt.split(/(?<=\.)\s+/).filter(s => /hinge/.test(s))) assert.match(s, /carr/, s);
});
check("the channel and field tables left the prompt", () => {
	for (const word of ["wtwist", "fingers_l", "armw_", "fpitch", "w_<anchor>", "cozyclay.motion-spec.v1", "search.budget"]) assert.ok(!prompt.includes(word), word);
});
check("the compile help is at most 1,200 characters and every help is short", () => {
	assert.ok(HELP.compile.length <= 1200, `${HELP.compile.length}`);
	for (const [id, text] of Object.entries(HELP)) assert.ok(text.length <= 600 || id === "compile", `${id} ${text.length}`);
});
check("the help does not repeat the prompt", () => {
	for (const [id, text] of Object.entries(HELP)) for (const s of sentences(text)) assert.ok(!prompt.includes(s), `${id}: ${s}`);
});
check("the help names every input of its declaration", () => {
	for (const d of declarations) {
		const help = HELP[d.id.split(".")[1]];
		assert.equal(d.description, help, d.id);
		for (const field of Object.keys(d.input.properties).filter(f => f !== "characterId")) assert.ok(help.includes(field), `${d.id} ${field}`);
	}
	for (const topic of DESCRIBE_TOPICS) assert.ok(HELP.describe.includes(topic), topic);
	for (const field of ["specId", "delta", "repair", "loose bone names", "spec.checks need exact", "probes", "timeline", "goals", "severity", "patch", "more"]) assert.ok(HELP.compile.includes(field), field);
});
// The motion reference rides the cached prompt prefix: describe() answers, byte-identical, after the rules.
const reference = await motionReference(), again = await motionReference(), full = await studioSystemPrompt();
console.log(`motion reference: ${reference.length} characters (~${Math.round(reference.length / 3.5)} tokens); prompt + reference ~${Math.round(full.length / 3.5)} tokens`);
check("the motion reference is describe essentials and goals, one JSON line each", () => {
	assert.deepEqual(MOTION_REFERENCE_TOPICS, ["essentials", "goals"]);
	assert.equal(reference, `<motion-reference>\n${MOTION_REFERENCE_TOPICS.map(t => JSON.stringify(describe(t))).join("\n")}\n</motion-reference>`);
});
check("the motion reference is the same bytes on every call and at most 12,000 characters", () => {
	assert.equal(again, reference);
	assert.equal(JSON.stringify(describe("essentials")) + JSON.stringify(describe("goals")), reference.split("\n").slice(1, 3).join(""));
	assert.ok(reference.length <= 12000, `${reference.length}`);
});
check("the Studio animation prompt is the rules, then the reference", () => {
	assert.equal(full, `${prompt}\n\n${reference}`);
});
console.log("verify-motion3-prompt: all checks passed");
