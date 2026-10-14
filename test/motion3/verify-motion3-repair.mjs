#!/usr/bin/env node
// C6 (lane D1): repairSpec tries the QA patches round by round and keeps the ones that lower the
// summed severity; motion.compile { repair } installs the improved spec and reports what it did.
// A group just past its limit with no patch gets a small local search (repair-tune.js): the
// live run3 cup take clears its walkTo thigh hits and its key-pair pop without the agent.
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

if (failures) { console.error(`${failures} motion3 repair check(s) failed`); process.exit(1); }
console.log("motion3 repair: all checks passed");
