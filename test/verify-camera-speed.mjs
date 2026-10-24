// A5: a shot's speed retimes how it samples the take (slow motion below 1,
// each shot anchored at its first frame, stills untouched) and is reported for
// the timeline and stated in the prompt; a shutter angle gives the camera the
// poses the open shutter sees (the lens renderer's motion blur, fastest on a
// whip pan) and travels in the exports (USD shutter:open/close, camera.json,
// OTIO metadata).
import assert from "node:assert/strict";
import { createCameraBlock } from "../src/camera-block.js";
import { lensPlan } from "../src/camera-capabilities/lens-plan.js";
import { retimeFrame, shotSpeed, speedLabel, takeFrameAt } from "../src/camera-capabilities/speed.js";
import { framingRecord } from "../src/camera-capabilities/words.js";
import { shotMetadata } from "../src/otio.js";
import { sampleAt } from "../src/sample-at.js";
import { readShotAuthoring, serializeShotAuthoring } from "../src/shot-authoring.js";
import { shotCaptureMeta } from "../src/shot-meta.js";
import { buildShotPrompt } from "../src/shot-prompt.js";
import { serializeUsdCamera } from "../src/usd-camera.js";
import { check, done, framingAt, makeScene, makeShot, mara } from "./camera-capabilities-fixture.mjs";

const frames = 200, rootPos = new Float32Array(frames * 3);
for (let i = 0; i < frames; i++) rootPos[i * 3 + 2] = i * 0.02;
const take = { frames, rootPos, anchorX: 0, anchorZ: 0, anchorFrame: 0, rotationDeg: 0 };
const scene = makeScene({ frameCount: frames, motion: take });
const slow = makeShot({ speed: 0.5 }, undefined, [40, 135]);
const after = { ...makeShot({}, undefined, [136, 199]), id: "shot-after" };

check("speed is stored and repaired; 1 is the absent default", () => {
	const state = readShotAuthoring(serializeShotAuthoring({ shots: [slow, after], frameCount: frames })).state;
	assert.equal(state.shots[0].camera.speed, 0.5);
	assert.equal(state.shots[1].camera.speed, undefined);
	assert.equal(createCameraBlock({ speed: 1 }).speed, undefined);
	assert.equal(createCameraBlock({ speed: 0.01 }).speed, 0.1, "clamped to a tenth");
});

check("the shot samples its take at start + (f - start) x speed; the next shot is untouched", () => {
	assert.equal(retimeFrame(slow, 40), 40);
	assert.equal(retimeFrame(slow, 100), 70);
	assert.equal(takeFrameAt([slow, after], 100), 70);
	assert.equal(takeFrameAt([slow, after], 150), 150, "a shot without speed plays the take as is");
	assert.equal(takeFrameAt([slow, after], 20), 20, "a gap plays the take as is");
	const at = sampleAt(scene, slow, 100);
	assert.equal(at.motionFrame, 70);
	assert.ok(Math.abs(at.subject.z - 70 * 0.02) < 1e-6, "the subject stands where the take is at frame 70");
	assert.equal(sampleAt(scene, after, 150).motionFrame, 150);
	assert.equal(shotSpeed({ ...slow, kind: "still" }), 1, "a still holds one picture at any speed");
});

check("the timeline label and the prompt report the speed", () => {
	assert.equal(speedLabel(slow), "0.5×");
	assert.equal(speedLabel(after), null);
	const prompt = buildShotPrompt(shotCaptureMeta({ shot: slow, fps: 24, cast: [mara] }), { target: "video" });
	assert.match(prompt, /RIG: slow motion at 50% speed \(shot at 48 fps\)/);
});

// A whip pan: held, then 90 degrees in five frames at constant speed.
const look = { x: 0, y: 1.5, z: 0 }, from = framingAt({ x: 0, y: 1.6, z: 4 }, look);
const whip = makeShot({ shutterDeg: 270 }, [{ id: "k0", frame: 0, framing: from }, { id: "k1", frame: 20, framing: from, ease: "linear" }, { id: "k2", frame: 25, framing: { ...from, yaw: from.yaw - Math.PI / 2 } }]);

check("a shutter gives the camera the poses the open shutter sees, spread over shutterDeg/360 of a frame", () => {
	const camera = sampleAt(makeScene(), whip, 22).camera, blur = camera.blur;
	assert.equal(camera.shutterDeg, 270);
	assert.equal(blur.length, 9);
	const spreadDeg = Math.abs(blur.at(-1).yaw - blur[0].yaw) * 180 / Math.PI;
	assert.equal(blur[0].yaw, sampleAt(makeScene(), whip, 22 - 0.375).camera.yaw, "the shutter opens 0.375 frame before");
	assert.equal(blur.at(-1).yaw, sampleAt(makeScene(), whip, 22 + 0.375).camera.yaw, "and closes 0.375 frame after");
	assert.ok(spreadDeg > 10, `the whip pan smears ${spreadDeg.toFixed(1)} degrees inside one frame`);
	assert.ok(lensPlan(camera).samples.some((sample) => sample.pose.yaw !== camera.yaw), "the lens renderer draws the smear");
	assert.equal(sampleAt(makeScene(), whip, 10).camera.blur.every((pose) => pose.yaw === from.yaw), true, "a held camera does not smear");
	assert.equal(sampleAt(makeScene(), makeShot(), 22).camera.blur, undefined, "no shutter, no blur poses");
});

check("the shutter value and speed travel in the exports", () => {
	const usd = serializeUsdCamera(makeScene(), whip);
	assert.match(usd, /\n {4}double shutter:close = 0.375\n {4}double shutter:open = -0.375\n/);
	assert.match(usd, /custom float cozyclay:shutterAngleDeg = 270/);
	assert.match(serializeUsdCamera(scene, slow), /custom float cozyclay:speed = 0.5/);
	assert.equal(framingRecord(sampleAt(makeScene(), whip, 22).camera).shutterDeg, 270);
	assert.equal(framingRecord(sampleAt(makeScene(), whip, 22).camera).blur, undefined, "camera.json keeps the value, not the sub-frame poses");
	assert.equal(shotMetadata(makeScene(), whip).capabilities.shutterDeg, 270);
	assert.equal(shotMetadata(makeScene(), whip).camera.blur, undefined);
	assert.equal(shotMetadata(scene, slow).capabilities.speed, 0.5);
	assert.match(buildShotPrompt(shotCaptureMeta({ shot: whip, fps: 24 })), /heavy motion blur \(270-degree shutter\)/);
});

done("A5 shot speed and motion blur");
