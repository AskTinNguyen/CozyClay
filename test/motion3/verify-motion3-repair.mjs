#!/usr/bin/env node
// C6 (lane D1): repairSpec tries the QA patches round by round and keeps the ones that lower the
// summed severity; motion.compile { repair } installs the improved spec and reports what it did.
import { EXITCAR_SPEC, SCENE_OBJECTS } from "./fixtures/exitcar-scene.mjs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { I3 } from "../../src/motion3/compiler/math.js";
import { repairSpec } from "../../src/motion3/repair.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { createStudioAppActions } from "../../src/commands/index.js";

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

// 4. Nothing helps: the spec stays as sent and the rejected patches are counted.
const P = sk.restWorldPos, hipY = P[I.Hips][1] - 0.01;
const deep = stand({ fix: { reach: false }, keys: [{ f: 20, set: { root: [0, hipY, 0] } }, { f: 30, set: { root: [0, hipY + 0.04, 0] } }, { f: 40, set: { root: [0, hipY, 0] } }] });
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

if (failures) { console.error(`${failures} motion3 repair check(s) failed`); process.exit(1); }
console.log("motion3 repair: all checks passed");
