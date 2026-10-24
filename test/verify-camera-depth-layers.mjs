#!/usr/bin/env node
// depth-staging A4: the depth bands of a frame (src/camera-depth/layers.js).
// A camera 6 m in front of Mara: a lamp halfway (foreground), Joon beside her
// (midground), a window 3 m behind her (background); the floor, a room around
// everyone, a prop behind the lens and one off frame are in no band. The
// bands are read through camera.checkShots' report, worded for the brief, and
// the plan diagram rings the foreground of the current shot.
import assert from "node:assert/strict";
import { createSceneObject } from "../src/scene-objects.js";
import { createCharacterEntry } from "../src/scenes.js";
import { createShot } from "../src/cuts.js";
import { depthLayers, depthWords, shotLayers } from "../src/camera-depth/layers.js";
import { castBoxes, propBoxes } from "../src/camera-depth/scene.js";
import { checkShot } from "../src/camera-depth/shot-checks.js";
import { planDiagramLayout } from "../src/plan-diagram.js";

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`ok - ${label}`); };
const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const prop = (kind, fields) => ({ ...createSceneObject(kind), ...fields });
const mara = createCharacterEntry({ id: "mara", subject: "Mara, a woman in a red raincoat", x: 0, z: 0, rot: 0 }), joon = createCharacterEntry({ id: "joon", subject: "Joon", x: 1.2, z: 0.3, rot: -90 });
const camera = { pos: { x: 0.3, y: 1.6, z: 6 }, yaw: 0.05, pitch: -0.03, fovDeg: 34 };
const set = [
	prop("cylinder", { id: "lamp", name: "Floor lamp", x: -0.8, z: 3, scaleX: 0.3, scaleY: 1.6, scaleZ: 0.3 }),
	prop("cube", { id: "window", name: "Window", x: 0, z: -3, scaleX: 2.4, scaleY: 2.2, scaleZ: 0.1 }),
	prop("plane", { id: "floor", name: "Floor", scaleX: 20, scaleZ: 20 }),
	prop("cube", { id: "room", name: "Room", x: 0, z: 0, scaleX: 30, scaleY: 6, scaleZ: 30 }),
	prop("cube", { id: "crate", name: "Crate", x: 0, z: 8 }),
	prop("cube", { id: "far-left", name: "Shelf", x: -12, z: 0 }),
];

check("bands around the subject: the lamp in front, Joon level with her, the window behind; the set itself in none", () => {
	const people = castBoxes([mara, joon]), subject = people[0].row;
	const layers = depthLayers(camera, subject, [...people, ...propBoxes(set, [mara, joon])], filmback.aspectRatio);
	assert.deepEqual(layers.foreground.map((row) => row.id), ["lamp"]);
	assert.deepEqual(layers.midground.map((row) => row.id), ["joon"]);
	assert.deepEqual(layers.background.map((row) => row.id), ["window"]);
	assert.ok(layers.depthM > 5.8 && layers.depthM < 6.1 && Math.abs(layers.bandM - layers.depthM / 4) < 0.01, JSON.stringify(layers));
	assert.equal(depthWords(layers, "Mara"), "the floor lamp soft in the foreground, Joon level with Mara, the window behind");
	const moved = depthLayers(camera, subject, castBoxes([mara, { ...joon, x: 0.6, z: 4.2 }]), filmback.aspectRatio);
	assert.equal(depthWords(moved, "Mara"), "Joon's shoulder soft in the foreground", "a person in front reads as a shoulder");
	assert.equal(depthWords(depthLayers(camera, subject, castBoxes([mara]), filmback.aspectRatio)), null, "a frame of the subject alone has no depth words");
});

check("the shot check report carries the layers of the shot's opening camera; the plan diagram rings the foreground", () => {
	const shot = { ...createShot("Hero", 0, 47, [{ id: "k", frame: 0, framing: camera }]), id: "hero", subjectIds: ["mara"] };
	const report = checkShot(shot, { cast: [mara, joon], objects: set, filmback });
	assert.deepEqual([report.layers.foreground, report.layers.midground, report.layers.background].map((band) => band.map((row) => row.name)), [["Floor lamp"], ["Joon"], ["Window"]]);
	assert.deepEqual(shotLayers(shot, camera, "mara", { cast: [mara, joon], objects: set, aspectRatio: filmback.aspectRatio }), report.layers);
	const layout = planDiagramLayout({ frame: 0, camera: null, characters: [mara, joon], objects: set, shotDocument: { shots: [shot] } }, { currentShotId: "hero" });
	assert.deepEqual(layout.primitives.filter((row) => row.kind === "foreground").map((row) => [row.id, row.label, row.center]), [["lamp", "Floor lamp", { x: -0.8, z: 3 }]]);
});

console.log(`\n${passed} checks passed (depth-staging A4 depth layers)`);
