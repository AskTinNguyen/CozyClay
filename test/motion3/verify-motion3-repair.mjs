#!/usr/bin/env node
// C6 (lane D1): repairSpec tries the QA patches round by round and keeps the ones that lower the
// summed severity; motion.compile { repair } installs the improved spec and reports what it did.
// A group just past its limit with no patch gets a small local search (repair-tune.js): the
// live run3 cup take clears its walkTo thigh hits and its key-pair pop without the agent. The two
// round-2 takes stuck on a grab goal reach qa.ok, and an arm at full reach brings the body closer.
import { EXITCAR_SPEC, SCENE_OBJECTS } from "./fixtures/exitcar-scene.mjs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { I3 } from "../../src/motion3/compiler/math.js";
import { repairSpec } from "../../src/motion3/repair.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { createStudioAppActions } from "../../src/commands/index.js";
import { applyPatch } from "../../src/motion3/json-patch.js";
import { tuneCandidates } from "../../src/motion3/repair-tune.js";
import { SCENE_OBJECTS as CUP_OBJECTS } from "./fixtures/cup-scene.mjs";
import { RUN3_SPEC, RUN3_MANUAL } from "./fixtures/cup-run3-spec.mjs";
import { F275_FULL, F275_REPAIR8, F275_PATCH9, F275_REPAIR9, C8F2_FULL } from "./fixtures/cup-goal-stuck.mjs";
import { press } from "./fixtures/reach-press.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor("x-bot-tpose"), I = sk.index, car = motionScene(SCENE_OBJECTS), empty = { objects: {} };
const json = JSON.stringify;
const repair = (spec, scene = car, rounds = 4) => {
	const t0 = performance.now(), r = repairSpec(spec, { rounds }, s => compileSpec(s, { sk, scene }));
	r.ms = Math.round(performance.now() - t0);
	console.log(`  ${r.ms} ms, ${json({ ...r.repair, applied: r.repair.applied.map(a => `${a.kind} ${a.subject} ${a.patch.map(p => `${p.op} ${p.path}`)} ${a.severity}`) })}`);
	return r;
};
const stand = (extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 60, use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0] } }], ...extra });

// 1. A hand 1.5 cm into a board: repair { rounds: 4 } reaches qa.ok.
const held = stand({ keys: [{ f: 0, set: { armw_r: 1, hand_r: [-0.22, 1.1, 0.32], elbow_r: [-0.5, -1, -0.3] } }, { f: 30, set: { hand_r: [-0.22, 1.1, 0.36] } }, { f: 59, set: { hand_r: [-0.22, 1.1, 0.32] } }] });
const free = compileSpec(held, { sk, scene: empty }).out.frames[30].s.P, front = Math.max(free[I.RightHand][2], free[I.RightHandMiddle3][2]) + 0.022;
const board = { objects: { Board: { pos: [-0.2, 0, front - 0.015 + 0.05], R: I3(), half: [0.3, 0.8, 0.05] } } };
const sent = json(held);
let r = repair(held, board);
expect("board: repair reaches qa.ok", r.result.qa.ok && r.repair.applied.length >= 1, json(r.result.qa.groups.slice(0, 2)));
expect("board: the kept patch and its severity before/after are reported", r.repair.applied[0].kind === "COLLIDE" && r.repair.applied[0].severity[0] > 0 && r.repair.applied[0].severity[1] === 0
	&& r.spec.fix?.penetration === 0.02 && r.repair.compiles === 1 + r.repair.applied.length + r.repair.rejected);
expect("board: the agent's spec object is not changed", json(held) === sent);

// 2. The seat set 7 cm too low in the car scene: the seat hit is gone, within 10 s.
const low = structuredClone(EXITCAR_SPEC);
low.keys[0].set.root = [0.48, 0.85, -0.052];
r = repair(low);
const first = r;
expect("exit car, hips sunk: the seat collision is repaired", !r.result.qa.groups.some(g => /hips x Car_Seat_Driver/.test(g.subject)) && r.repair.applied[0].patch[0].path === "/keys/0/set/root", json(r.repair));
expect("exit car, hips sunk: under 10 s", r.ms < 10000, `${r.ms} ms`);
expect("exit car: result.spec is the repaired spec", r.result.spec.keys[0].set.root[1] > 0.87);

