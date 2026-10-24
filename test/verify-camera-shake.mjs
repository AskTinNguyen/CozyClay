// A3: a handheld or vehicle shake adds deterministic sample-time motion on top
// of the keyed camera: the same seed and frame give the same pose, no shake
// gives exactly the keyed camera, every channel stays inside its amplitude
// bound, nearby frames differ slightly, editing keys keeps the shake, and the
// exports bake the shaken pose per frame (USD translate and orient samples).
import assert from "node:assert/strict";
import { createCameraBlock } from "../src/camera-block.js";
import { SHAKE_SCALE, shakeOffset } from "../src/camera-capabilities/shake.js";
import { sampleAt } from "../src/sample-at.js";
import { readShotAuthoring, serializeShotAuthoring } from "../src/shot-authoring.js";
import { serializeUsdCamera } from "../src/usd-camera.js";
import { check, done, framingAt, heldFraming, makeScene, makeShot } from "./camera-capabilities-fixture.mjs";

const scene = makeScene();
const handheld = { style: "handheld", amplitude: 0.8, frequency: 1.4, seed: 7 };
const shaky = makeShot({ shake: handheld }), still = makeShot();
const camOf = (shot, frame) => sampleAt(scene, shot, frame).camera;

check("the shake setting is stored and repaired (style, amplitude, frequency, seed)", () => {
	const state = readShotAuthoring(serializeShotAuthoring({ shots: [shaky], frameCount: 96 })).state;
	assert.deepEqual(state.shots[0].camera.shake, handheld);
	assert.deepEqual(createCameraBlock({ shake: { amplitude: 3 } }).shake, { style: "handheld", amplitude: 1, frequency: 1.4, seed: 1 });
	assert.equal(createCameraBlock({ shake: { amplitude: 0 } }).shake, undefined, "zero amplitude is no shake");
	assert.equal(createCameraBlock({ shake: { amplitude: 0.5, style: "vehicle" } }).shake.frequency, 6, "a vehicle rattles faster by default");
});

check("deterministic: the same seed and frame give the same pose; another seed another pose", () => {
	assert.deepEqual(camOf(shaky, 37), camOf(shaky, 37));
	assert.deepEqual(shakeOffset(handheld, 37.5), shakeOffset({ ...handheld }, 37.5));
	const other = camOf(makeShot({ shake: { ...handheld, seed: 8 } }), 37);
	assert.notDeepEqual(other.pos, camOf(shaky, 37).pos);
});

check("no shake is exactly the keyed camera", () => {
	const off = camOf(still, 37);
	assert.deepEqual(off.pos, heldFraming.pos);
	assert.equal(off.yaw, heldFraming.yaw);
	assert.equal(off.rollDeg, undefined);
	assert.deepEqual(shakeOffset(null, 12), { side: 0, up: 0, forward: 0, yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
});

check("every channel stays inside amplitude x its scale, and uses most of it", () => {
	for (const style of ["handheld", "vehicle"]) {
		const shake = { style, amplitude: 0.6, frequency: style === "vehicle" ? 6 : 1.4, seed: 3 }, peak = {};
		for (let frame = 0; frame < 2400; frame += 0.5) {
			for (const [channel, value] of Object.entries(shakeOffset(shake, frame))) peak[channel] = Math.max(peak[channel] ?? 0, Math.abs(value));
		}
		for (const [channel, scale] of Object.entries(SHAKE_SCALE[style])) {
			assert.ok(peak[channel] <= 0.6 * scale + 1e-12, `${style} ${channel} ${peak[channel]} within ${0.6 * scale}`);
			assert.ok(peak[channel] > 0.6 * scale * 0.5, `${style} ${channel} reaches past half its bound`);
		}
	}
	const pos = camOf(shaky, 20).pos, bound = 0.8 * Math.hypot(0.025, 0.02, 0.012);
	assert.ok(Math.hypot(pos.x - heldFraming.pos.x, pos.y - heldFraming.pos.y, pos.z - heldFraming.pos.z) <= bound + 1e-9);
});

check("two nearby frames differ slightly: a breathing operator, not a jump", () => {
	const a = camOf(shaky, 40), b = camOf(shaky, 42), step = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
	assert.ok(step > 1e-4 && step < 0.02, `moved ${step.toFixed(5)} m in two frames`);
	assert.ok(Math.abs(a.rollDeg - b.rollDeg) > 1e-3 && Math.abs(a.rollDeg) <= 0.8 * 0.8 + 1e-9);
});

check("editing the keys keeps the shake: it rides on top of whatever the keys say", () => {
	const moved = framingAt({ x: 1, y: 1.4, z: 2.5 }, { x: 0, y: 1.5, z: 0 });
	const edited = makeShot({ shake: handheld }, [{ id: "key-0", frame: 0, framing: moved }]);
	const before = camOf(shaky, 50), after = camOf(edited, 50);
	assert.ok(Math.abs((after.pos.y - moved.pos.y) - (before.pos.y - heldFraming.pos.y)) < 1e-12, "the same vertical shake on the new framing");
	assert.ok(Math.abs((after.pitch - moved.pitch) - (before.pitch - heldFraming.pitch)) < 1e-12);
	assert.deepEqual(edited.cameraKeys[0].framing, moved, "keys are never rewritten by the shake");
});

check("the USD export bakes the shaken pose frame by frame", () => {
	const usd = serializeUsdCamera(scene, shaky), at = camOf(shaky, 33);
	assert.ok(usd.includes(`        33: (${[at.pos.x, at.pos.y, at.pos.z].map((v) => Number(v.toPrecision(15))).join(", ")}),`), "frame 33 translate is the shaken position");
	assert.match(usd, /custom string cozyclay:shake = "handheld amplitude 0.8 at 1.4 Hz, seed 7 \(baked into xformOp samples\)"/);
	assert.match(usd, /cozyclay:rollDeg.timeSamples/, "the shake's roll is baked too");
});

done("A3 handheld shake");
