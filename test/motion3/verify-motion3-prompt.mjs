#!/usr/bin/env node
// Lane P (docs/motion-api-v3.1.md): the Studio prompt states the motion procedure in a short part,
// keeps the coordinate rules, leaves the field tables to motion.describe, and the action help
// says what each motion action takes and answers without repeating the prompt.
import assert from "node:assert/strict";
import { STUDIO_SYSTEM_PROMPT as prompt } from "../../bin/agent/studio-prompt.mjs";
import { MOTION_ACTION_HELP as HELP } from "../../src/motion3/docs.js";
import { declarations } from "../../src/commands/motion3.js";
import { DESCRIBE_TOPICS } from "../../src/motion3/schema/fields.js";

const check = (name, fn) => { fn(); console.log(`ok - ${name}`); };
const motion = prompt.slice(prompt.indexOf("Motion is computed"), prompt.indexOf("The context scene.previsMode"));
const sentences = text => text.split(/(?<=[.;:])\s+/).map(s => s.trim()).filter(s => s.length >= 40);

check("the whole prompt is at most 11,000 characters", () => assert.ok(prompt.length <= 11000, `${prompt.length}`));
check("the motion part is at most 1,200 characters", () => {
	assert.ok(motion.length > 0 && motion.length <= 1200, `${motion.length}`);
});
check("the prompt names describe, grab, goals, repair, base, beats and the 0.01 m scale floor", () => {
	for (const word of ["motion.describe", "grab", "goals", "repair", "base", "\"beats\"", "0.01 m"]) assert.ok(prompt.includes(word), word);
	assert.doesNotMatch(prompt, /at least 0\.1 m/);
});
check("the motion part keeps the coordinate rules", () => {
	for (const rule of [/metres/, /\+Y up/, /yaw 0 faces \+Z/, /positive yaw turns toward \+X/, /left is \+X/, /base pivot/]) assert.match(motion, rule);
});
check("the motion part states the procedure", () => {
	for (const rule of [/Before the first spec, read run_action motion\.describe/, /never probe the schema/, /reachGrip/, /grab\/release/, /frames: "auto"/,
		/group \(Empty\) is carried or hinged as one unit/, /at least one goals entry per motion request/, /install: "ifClean" and repair: \{ rounds \}/, /topic: "essentials"/, /never sweep values by hand/,
		/base .*plus patch/, /probes and output\.timeline instead of .*motion\.sample/, /qa\.ok, which includes the goals\) installs in that call/,
		/visual: "contact_sheet", frames: "beats"/, /visual: "trace"/, /Report the QA numbers, the goals and output\.fixed/, /output\.observations, not QA/, /views, focus, trail/]) assert.match(motion, rule);
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
console.log("verify-motion3-prompt: all checks passed");
