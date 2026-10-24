// Camera polish A1: motion blur follows the sweep. A whip pan gets more
// sub-renders than a slow pan (capped), each sub-render's smear is its slice of
// the shutter so the slices tile the whole sweep without gaps, a held camera
// keeps the base count with no smear, and the plan is deterministic.
import assert from "node:assert/strict";
import { blurSweep, lensPlan, smearUv } from "../src/camera-capabilities/lens-plan.js";
import { projectPoint } from "../src/camera-coverage/composition.js";

const DEG = Math.PI / 180;
let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`PASS ${label}`); };

/** The nine shutter poses of a pan turning `degrees` while the shutter is open. */
const pan = (degrees, { fovDeg = 27, pitchDeg = 0 } = {}) => Array.from({ length: 9 }, (_, i) => ({
	pos: { x: 0, y: 1.6, z: 4 }, yaw: (degrees * i / 8) * DEG, pitch: (pitchDeg * i / 8) * DEG, rollDeg: 0, fovDeg,
}));
const camera = (blur) => ({ pos: { x: 0, y: 1.6, z: 4 }, yaw: 0, pitch: 0, fovDeg: 27, focalMm: 50, blur });
const CAPTURE = { samples: 24, maxSamples: 96 }, PREVIEW = { samples: 8, maxSamples: 32 };

check("the sweep reads as a share of the frame", () => {
	assert.ok(Math.abs(blurSweep(pan(27)) - 1) < 1e-9, "a pan of one field of view sweeps one frame");
	assert.equal(blurSweep(pan(0)), 0);
	const dolly = Array.from({ length: 2 }, (_, i) => ({ pos: { x: 0, y: 1.6, z: 4 - i * 0.3 }, yaw: 0, pitch: 0, rollDeg: 0, fovDeg: 27 }));
	assert.ok(blurSweep(dolly) > 0, "travel counts too");
});

check("a whip pan gets more sub-renders than a slow pan, up to the cap", () => {
	const whip = lensPlan(camera(pan(38.8)), CAPTURE), slow = lensPlan(camera(pan(1)), CAPTURE), held = lensPlan(camera(pan(0)), CAPTURE);
	assert.equal(whip.samples.length, 96, `whip ${whip.samples.length}`);
	assert.equal(slow.samples.length, 24, `slow ${slow.samples.length}`);
	assert.equal(held.samples.length, 24);
	const medium = lensPlan(camera(pan(8)), CAPTURE);
	assert.ok(medium.samples.length > 24 && medium.samples.length < 96, `medium ${medium.samples.length}`);
	assert.equal(lensPlan(camera(pan(38.8)), PREVIEW).samples.length, 32, "the preview caps lower");
	assert.equal(lensPlan(camera(pan(38.8)), { samples: 16 }).samples.length, 16, "no maxSamples keeps the asked count");
	console.log(`  whip 38.8° at 27° fov: sweep ${whip.sweep.toFixed(2)} frames, ${whip.samples.length} sub-renders; medium 8°: ${medium.samples.length}`);
});

check("the smears tile the sweep without gaps", () => {
	for (const [degrees, pitchDeg] of [[38.8, 0], [12, 4]]) {
		const plan = lensPlan(camera(pan(degrees, { pitchDeg })), CAPTURE);
		const yaw = plan.samples.reduce((sum, row) => sum + row.smear.yawDeg, 0), pitch = plan.samples.reduce((sum, row) => sum + row.smear.pitchDeg, 0);
		assert.ok(Math.abs(yaw - degrees) < 1e-6, `yaw smears add to ${yaw}, want ${degrees}`);
		assert.ok(Math.abs(pitch - pitchDeg) < 1e-6, `pitch smears add to ${pitch}, want ${pitchDeg}`);
		plan.samples.forEach((row, i) => {
			const centre = (row.pose.yaw / DEG), step = degrees / plan.samples.length;
			assert.ok(Math.abs(centre - (i + 0.5) * step) < 1e-6 && Math.abs(row.smear.yawDeg - step) < 1e-6, `sub-render ${i} sits mid-slice and spans it`);
		});
	}
});

check("a held camera and depth of field alone carry no smear", () => {
	assert.ok(lensPlan(camera(pan(0)), CAPTURE).samples.every((row) => row.smear.yawDeg === 0 && row.smear.pitchDeg === 0));
	const dof = lensPlan({ pos: { x: 0, y: 1.6, z: 4 }, yaw: 0, pitch: 0, fovDeg: 27, focalMm: 50, fStop: 2, focusDistance: 3 }, CAPTURE);
	assert.equal(dof.samples.length, 24);
	assert.ok(dof.samples.every((row) => row.smear === undefined));
});

check("the smear points the way the scene moves on screen, diagonals included", () => {
	// A point straight ahead, then the camera turns left and tilts up by a small step: where does it land?
	const fovDeg = 27, aspect = 16 / 9, hFovDeg = 2 * Math.atan(Math.tan((fovDeg * DEG) / 2) * aspect) / DEG;
	const from = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0, fovDeg }, ahead = { x: 0, y: 1.6, z: -10 };
	for (const [yawDeg, pitchDeg] of [[1, 0], [0, 1], [1, 1], [-1, 1], [1, -1]]) {
		const moved = projectPoint({ ...from, yaw: yawDeg * DEG, pitch: pitchDeg * DEG }, ahead, aspect), start = projectPoint(from, ahead, aspect);
		// NDC spans 2 across the frame, texture space 1: the screen travel in texture units.
		const travel = { u: (moved.x - start.x) / 2, v: (moved.y - start.y) / 2 }, uv = smearUv({ yawDeg, pitchDeg }, hFovDeg, fovDeg);
		assert.ok(Math.sign(uv.u) === Math.sign(travel.u) && Math.sign(uv.v) === Math.sign(travel.v), `yaw ${yawDeg} pitch ${pitchDeg}: smear ${JSON.stringify(uv)} vs travel ${JSON.stringify(travel)}`);
		assert.ok(Math.abs(uv.u - travel.u) < 0.004 && Math.abs(uv.v - travel.v) < 0.004, "and about as long");
	}
	assert.deepEqual(smearUv(undefined, 60, 30), { u: 0, v: 0 });
});

check("the plan is deterministic", () => {
	assert.deepEqual(lensPlan(camera(pan(38.8)), CAPTURE), lensPlan(camera(pan(38.8)), CAPTURE));
});

console.log(`${passed} checks passed (camera-polish A1 blur sweep)`);