// 3. Twice the same input, twice the same answer.
r = repair(low);
expect("deterministic: the same spec, report and QA", json(r.spec) === json(first.spec) && json(r.repair) === json(first.repair) && json(r.result.qa) === json(first.result.qa));

// 4. Nothing helps: the spec stays as sent and the rejected patches are counted. The REACH
// patches lift a foot for good; balance (style, C13) is opted in so that costs more than it gains.
const P = sk.restWorldPos, hipY = P[I.Hips][1] - 0.01;
const deep = stand({ fix: { reach: false }, checks: { limits: { balance: 0.08 } }, keys: [{ f: 20, set: { root: [0, hipY, 0] } }, { f: 30, set: { root: [0, hipY + 0.04, 0] } }, { f: 40, set: { root: [0, hipY, 0] } }] });
r = repair(deep, empty);
expect("no improvement: spec unchanged, nothing applied, rejected counted, one round", r.spec === deep && r.repair.applied.length === 0 && r.repair.rejected >= 1 && r.repair.rounds === 1, json(r.repair));

// 5. A clean take compiles once; rounds is a ceiling.
r = repair(EXITCAR_SPEC);
expect("exit car (clean): one compile, no rounds, under 10 s", r.result.qa.ok && r.repair.compiles === 1 && r.repair.rounds === 0 && r.ms < 10000, json(r.repair));
const wing = structuredClone(EXITCAR_SPEC);
for (const k of wing.keys) if (json(k.set.elbow_r) === "[0.4,-1,0.6]") k.set.elbow_r = [0.4, 1, 0.6];
r = repair(wing, car, 1);
expect("rounds: 1 stops after one round (at most 3 tries)", r.repair.rounds === 1 && r.repair.compiles <= 4 && r.repair.applied.length >= 1, json(r.repair));

// 6. motion.compile { repair, install: true } installs the improved spec and names it.
const takes = new Map();
const owner = { replace: (id, take) => takes.set(id, take), motionFor: id => takes.get(id) ?? null };
const character = { id: "char-1", model: "x-bot-tpose", subject: "Cascy", x: 0, y: 0, z: 0, rot: 0, scale: 1 };
const objects = [{ id: "post", name: "Post", renderer: "cube", x: 0.16, y: 0.9, z: 0, rot: 0, rotX: 0, rotZ: 0, scaleX: 0.1, scaleY: 0.6, scaleZ: 0.6, footprint: { width: 1, depth: 1 }, height: 1 }];
const registry = createStudioAppActions({ state: () => ({ characters: [character], objects, frameCount: 60 }), storeDomain: name => (name === "motion" ? owner : null) });
const unwrap = x => x?.output ?? x;
const plain = unwrap(registry.run("motion.compile", { characterId: "char-1", spec: stand(), install: false }));
const out = unwrap(registry.run("motion.compile", { characterId: "char-1", spec: stand(), repair: { rounds: 2 } }));
const take = takes.get("char-1");
console.log(`  command: ${plain.qa.total} issues -> ${out.qa.total}; repair ${json(out.repair)}`);
expect("motion.compile repair: fewer issues, the report is in the output", out.repair?.applied?.length >= 1 && out.qa.total < plain.qa.total, json(out.repair));
expect("install: the take keeps the repaired spec and specId names it", take && json(take.spec.use[0].args.at) !== json([0, 0]) && out.specId === specIdOf(take.spec), `${out.specId} ${json(take?.spec?.use)}`);

