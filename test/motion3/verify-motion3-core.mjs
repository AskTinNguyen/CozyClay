#!/usr/bin/env node
// motion3 compiler + QA core: exact kinematics, keyed channels, a clean walk, and QA that
// catches deliberately broken takes.
import fs from "node:fs";
import { createSkeleton, restState, toLocal, fk } from "../../src/motion3/compiler/skeleton.js";
import { pose } from "../../src/motion3/compiler/pose.js";
import { bakeChannels } from "../../src/motion3/compiler/channels.js";
import { compileMotion } from "../../src/motion3/compiler/compile.js";
import { runMotionQa } from "../../src/motion3/qa/index.js";
import { bakeTake, takeQuat, takeHips } from "../../src/motion3/take.js";
import { dist, I3 } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const rig = name => createSkeleton(JSON.parse(fs.readFileSync(new URL(`../../src/motion3/rigs/${name}.json`, import.meta.url))));

for (const model of ["x-bot-tpose", "y-bot-tpose"]) {
	const sk = rig(model), I = sk.index;
	expect(`${model}: 65 control bones with fingers`, sk.names.length === 65 && I.RightHandIndex3 !== undefined, sk.names.length);
	const s = restState(sk), L = toLocal(sk, s), back = fk(sk, L.quats, L.hips);
	expect(`${model}: rest FK round trip`, Math.max(...s.P.map((p, j) => dist(p, back.P[j]))) < 1e-9);
	const c = { root: [0.2, 0.95, 0.1], yaw: 40, spine_pitch: 15, foot_l: [0.35, 0.3, 0.45], foot_r: [0.1, 0.09, 0], knee_l: [0.1, 0.2, 1],
		armw_r: 1, elbow_r: [-0.5, -1, -0.2], wtwist_r: -30, wflex_r: 20, fingers_r: { grip: 1 } };
	const target = [-0.05, 1.45, 0.45];
	const { s: p } = pose(sk, c, { handTarget: () => target });
	expect(`${model}: leg IK lands on target`, dist(p.P[I.LeftFoot], c.foot_l) < 1e-6);
	expect(`${model}: arm IK lands on target`, dist(p.P[I.RightHand], target) < 1e-6);
	const drift = Math.max(...p.P.map((q, j) => sk.parent[j] < 0 ? 0 : Math.abs(dist(q, p.P[sk.parent[j]]) - dist(sk.restWorldPos[j], sk.restWorldPos[sk.parent[j]]))));
	expect(`${model}: bone lengths unchanged by posing`, drift < 1e-9, drift);
	const L2 = toLocal(sk, p), back2 = fk(sk, L2.quats, L2.hips);
	expect(`${model}: posed state survives local quaternions`, Math.max(...p.P.map((q, j) => dist(q, back2.P[j]))) < 1e-9);
}

const ch = bakeChannels([{ f: 0, set: { a: 0 } }, { f: 10, set: { a: 1 } }, { f: 20, set: { a: 1 } }, { f: 30, set: { a: 0, v: 1 }, step: ["v"] }, { f: 5, set: { v: 0 } }], 40);
expect("PCHIP never overshoots a held value", Math.max(...ch.a) <= 1 + 1e-12 && ch.a.slice(10, 21).every(v => Math.abs(v - 1) < 1e-12));
expect("step keys switch on their frame", ch.v[29] === 0 && ch.v[30] === 1);

const sk = rig("x-bot-tpose"), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
const walkSpec = { schema: "cozyclay.motion-spec.v1", fps: 30, frames: 220,
	keys: [{ f: 0, set: { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0, knee_l: [0.05, 0, 1], knee_r: [-0.05, 0, 1] } }],
	generators: [{ type: "walk", f0: 10, steps: 8, heading: [0, 40] }] };
const walk = compileMotion(walkSpec, { sk, scene: { objects: {} } });
const walkQa = runMotionQa(sk, walk, walkSpec);
expect("an 8-step curving walk passes QA with 0 issues", walkQa.ok, JSON.stringify(walkQa.groups.slice(0, 3)));
const take = bakeTake(sk, walk, { position: [0, 0, 0], yaw: 0 });
const f = 120, q = Array.from({ length: 65 }, (_, b) => takeQuat(take, f, b)), back = fk(sk, q, takeHips(take, f));
expect("take v3 replays the compiled frame", Math.max(...walk.frames[f].s.P.map((p, j) => dist(p, back.P[j]))) < 1e-4);

// Broken takes must be caught.
const box = { pos: [0, 0, 0.6], R: I3(), half: [0.4, 0.5, 0.1] };
const into = compileMotion({ ...walkSpec, frames: 60, generators: [{ type: "walk", f0: 5, steps: 2, heading: [0, 0] }] }, { sk, scene: { objects: { Wall: box } } });
const kinds = new Set(runMotionQa(sk, into, walkSpec).groups.map(g => g.kind));
expect("QA catches walking into an object", kinds.has("COLLIDE"), [...kinds]);
const slideSpec = { ...walkSpec, frames: 30, generators: [], keys: [walkSpec.keys[0], { f: 29, set: { foot_l: [0.2, ank, -0.03], root: [0.05, P[I.Hips][1] - 0.01, 0] } }] };
const slideQa = runMotionQa(sk, compileMotion(slideSpec, { sk, scene: { objects: {} } }), slideSpec);
expect("QA catches a planted foot sliding", slideQa.groups.some(g => g.kind === "SLIDE"), JSON.stringify(slideQa.groups.map(g => g.kind)));
const reachSpec = { ...walkSpec, frames: 2, generators: [], keys: [{ f: 0, set: { ...walkSpec.keys[0].set, foot_l: [0.09, ank - 0.4, 0.5] } }] };
const reachQa = runMotionQa(sk, compileMotion(reachSpec, { sk, scene: { objects: {} } }), reachSpec);
expect("QA catches an unreachable foot target", reachQa.groups.some(g => g.kind === "REACH"));

if (failures) { console.error(`${failures} motion3 core check(s) failed`); process.exit(1); }
console.log("motion3 core: all checks passed");
