#!/usr/bin/env node
// Physical grasp (#816), fingers in contact: a hand that takes a can by its socket closes each finger until it touches
// the can's round side, on both rigs, instead of curling a preset angle into it or short of it. fix.grasp false is the
// take of before (its hash pinned from the tree before the fingers closed), and the same spec bakes the same take.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { graspChecks } from "../../src/motion3/qa/grasp-checks.js";
import { takeHash } from "./fixtures/take-hash.mjs";
import { CAN_SCENE, canGripSpec } from "./fixtures/can-grip.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
// the takes with fix.grasp false as the tree before the fingers closed baked them (commit 618c9e82)
const BEFORE = { "y-bot-tpose": "ad8cd7187dec594e", "x-bot-tpose": "3a5be06e534c2477" };
const scene = motionScene(CAN_SCENE);
for (const model of ["y-bot-tpose", "x-bot-tpose"]) {
	const sk = skeletonFor(model), on = compileSpec(canGripSpec(), { sk, scene }), off = compileSpec(canGripSpec({ grasp: false }), { sk, scene });
	const issues = graspChecks(sk, on.out), kinds = k => issues.filter(i => i.kind === k);
	console.log(`  ${model}: closed at f30 ${JSON.stringify(on.out.frames[30].diag.closed_r)}`);
	expect(`${model}: no phalanx goes into the can`, kinds("FINGER_PEN").length === 0, JSON.stringify(kinds("FINGER_PEN").slice(0, 3)));
	expect(`${model}: three fingertips or more on the can on every holding frame`, kinds("FINGER_GAP").length === 0, JSON.stringify(kinds("FINGER_GAP").slice(0, 3)));
	const offIssues = graspChecks(sk, { ...off.out, ctx: { ...off.out.ctx, spec: { ...off.out.ctx.spec, fix: undefined } } });
	expect(`${model}: the preset grip of before sinks into the can or stops short of it`, offIssues.some(i => i.kind === "FINGER_PEN" || i.kind === "FINGER_GAP"), offIssues.length);
	expect(`${model}: fix.grasp false bakes the take of before`, takeHash(bakeTake(sk, off.out)) === BEFORE[model], takeHash(bakeTake(sk, off.out)));
	expect(`${model}: the same spec bakes the same take`, takeHash(bakeTake(sk, on.out)) === takeHash(bakeTake(sk, compileSpec(canGripSpec(), { sk, scene }).out)));
}

if (failures) { console.log(`${failures} finger contact check(s) failed`); process.exit(1); }
console.log("motion3 finger contact: all checks passed");