// 7. Live run3 turn 1: the spec before the agent's hand sweep of walkTo args (fixture).
const ybot = skeletonFor("y-bot-tpose"), cup = motionScene(CUP_OBJECTS);
const cupCompile = s => compileSpec(s, { sk: ybot, scene: cup });
const cupRepair = (spec, rounds = 4) => {
	const t0 = performance.now(), r = repairSpec(spec, { rounds }, cupCompile);
	r.ms = Math.round(performance.now() - t0);
	console.log(`  ${r.ms} ms, ${json({ ...r.repair, applied: r.repair.applied.map(a => `${a.kind} ${a.subject} ${json(a.patch)} ${a.severity}`) })}`);
	return r;
};
const ids = { "spec-440c4b69334b": RUN3_SPEC };
for (const m of RUN3_MANUAL) ids[m.specId] = applyPatch(ids[m.base], m.patch);
expect("run3 fixture: the session's specIds", Object.entries(ids).every(([id, s]) => specIdOf(s) === id), json(Object.entries(ids).map(([id, s]) => [id, specIdOf(s)])));
const stuck = cupCompile(RUN3_SPEC).qa;
expect("run3 fixture: goals met, only thigh_r/thigh_l x cube just past the limit, caused by use[1] walkTo, no patch",
	stuck.goals.every(g => g.ok) && json(stuck.groups.map(g => g.subject).sort()) === json(["thigh_l x cube", "thigh_r x cube"])
	&& stuck.groups.every(g => g.excess < 0.002 && /use\[1\] walkTo/.test(g.cause) && !g.patch), json(stuck.groups));
const thigh = stuck.groups[0];
expect("tune: the walkTo args one step either way first, as add or replace on use[1].args",
	json(tuneCandidates(thigh, RUN3_SPEC).slice(0, 8).map(p => `${p[0].op} ${p[0].path} ${p[0].value}`)) === json(["add /use/1/args/lift 0.07", "add /use/1/args/lift 0.09",
		"add /use/1/args/halfWidth 0.09", "add /use/1/args/halfWidth 0.11", "replace /use/1/args/firstStep 0.39", "replace /use/1/args/firstStep 0.41", "replace /use/1/args/step 0.39", "replace /use/1/args/step 0.41"]),
	json(tuneCandidates(thigh, RUN3_SPEC)));
expect("tune: nothing for a group far past its limit or one that has a patch", !tuneCandidates({ ...thigh, worst: 0.03 }, RUN3_SPEC).length && !tuneCandidates({ ...thigh, patch: [] }, RUN3_SPEC).length);
r = cupRepair(RUN3_SPEC);
const run3 = r;
expect("run3: repair { rounds: 4 } reaches qa.ok with every goal met, by a walkTo arg", r.result.qa.ok && r.result.qa.goals.every(g => g.ok) && r.repair.applied.every(a => a.patch[0].path.startsWith("/use/1/args/")), json(r.result.qa.groups));
expect("run3: under the 20 s cap (and 10 s here); compiles = 1 + applied + rejected", r.ms < 10000 && r.repair.compiles === 1 + r.repair.applied.length + r.repair.rejected, `${r.ms} ms ${json(r.repair)}`);
expect("run3: twice the same answer", json(cupRepair(RUN3_SPEC).spec) === json(run3.spec) && json(cupRepair(RUN3_SPEC).repair) === json(run3.repair));
expect("run3: rounds 1, as the agent sent it, is enough", cupRepair(RUN3_SPEC, 1).result.qa.ok);
// The 5.04 cm/f^2 forearm acceleration is smooth (C13): measured, not an error, unless the
// spec opts into accLimb; then it is an ACC group the key-pair tune clears.
const popped = ids["spec-2f5debe72b57"], smooth = cupCompile(popped);
expect("run3, after the agent's firstStep edit: qa.ok, the forearm's 5.04 cm/f^2 (29 m/s^2) is an observation", smooth.qa.ok
	&& Math.abs(smooth.observations.peaks.LeftForeArm.accel[0] - 0.0504 * 576) < 0.5, json(smooth.observations.peaks.LeftForeArm));
const optedAcc = { ...popped, checks: { ...popped.checks, limits: { ...popped.checks?.limits, accLimb: 0.05 } } }, pop = cupCompile(optedAcc).qa;
expect("run3 + checks.limits.accLimb: only ACC LeftForeArm 5.04, between keys[0] and keys[2], no patch", pop.groups.length === 1 && pop.groups[0].kind === "ACC"
	&& /between keys\[0\] f86 and keys\[2\] f110/.test(pop.groups[0].cause) && !pop.groups[0].patch, json(pop.groups));
