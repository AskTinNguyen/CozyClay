#!/usr/bin/env node
// motion.compile / motion.qa / motion.sample through the real action registry with stub ports.
import { createStudioAppActions } from "../../src/commands/index.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

const takes = new Map();
const owner = { replace: (id, take) => takes.set(id, take), motionFor: id => takes.get(id) ?? null };
const character = { id: "char-1", model: "x-bot-tpose", subject: "Cascy", x: 1, y: 0, z: 2, rot: 90, scale: 1 };
const objects = [{ id: "wall", name: "Wall", renderer: "cube", x: 4.7, y: 0, z: 2, rot: 0, rotX: 0, rotZ: 0, scaleX: 0.2, scaleY: 2, scaleZ: 2, footprint: { width: 1, depth: 1 }, height: 1 }];
const ports = { state: () => ({ characters: [character], objects, frameCount: 300 }), storeDomain: name => (name === "motion" ? owner : null) };
const registry = createStudioAppActions(ports);
const run = (id, args) => registry.run(id, args);

const sk = skeletonFor("x-bot-tpose"), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
// The character stands at (1, 0, 2) facing +X (rot 90): its left is -Z.
const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 200,
	keys: [{ f: 0, set: { root: [1, P[I.Hips][1] - 0.01, 2], yaw: 90, foot_l: [1.03, ank, 1.91], foot_r: [0.97, ank, 2.09], fyaw_l: 90, fyaw_r: 90 } }],
	generators: [{ type: "walk", f0: 8, steps: 6, heading: [90, 90] }] };

let receipt = run("motion.compile", { characterId: "char-1", spec });
const out = receipt?.output ?? receipt?.receipt?.output ?? receipt;
expect("motion.compile answers frames and QA", out?.frames === 200 && typeof out?.qa?.ok === "boolean", JSON.stringify(receipt).slice(0, 300));
expect("a straight walk that stops short of the wall is clean", out?.qa?.ok === true, JSON.stringify(out?.qa?.groups?.slice(0, 3)));
const take = takes.get("char-1");
expect("the take v3 is installed with frames and the spec", take?.schema === "cozyclay.take.v3" && take.frames === 200 && JSON.stringify(take.spec) === JSON.stringify(spec));

const sample = run("motion.sample", { characterId: "char-1", frames: [0, 199], bones: ["Hips", "LeftFoot"] });
const rows = (sample?.output ?? sample).frames;
expect("motion.sample returns world positions in the scene frame", Math.abs(rows[0].bones.Hips[0] - 1) < 0.02 && Math.abs(rows[0].bones.Hips[2] - 2) < 0.02, JSON.stringify(rows[0]));
expect("the walk travels toward +X", rows[1].bones.Hips[0] > 2.5, JSON.stringify(rows[1]));

const long = { ...spec, generators: [{ type: "walk", f0: 8, steps: 14, heading: [90, 90] }], frames: 340 };
const bad = (r => r?.output ?? r)(run("motion.compile", { characterId: "char-1", spec: long, install: false }));
expect("walking through the wall is reported, and install: false leaves the take alone", bad.qa.groups.some(g => g.kind === "COLLIDE" && /Wall|wall/.test(g.subject)) && takes.get("char-1").frames === 200, JSON.stringify(bad.qa.groups.slice(0, 3)));
const qa = (r => r?.output ?? r)(run("motion.qa", { characterId: "char-1" }));
expect("motion.qa re-measures the installed take", qa.qa.ok === true);

let refused = null;
try { run("motion.compile", { characterId: "char-1", spec: { ...spec, fps: 30 } }); } catch (error) { refused = error; }
expect("a spec at another frame rate is refused", refused?.code === "INVALID_ARGUMENT" || /fps/.test(JSON.stringify(refused ?? "")), String(refused));

if (failures) { console.error(`${failures} motion3 command check(s) failed`); process.exit(1); }
console.log("motion3 commands: all checks passed");
