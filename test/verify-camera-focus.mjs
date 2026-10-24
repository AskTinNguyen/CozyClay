// A2: the shot camera carries an aperture and a focus (a distance, or a cast
// member resolved per frame); focus rig keys rack between two subjects over a
// frame range. The lens renderer's plan is off without an aperture, and the
// exports carry focal distance and f-stop (USD focusDistance / fStop,
// camera.json, OTIO metadata).
import assert from "node:assert/strict";
import { easeInOut } from "../src/camera-move.js";
import { focusDistanceTo } from "../src/camera-capabilities/sample.js";
import { lensPlan } from "../src/camera-capabilities/lens-plan.js";
import { facePoint } from "../src/camera-capabilities/mount.js";
import { framingRecord } from "../src/camera-capabilities/words.js";
import { shotMetadata } from "../src/otio.js";
import { sampleAt } from "../src/sample-at.js";
import { readShotAuthoring, serializeShotAuthoring } from "../src/shot-authoring.js";
import { shotCaptureMeta } from "../src/shot-meta.js";
import { buildShotPrompt } from "../src/shot-prompt.js";
import { serializeUsdCamera } from "../src/usd-camera.js";
import { check, done, joon, makeScene, makeShot, mara } from "./camera-capabilities-fixture.mjs";

const scene = makeScene();
const placement = (row, x = row.x, z = row.z) => ({ x, z, rot: row.rot, height: 1.8 });
const rack = makeShot({ lens: { fStop: 1.4 }, rigKeys: [{ offset: 12, focus: { targetId: "char-mara" } }, { offset: 60, focus: { targetId: "char-joon" } }] });

check("aperture and focus are stored, saved and reloaded; junk focus repairs away", () => {
	const shot = makeShot({ lens: { fStop: 2.8, focusTarget: "char-joon" } });
	const state = readShotAuthoring(serializeShotAuthoring({ shots: [rack, { ...shot, id: "shot-b", startFrame: 100, endFrame: 140, cameraKeys: [] }], frameCount: 150 })).state;
	assert.deepEqual(state.shots[0].camera.lens, { fStop: 1.4 });
	assert.deepEqual(state.shots[0].camera.rigKeys, rack.camera.rigKeys);
	assert.deepEqual(state.shots[1].camera.lens, { fStop: 2.8, focusTarget: "char-joon" });
	const junk = readShotAuthoring(serializeShotAuthoring({ shots: [makeShot({ lens: { fStop: -1, focusDistance: "far" }, rigKeys: [{ offset: 3, focus: { distance: -2 } }] })], frameCount: 96 })).state;
	assert.equal(junk.shots[0].camera.lens, undefined);
	assert.equal(junk.shots[0].camera.rigKeys, undefined);
});

check("a focus target resolves per frame to the optical-axis distance to the character's eyes", () => {
	const camera = sampleAt(scene, makeShot({ lens: { fStop: 2, focusTarget: "char-joon" } }), 0).camera;
	assert.equal(camera.fStop, 2);
	assert.ok(Math.abs(camera.focusDistance - focusDistanceTo(camera, facePoint(placement(joon)))) < 1e-3);
	assert.ok(camera.focusDistance > 5.5 && camera.focusDistance < 6.5, `Joon is about 6 m down the lens (${camera.focusDistance})`);
	// A walking proxy figure: the focus follows it as it comes toward the lens.
	const walker = { ...joon, id: "walker", model: "proxy-figure", layer: { waypoints: [{ id: "w1", frame: 95, x: 0.2, z: 1, heading: null }] } };
	const walking = makeScene({ cast: [mara, walker] }), shot = makeShot({ lens: { fStop: 2, focusTarget: "walker" } });
	const near = sampleAt(walking, shot, 95).camera.focusDistance, far = sampleAt(walking, shot, 0).camera.focusDistance;
	assert.ok(far - near > 3, `focus pulls from ${far} to ${near} as the walker approaches`);
	assert.equal(sampleAt(scene, makeShot({ lens: { focusDistance: 4.2 } }), 10).camera.focusDistance, 4.2, "a set distance holds");
	assert.ok(Math.abs(sampleAt(scene, makeShot({ lens: { fStop: 4 } }), 0).camera.focusDistance - focusDistanceTo(camera, facePoint(placement(mara)))) < 1e-3, "an aperture alone holds focus on the subject");
});

check("a rack focus interpolates between the two subjects over the key range", () => {
	const at = (frame) => sampleAt(scene, rack, frame).camera, base = at(0);
	const dMara = focusDistanceTo(base, facePoint(placement(mara))), dJoon = focusDistanceTo(base, facePoint(placement(joon)));
	assert.ok(Math.abs(at(0).focusDistance - dMara) < 1e-3 && Math.abs(at(12).focusDistance - dMara) < 1e-3, "on Mara up to the first key");
	assert.ok(Math.abs(at(60).focusDistance - dJoon) < 1e-3 && Math.abs(at(95).focusDistance - dJoon) < 1e-3, "on Joon from the second key");
	const mid = dMara + (dJoon - dMara) * easeInOut((30 - 12) / 48);
	assert.ok(Math.abs(at(30).focusDistance - mid) < 1e-3, `eased between: ${at(30).focusDistance} vs ${mid}`);
});

check("the lens plan renders depth of field from the aperture, and is off when the aperture is unset", () => {
	assert.equal(lensPlan(sampleAt(scene, makeShot({ lens: { focusDistance: 3 } }), 0).camera), null, "focus alone draws a plain frame");
	assert.equal(lensPlan(sampleAt(scene, makeShot(), 0).camera), null);
	const plan = lensPlan(sampleAt(scene, rack, 0).camera, { samples: 16 });
	assert.equal(plan.samples.length, 16);
	assert.ok(Math.abs(plan.apertureRadiusM - 50 / 1.4 / 2 / 1000) < 1e-4, "a 50 mm lens at f/1.4 opens 17.9 mm");
	assert.ok(plan.samples.every((sample) => Math.hypot(sample.dx, sample.dy) <= plan.apertureRadiusM + 1e-9), "every sub-camera sits on the aperture disc");
});

check("USD carries fStop and per-frame focusDistance; camera.json and OTIO carry them too", () => {
	const usd = serializeUsdCamera(scene, rack);
	assert.match(usd, /\n {4}float fStop = 1.4\n/);
	assert.match(usd, /\n {4}float focusDistance.timeSamples = \{\n/);
	const mid = sampleAt(scene, rack, 30).camera.focusDistance;
	assert.ok(usd.includes(`        30: ${Number(mid.toPrecision(15))},`), "the rack is sampled frame by frame");
	assert.ok(!serializeUsdCamera(scene, makeShot()).includes("fStop"), "a pinhole camera writes no fStop");
	const record = framingRecord(sampleAt(scene, rack, 60).camera);
	assert.equal(record.fStop, 1.4);
	assert.ok(record.focusDistance > 5);
	assert.deepEqual(shotMetadata(scene, rack).capabilities.lens, { fStop: 1.4 });
	assert.equal(shotMetadata(scene, rack).camera.fStop, 1.4);
	const meta = shotCaptureMeta({ shot: rack, fps: 24, cast: [mara, joon] });
	assert.match(buildShotPrompt(meta), /RIG: shallow depth of field at f\/1.4, a rack focus from Mara to Joon/);
});

done("A2 focus and depth of field");