r = cupRepair(optedAcc);
expect("ACC near the limit: repair moves a key of the pair one frame apart and reaches qa.ok", r.result.qa.ok && json(r.repair.applied[0]?.patch) === json([{ op: "replace", path: "/keys/0/f", value: 85 }]), json(r.repair));

// 8. A change that makes the total worse, or fails a goal that held, is never kept.
const fake = s => {
	const g = (kind, worst, patch) => ({ kind, subject: "a x b", count: 1, worst, limit: 0.005, first: 0, last: 0, worstFrame: 0, severity: Math.round(worst * 1e4) / 10, patch });
	if (s.x === 0) return { qa: { goals: [{ ok: true }], groups: [g("COLLIDE", 0.006, [{ op: "replace", path: "/x", value: 1 }]), { ...g("SLIDE", 0.006, [{ op: "replace", path: "/x", value: 2 }]), subject: "c" }] } };
	if (s.x === 1) return { qa: { goals: [{ ok: true }], groups: [g("COLLIDE", 0.009), { ...g("SLIDE", 0.006), subject: "c" }] } };
	return { qa: { goals: [{ ok: false }], groups: [] } };
};
r = repairSpec({ x: 0 }, { rounds: 4 }, fake);
expect("guard: a worse total (12 -> 15) and a broken goal (total 0) are both rejected", r.spec.x === 0 && r.repair.applied.length === 0 && r.repair.rejected === 2, json(r.repair));

const swapped = s => ({ qa: { goals: [{ name: "a", ok: s.x === 0 }, { name: "b", ok: s.x !== 0 }], groups: s.x === 0 ? [{ kind: "GOAL", subject: "b: 1 m", count: 1, worst: 0.01, limit: 0, severity: 2, patch: [{ op: "replace", path: "/x", value: 1 }] }] : [] } });
r = repairSpec({ x: 0 }, { rounds: 4 }, swapped);
expect("guard: a change that meets one goal but fails another that held is rejected (same failed count, lower total)", r.spec.x === 0 && r.repair.rejected === 1, json(r.repair));

// 9. Live round 2, turn 1 of sessions f275fda4 and c8f2018b: stuck 6-9 cm off "fingers on cup
//    handle at grab" for 8 and 5 compiles. The spec each agent sent with repair at its first
//    stuck compile (fixture), its specIds, why it is stuck, and repair now.
const e3d7 = applyPatch(F275_FULL, F275_REPAIR8), f275 = applyPatch(e3d7, F275_PATCH9);
expect("stuck fixtures: the session's specIds (f275 compile 8 and 9 stored, c8f2 compile 7 stored with frames resolved)",
	specIdOf(e3d7) === "spec-e3d720274680" && specIdOf(applyPatch(f275, F275_REPAIR9)) === "spec-34a2b58fe6b9" && specIdOf(cupCompile({ fps: 24, ...C8F2_FULL }).spec) === "spec-f0d208a2cb6d",
	json([specIdOf(e3d7), specIdOf(applyPatch(f275, F275_REPAIR9)), specIdOf(cupCompile({ fps: 24, ...C8F2_FULL }).spec)]));
