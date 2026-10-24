// A1: the shot camera carries roll, static or keyed (rig keys ease like camera
// keys). It survives save and reload (older bodies unchanged), samples in
// sampleAt (the viewport camera, the preview and captures all apply that
// sample), names itself in classifyMove / moveSequencePhrase, and travels in
// every export: camera.json, the USD camera and OTIO metadata.
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCameraBlock, updateCameraBlock } from "../src/camera-block.js";
import { framingRecord } from "../src/camera-capabilities/words.js";
import { classifyMove, easeInOut, moveSequencePhrase } from "../src/camera-move.js";
import { keyframePackEntries } from "../src/keyframe-pack.js";
import { shotMetadata } from "../src/otio.js";
import { sampleAt } from "../src/sample-at.js";
import { readShotAuthoring, serializeShotAuthoring } from "../src/shot-authoring.js";
import { shotCaptureMeta } from "../src/shot-meta.js";
import { buildShotPrompt } from "../src/shot-prompt.js";
import { serializeUsdCamera } from "../src/usd-camera.js";
import { check, done, framingAt, heldFraming, makeScene, makeShot, mara, project } from "./camera-capabilities-fixture.mjs";

const scene = makeScene();
const keyed = makeShot({ rigKeys: [{ offset: 0, rollDeg: 0 }, { offset: 48, rollDeg: 24, ease: "linear" }, { offset: 72, rollDeg: -10 }] });
const dutch = makeShot({ rollDeg: 20 });

check("roll is stored on the camera block, saved and reloaded; a level body stays byte-identical", () => {
	const doc = { shots: [keyed, { ...dutch, id: "shot-b", startFrame: 100, endFrame: 150, cameraKeys: [{ id: "key-b", frame: 100, framing: heldFraming }] }], frameCount: 160 };
	const state = readShotAuthoring(serializeShotAuthoring(doc)).state;
	assert.deepEqual(state.shots[0].camera.rigKeys, keyed.camera.rigKeys);
	assert.equal(state.shots[1].camera.rollDeg, 20);
	const level = { shots: [makeShot()], frameCount: 96 }, once = serializeShotAuthoring(level);
	assert.equal(serializeShotAuthoring(readShotAuthoring(once).state), once);
	assert.ok(!once.includes("rollDeg"), "no roll field on a level camera");
	assert.equal(updateCameraBlock(createCameraBlock({ rollDeg: 20 }), { rollDeg: null }).rollDeg, undefined, "a null patch levels the camera");
	assert.equal(createCameraBlock({ rollDeg: 400 }).rollDeg, 90, "roll clamps to a quarter turn");
});

check("sampling: a static roll holds; rig keys interpolate with the camera-key eases", () => {
	assert.equal(sampleAt(scene, dutch, 30).camera.rollDeg, 20);
	assert.equal(sampleAt(scene, makeShot(), 30).camera.rollDeg, undefined, "a level camera has no roll field");
	assert.equal(sampleAt(scene, keyed, 12).camera.rollDeg, 24 * easeInOut(0.25), "the segment from offset 0 eases in and out");
	assert.equal(sampleAt(scene, keyed, 60).camera.rollDeg, 24 + (-10 - 24) * 0.5, "the segment from offset 48 is linear");
	assert.equal(sampleAt(scene, keyed, 90).camera.rollDeg, -10, "after the last key the roll holds");
});

check("a positive roll turns the camera counter-clockwise: the horizon falls to the right of the frame", () => {
	const camera = sampleAt(scene, dutch, 0).camera, left = project(camera, { x: -40, y: 0, z: -60 }), right = project(camera, { x: 40, y: 0, z: -60 });
	assert.ok(right.y < left.y - 0.1, `right ${right.y.toFixed(3)} sits below left ${left.y.toFixed(3)}`);
});

check("classifyMove and moveSequencePhrase name a roll change", () => {
	const a = { ...heldFraming, rollDeg: 0 }, b = { ...heldFraming, rollDeg: 25 };
	const roll = classifyMove(a, b, mara);
	assert.equal(roll.id, "roll");
	assert.match(moveSequencePhrase([roll]), /a roll, the camera turning 25 degrees about the lens until the horizon is falling to the right/);
	const push = classifyMove(a, { ...framingAt({ x: 0.2, y: 1.6, z: 1.4 }, { x: 0, y: 1.5, z: 0 }), rollDeg: -15 }, mara);
	assert.equal(push.id, "push-in");
	assert.match(push.phrase, /push-in .*, rolling 15 degrees until the horizon is falling to the left/);
	assert.equal(classifyMove(heldFraming, heldFraming, mara).id, "static", "level framings are unchanged");
});

check("camera.json (keyframe pack) carries roll in its framings and the stored rig", () => {
	const meta = shotCaptureMeta({ shot: keyed, fps: 24, aspectKey: "16:9", cast: [mara] });
	const entries = keyframePackEntries({ shot: { title: "Test", index: 1, startFrame: 0, endFrame: 95 }, fps: 24, firstFramePng: new Uint8Array(4), lastFramePng: null, clip: null,
		camera: { ...meta, framing: { start: framingRecord(sampleAt(scene, keyed, 0).camera), end: framingRecord(sampleAt(scene, keyed, 95).camera) } }, prompt: buildShotPrompt(meta) });
	const json = JSON.parse(entries.find((entry) => entry.name.endsWith("camera.json")).data);
	assert.equal(json.framing.end.rollDeg, -10);
	assert.equal(json.framing.start.rollDeg, undefined, "a level frame carries no roll");
	assert.deepEqual(json.capabilities.rigKeys, keyed.camera.rigKeys);
	assert.match(entries.find((entry) => entry.name.endsWith("prompt.txt")).data, /RIG: the camera rolls from 0 to -10 degrees/);
});

check("the USD camera orients with roll (qY * qX * qZ, as three's YXZ) and records cozyclay:rollDeg per frame", () => {
	const usd = serializeUsdCamera(scene, dutch), camera = sampleAt(scene, dutch, 0).camera;
	const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(camera.pitch, camera.yaw, (20 * Math.PI) / 180, "YXZ"));
	const orient = usd.match(/quatf xformOp:orient = \(([^)]+)\)/)[1].split(", ").map(Number);
	[q.w, q.x, q.y, q.z].forEach((value, i) => assert.ok(Math.abs(value - orient[i]) < 1e-9, `component ${i}: ${value} vs ${orient[i]}`));
	assert.match(usd, /custom float cozyclay:rollDeg = 20\n/);
	assert.match(usd, /custom float cozyclay:rollDeg.timeSamples = \{\n {8}0: 20,/);
	const keyedUsd = serializeUsdCamera(scene, keyed);
	assert.match(keyedUsd, / {8}60: 7,/, "keyed roll is sampled per frame");
	assert.ok(!serializeUsdCamera(scene, makeShot()).includes("rollDeg"), "a level camera writes no roll");
});

check("OTIO metadata carries the start-frame roll and the stored rig", () => {
	const metadata = shotMetadata(scene, dutch);
	assert.equal(metadata.camera.rollDeg, 20);
	assert.equal(metadata.capabilities.rollDeg, 20);
	assert.equal(shotMetadata(scene, makeShot()).capabilities, undefined);
});

done("A1 roll");
