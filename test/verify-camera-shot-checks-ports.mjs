#!/usr/bin/env node
// depth-staging review fixes (PR #17): the props camera.checkShots measures
// through the editor's bounds port.
// 1. A prop on an authored path is timed over the timeline's length. The port
//    (App.jsx studioBounds, mirrored here) reads state.frameCount, so the
//    check carries frameCount in the bounds state and in the sample state the
//    sight test uses. Without it the port clamps the prop to frame 0, and a
//    cart that rolls into the sight line late in the shot was missed.
// 2. The Studio's timeline flags build their scene with checkScene, the
//    command's own builder: the bounds port measures an attached or
//    path-driven prop. Without the port the prop has no box and the shot
//    read clean.
import assert from "node:assert/strict";
import { createSceneObject } from "../src/scene-objects.js";
import { createCharacterEntry } from "../src/scenes.js";
import { createShot } from "../src/cuts.js";
import { objectTransformAt } from "../src/object-path.js";
import { checkShots, sampleFrames } from "../src/camera-depth/shot-checks.js";
import { checkScene, propBoxes } from "../src/camera-depth/scene.js";

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`ok - ${label}`); };
const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const mara = createCharacterEntry({ id: "mara", subject: "Mara", x: 0, z: 0, rot: 0 });
const EYE_Y = 0.93 * 1.8;
const camera = { pos: { x: 0, y: 1.6, z: 5 }, yaw: 0, pitch: Math.atan2(EYE_Y - 1.6, 5), fovDeg: 30 };
const shot = { ...createShot("Hero", 0, 95, [{ id: "k", frame: 0, framing: camera }]), id: "hero", subjectIds: ["mara"] };
// The editor's port for a routed prop, as App.jsx studioBounds measures it: its path at the frame, timed over state.frameCount.
const box = (o) => ({ min: { x: o.x - (o.footprint.width * o.scaleX) / 2, y: 0, z: o.z - (o.footprint.depth * o.scaleZ) / 2 }, max: { x: o.x + (o.footprint.width * o.scaleX) / 2, y: o.height * o.scaleY, z: o.z + (o.footprint.depth * o.scaleZ) / 2 } });
const studioBounds = ({ entity, frame, state }) => {
	if (entity.attach) return box({ ...entity, x: 0, z: 2.5 }); // the editor's evaluated attachment frame
	const at = objectTransformAt(entity, frame, { frameCount: state.frameCount, fps: 24 });
	return box(at ? { ...entity, ...at } : entity);
};
// A cart rolls from 6 m off to the right onto Mara's sight line, arriving at the last frame of a 96-frame timeline.
const cart = { ...createSceneObject("cube"), id: "cart", name: "Cart", x: 6, z: 2.5, scaleX: 0.8, scaleY: 3, scaleZ: 0.8,
	path: { points: [{ x: 6, y: 0, z: 2.5 }, { x: 0, y: 0, z: 2.5 }], speed: 0 } };

check("the bounds state carries the timeline length: the cart is where its path puts it at each frame", () => {
	const [early] = propBoxes([cart], [mara], { frame: 0, frameCount: 96, bounds: studioBounds });
	const [late] = propBoxes([cart], [mara], { frame: 95, frameCount: 96, bounds: studioBounds });
	assert.ok(Math.abs((early.box.min.x + early.box.max.x) / 2 - 6) < 0.01, JSON.stringify(early.box));
	assert.ok(Math.abs((late.box.min.x + late.box.max.x) / 2) < 0.01, `at frame 95 the cart is on the line: ${JSON.stringify(late.box)}`);
});

check("camera.checkShots flags the cart that reaches the sight line late in the shot (frameCount through propBoxes and the sight test)", () => {
	const report = checkShots([shot], checkScene({ characters: [mara], objects: [cart], filmback, frameCount: 96 }, { bounds: studioBounds }));
	const [issue] = report.shots[0].issues;
	assert.equal(issue?.rule, "occluded", JSON.stringify(report.shots[0].issues));
	assert.deepEqual(issue.by, ["cart"]);
	assert.ok(issue.frames.includes(95) && !issue.frames.includes(0), `blocked late, not at the start: ${issue.frames}`);
	const timed = checkShots([shot], { cast: [mara], objects: [cart], filmback, bounds: studioBounds });
	assert.equal(timed.issueCount, 0, "without frameCount the port clamps the cart to frame 0 (the old answer, kept to show what was missed)");
});

check("the timeline flags' scene (checkScene) measures an attached prop through the bounds port; without it the shot read clean", () => {
	const tray = { ...createSceneObject("cube"), id: "tray", name: "Tray", x: 0, z: 0, scaleX: 1.2, scaleY: 3, scaleZ: 0.4, attach: { characterId: "joon", bone: "RightHand" } };
	const joon = createCharacterEntry({ id: "joon", subject: "Joon", x: 3, z: 3, rot: 0 });
	const view = { characters: [mara, joon], objects: [tray], filmback, frameCount: 96 };
	const flagged = checkShots([shot], checkScene(view, { bounds: studioBounds }));
	assert.deepEqual(flagged.shots[0].issues.map((row) => [row.rule, row.by]), [["occluded", ["tray"]]]);
	assert.equal(flagged.shots[0].issues[0].frames.length, sampleFrames(shot).length);
	assert.equal(checkShots([shot], { cast: [mara, joon], objects: [tray], filmback }).issueCount, 0, "the old UI scene: no port, no box, a blocked shot read clean");
	assert.deepEqual(Object.keys(checkScene(view, { bounds: studioBounds })).sort(), ["bounds", "cast", "filmback", "frameCount", "objects"]);
});

console.log(`\n${passed} checks passed (depth-staging bounds port: path timing and the timeline scene)`);