for (const [name, spec, f, leak, value] of [["f275", f275, 114, "w_raise_l", 0.073], ["c8f2", C8F2_FULL, 106, "w_lift_l", 0.09]]) {
	const c = cupCompile(spec), g = c.qa.groups[0], fr = c.out.frames[f];
	expect(`${name} stuck: the grab goal misses (${value} m) with the arm inside its reach; ${leak} ramps through f${f}`, g.kind === "GOAL" && g.worstFrame === f && c.qa.goals[0].value === value
		&& !(fr.diag.reach_over_l > 0) && fr.diag.arm_miss_l < 1e-3 && fr.c[leak] > 0.3 && fr.c.w_handle_l === 1, json({ g, diag: fr.diag, w: fr.c[leak] }));
	expect(`${name}: the GOAL hint names the stray weight and its patch keys it 0 at f${f}`, new RegExp(`^${leak} is [\\d.]+ at f${f}, so anchor \\w+ takes \\d+% of the hand target from anchor handle: key ${leak} 0 at f${f} `).test(g.hint)
		&& json(g.patch) === json([{ op: "add", path: "/keys/-", value: { f, set: { [leak]: 0 } } }]), `${g.hint} ${json(g.patch)}`);
	r = cupRepair(spec);
	expect(`${name}: repair { rounds: 4 } reaches qa.ok with every goal met, in one round, under 10 s`, r.result.qa.ok && r.result.qa.goals.every(x => x.ok) && r.repair.rounds === 1 && r.ms < 10000
		&& r.repair.compiles === 1 + r.repair.applied.length + r.repair.rejected, json(r.repair));
	const again = cupRepair(spec);
	expect(`${name}: twice the same answer`, json(again.spec) === json(r.spec) && json(again.repair) === json(r.repair) && json(again.result.qa) === json(r.result.qa));
	expect(`${name}: rounds 3, as the agent sent it, is enough`, cupRepair(spec, 3).result.qa.ok);
}
const stuckGoal = cupCompile(f275).qa.groups[0];
expect("tune: a GOAL group gets the body placement (walkTo firstStep, 3 cm) and the lean of the keys around it (5 deg), 1 then 2 steps",
	json(tuneCandidates(stuckGoal, f275).map(p => p.map(o => `${o.path} ${o.value}`).join(" & "))) === json(["/use/1/args/firstStep 0.22", "/use/1/args/firstStep 0.28",
		"/keys/2/set/spine_pitch 35 & /keys/4/set/spine_pitch 35", "/keys/2/set/spine_pitch 25 & /keys/4/set/spine_pitch 25", "/use/1/args/firstStep 0.19", "/use/1/args/firstStep 0.31",
		"/keys/2/set/spine_pitch 40 & /keys/4/set/spine_pitch 40", "/keys/2/set/spine_pitch 20 & /keys/4/set/spine_pitch 20"]), json(tuneCandidates(stuckGoal, f275)));
const rootGoal = cupCompile(C8F2_FULL).qa.groups[0], rootTune = tuneCandidates(rootGoal, C8F2_FULL);
expect("tune: when the agent's root keys hold the body, they move together (x then z)", rootTune.length === 12 && rootTune[0].length === 6 && rootTune[0].every(o => /^\/keys\/\d\/set\/root$/.test(o.path) && o.value[0] === -0.03)
	&& rootTune[2].every(o => o.value[2] === 0.43), json(rootTune.slice(0, 3)));
expect("tune: no body placement for a goal more than 10 cm short", !tuneCandidates({ ...stuckGoal, worst: 0.11, excess: 0.11 }, f275).length);

// 10. The arm at full reach: the body comes closer, by what placed it (fixtures/reach-press.mjs).
const pressCompile = s => compileSpec(s, { sk: ybot, scene: empty });
for (const [how, z, path] of [["stand", 0.7, /^\/use\/0\/args\/at$/], ["walk", 1.05, /^\/use\/1\/args\/firstStep$/], ["root", 1.05, /^\/keys\/[34]\/set\/root$/]]) {
	const spec = press(how, z), t0 = performance.now(), rr = repairSpec(spec, { rounds: 4 }, pressCompile), ms = performance.now() - t0;
	const kinds = rr.result.qa.groups.map(g => g.kind);
	console.log(`  ${how}: ${Math.round(ms)} ms, ${json(rr.repair.applied.map(a => `${a.kind} ${json(a.patch)}`))}; left ${json(kinds)}`);
	expect(`press (${how}): repair meets the goal by moving the body (${path.source}), qa.ok`, rr.result.qa.goals.every(g => g.ok)
		&& rr.result.qa.ok && rr.repair.applied.filter(a => a.kind !== "POP").every(a => a.patch.every(o => path.test(o.path))) && ms < 10000, json(rr.repair));
}

if (failures) { console.error(`${failures} motion3 repair check(s) failed`); process.exit(1); }
console.log("motion3 repair: all checks passed");
