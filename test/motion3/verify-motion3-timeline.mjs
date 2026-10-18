#!/usr/bin/env node
// Lane B (C4): output.timeline. The car-exit scene built from skills gives one beat per skill
// with the frames expandUse reports, the end pose at each beat's last frame, the planted foot
// spans (the walk's run to its end) and the cigarette/lighter show/hide events; a walk
// generator and loose keys are beats of their own; grab/release come from inHandAt; at most 12.
import { SCENE_OBJECTS } from "./fixtures/exitcar-scene.mjs";
import { SCENE_OBJECTS as CUP_OBJECTS } from "./fixtures/cup-scene.mjs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { dist } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const json = v => JSON.stringify(v);

// 1. The car exit from four skills.
const sk = skeletonFor("x-bot-tpose"), I = sk.index;
const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 730, use: [
	{ skill: "sitInSeat", f0: 0, args: { car: "Car", offset: [-0.06, 0.17, 0.023] } },
	{ skill: "exitCar", f0: 0, args: { car: "Car", side: "l" } },
	{ skill: "walkTo", f0: 246, args: { heading: [125, 150], steps: 8, step: 0.5, halfWidth: 0.1, lift: 0.08, turnDistance: 0.4, firstStep: 0.4 } },
	{ skill: "smokeCigarette", f0: 440 }] };
const r = compileSpec(spec, { sk, scene: motionScene(SCENE_OBJECTS) }), tl = r.timeline;
console.log(`  timeline: ${tl.length} beats, ${json(tl).length} bytes`);
expect("one beat per skill, in use order", json(tl.map(b => [b.beat, b.src])) === json(r.used.map((u, i) => [u.skill, `use[${i}]`])), json(tl.map(b => b.src)));
expect("each beat's f is [f0, end] of used", tl.every((b, i) => b.f[0] === r.used[i].f0 && b.f[1] === r.used[i].end), json(tl.map(b => b.f)));
const rootErr = Math.max(...tl.map(b => dist(b.end.root, r.out.frames[b.f[1]].s.P[I.Hips])));
expect("end.root is the Hips joint at f[1] within 1 mm", rootErr <= 0.001, rootErr);
const handErr = Math.max(...tl.flatMap(b => [dist(b.end.hand_l, r.out.frames[b.f[1]].s.P[I.LeftHand]), dist(b.end.hand_r, r.out.frames[b.f[1]].s.P[I.RightHand])]));
expect("end.hand_l / hand_r are the wrists within 1 mm", handErr <= 0.001, handErr);
expect("end.yaw is the yaw channel (1 decimal)", tl.every(b => Math.abs(b.end.yaw - (r.out.frames[b.f[1]].c.yaw ?? 0)) <= 0.05), json(tl.map(b => b.end.yaw)));
const walk = tl.find(b => b.beat === "walkTo");
expect("walkTo's planted spans run to the end of the walk", ["l", "r"].every(k => walk.planted[k].at(-1)?.[1] === walk.f[1]), json(walk.planted));
expect("at most 4 planted spans per foot, each 3+ frames inside the beat", tl.every(b => ["l", "r"].every(k => b.planted[k].length <= 4
	&& b.planted[k].every(([a, z]) => z - a >= 2 && a >= b.f[0] && z <= b.f[1]))), json(tl.map(b => b.planted)));
const planted = walk.planted.l[0], sole = f => r.out.frames[f].s.P[I.LeftToeBase][1];
expect("a planted span really has the foot down", sole(planted[0]) < 0.03 && sole(planted[1]) < 0.03, [sole(planted[0]), sole(planted[1])]);
const smoke = tl.find(b => b.beat === "smokeCigarette"), ev = smoke.events.map(e => `${e.f} ${e.object} ${e.event}`);
expect("the cigarette and lighter show/hide events appear", ["468 cig_vis show", "475 lit_vis show", "542 lit_vis hide"].every(e => ev.includes(e)), json(ev));
expect("events stay inside their beat, ascending", tl.every(b => b.events.every((e, i) => e.f >= b.f[0] && e.f <= b.f[1] && (i === 0 || e.f >= b.events[i - 1].f))));
expect("the right hand ends on the hold anchor while smoking", smoke.end.on_r === "anchor:hold" && smoke.end.on_l === null, json(smoke.end));

// 2. A walk generator and loose keys.
const P = sk.restWorldPos, ank = P[I.LeftFoot][1];
const stand = { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0 };
const g = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 220, keys: [{ f: 0, set: stand }, { f: 180, set: { head_yaw: 20 } }, { f: 200, set: { head_yaw: 0 } }],
	generators: [{ type: "walk", f0: 8, steps: 4, heading: [0, 0] }] }, { sk, scene: { objects: {} } });
expect("keys and a walk generator are beats", json(g.timeline.map(b => [b.beat, b.src, b.f])) === json([["keys", "keys", [0, 0]], ["walk", "generators[0]", [8, 122]], ["keys", "keys", [180, 200]]]), json(g.timeline.map(b => [b.beat, b.src, b.f])));
expect("the walk ends planted on both feet", ["l", "r"].every(k => g.timeline[1].planted[k].at(-1)?.[1] === 122), json(g.timeline[1].planted));

// 3. At most 12 beats.
const many = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 200, use: Array.from({ length: 14 }, (_, i) => ({ skill: "standIdle", f0: i * 10, args: { at: [0, 0], until: i * 10 + 5 } })) },
	{ sk, scene: { objects: {} } });
expect("at most 12 beats, ordered by f[0]", many.timeline.length === 12 && many.timeline.every((b, i) => i === 0 || b.f[0] >= many.timeline[i - 1].f[0]), many.timeline.length);

// 4. grab/release (object-pose.js inHandAt) and on_l = the held object.
const ysk = skeletonFor("y-bot-tpose"), YI = ysk.index, YP = ysk.restWorldPos, yank = YP[YI.LeftFoot][1];
const cup = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 60, keys: [
	{ f: 0, set: { root: [0, YP[YI.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, yank, -0.03], foot_r: [-0.09, yank, 0.03], fyaw_l: 0, fyaw_r: 0 } }, { f: 59, set: { head_yaw: 0 } }],
	props: { grip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: {} } }, objects: { cylinder: { prop: "grip", grab: 20, release: 40 } } },
{ sk: ysk, scene: motionScene(CUP_OBJECTS) }, { checks: {} });
const kb = cup.timeline[0], cev = kb.events.map(e => `${e.f} ${e.object} ${e.event}`);
expect("grab and release are events at their frames", json(cev) === json(["20 cylinder grab", "40 cylinder release"]), json(cev));
const mid = compileSpec({ ...cup.spec, keys: [cup.spec.keys[0], { f: 30, set: { head_yaw: 0 } }], frames: 60 }, { sk: ysk, scene: motionScene(CUP_OBJECTS) }, { checks: {} });
expect("a hand holding an object at f[1] is on that object", mid.timeline[0].end.on_l === "object:cylinder" && mid.timeline[0].end.on_r === null, json(mid.timeline[0].end));
expect("no hand is on anything after release", kb.end.on_l === null, json(kb.end));

if (failures) { console.error(`${failures} motion3 timeline check(s) failed`); process.exit(1); }
console.log("motion3 timeline: all checks passed");
