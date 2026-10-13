#!/usr/bin/env node
// Carried props: spec.objects[id] = { prop, at, along, visible } puts a scene record on a held
// prop every frame (the cigarette between the fingers, the lighter in the other hand), shows it
// only while its visibility channel is on, keeps it out of the collision scene, and leaves the
// car-exit scene at QA 0.
import { EXITCAR_SPEC, SCENE_OBJECTS, CHARACTER } from "./fixtures/exitcar-scene.mjs";
import { compileMotion } from "../../src/motion3/compiler/compile.js";
import { validateSpec } from "../../src/motion3/compiler/validate.js";
import { runMotionQa } from "../../src/motion3/qa/index.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { sceneObjectsAt, sceneObjectTravelMatrixAt, trackShown } from "../../src/object-travel.js";
import { dist, apply } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const cube = (id, extra = {}) => ({ id, name: id, renderer: "cylinder", x: 0, y: 0, z: -9, rot: 0, rotX: 0, rotZ: 0, scaleX: 0.01, scaleY: 0.084, scaleZ: 0.01, footprint: { width: 1, depth: 1 }, height: 1, ...extra });
// Parked under the car on purpose: a carried record must not collide where it was authored.
const records = [...SCENE_OBJECTS, cube("Cigarette", { z: 0 }), cube("Lighter", { renderer: "cube", scaleX: 0.02, scaleY: 0.05, scaleZ: 0.012 })];
const spec = structuredClone(EXITCAR_SPEC);
spec.objects = { ...spec.objects,
	Cigarette: { prop: "cig", at: [0, 0, -0.026], along: [0, 0, 1], visible: "cig_vis" },
	Lighter: { prop: "lighter", at: [0.01, -0.014, 0], along: [0, 1, 0], visible: "lit_vis" } };
const sk = skeletonFor(CHARACTER.model), scene = motionScene(records);
let refused = "";
try { validateSpec({ ...spec, objects: { ...spec.objects, Bad: { prop: "pipe", at: [0, 0] } } }, { sk, scene: motionScene([...records, cube("Bad")]) }); } catch (error) { refused = error.message; }
expect("an unknown prop and a bad offset are refused by name", /objects\.Bad\.prop "pipe"/.test(refused) && /objects\.Bad\.at/.test(refused), refused);

const out = compileMotion({ fps: 24, ...spec }, { sk, scene });
const qa = runMotionQa(sk, out, spec);
expect("the scene stays at QA 0 with two carried records", qa.ok && qa.total === 0, JSON.stringify(qa.groups.slice(0, 3)));
const take = bakeTake(sk, out, { position: [0, 0, 0], yaw: 0 });
const cig = take.objects.Cigarette, lit = take.objects.Lighter;
expect("the take carries both records with a visibility track", cig?.vis?.length === 730 && lit?.vis?.length === 730);

// The cigarette's base sits on the filter and its +Y runs to the tip, on every visible frame.
let worst = 0, shown = 0;
for (let f = 0; f < out.frameCount; f++) {
	const d = out.frames[f].diag, props = d.props ?? {};
	if (!cig.vis[f] || !props.cig) continue;
	shown++;
	const base = [cig.pos[f * 3], cig.pos[f * 3 + 1], cig.pos[f * 3 + 2]];
	const [x, y, z, w] = cig.quat.subarray(f * 4, f * 4 + 4);
	const up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
	const tip = base.map((v, i) => v + up[i] * 0.084);
	worst = Math.max(worst, dist(base, props.cig.filter), dist(tip, props.cig.tip));
}
expect("the cigarette runs from the filter to the tip (< 2 mm) while shown", shown > 100 && worst < 0.002, `${shown} frames, worst ${(worst * 1000).toFixed(2)} mm`);
const firstOn = cig.vis.indexOf(1);
expect("it is hidden in the pocket before the hand takes it out", firstOn > 440 && cig.vis[0] === 0, `first shown f${firstOn}`);
expect("the lighter goes back to the pocket (shown, then hidden again)", lit.vis.indexOf(1) > 0 && lit.vis.lastIndexOf(1) < 729);

// Playback: hidden while the channel is off, on the prop while it is on.
const tracks = new Map(Object.entries(take.objects).map(([id, t]) => [id, { frameCount: 730, ...t }]));
const at = f => sceneObjectsAt(records, f, { frameCount: 730, fps: 24, objectTracks: tracks }).find(o => o.id === "Cigarette");
expect("playback hides the cigarette before it is taken out", at(0).hidden === true);
const f5 = firstOn + 5, take5 = { frameCount: 730, fps: 24, objectTracks: tracks };
const m = sceneObjectTravelMatrixAt(records, "Cigarette", f5, take5);
expect("the renderer shows it on the hand once taken out", at(f5).hidden !== true && trackShown("Cigarette", f5, take5) && !trackShown("Cigarette", 0, take5)
	&& dist([m.elements[12], m.elements[13], m.elements[14]], Array.from(cig.pos.subarray(f5 * 3, f5 * 3 + 3))) < 1e-6);
void apply;

if (failures) { console.error(`${failures} carried-prop check(s) failed`); process.exit(1); }
console.log("motion3 carried props: all checks passed");
