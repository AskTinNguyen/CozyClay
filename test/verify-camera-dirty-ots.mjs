// Camera polish A2: a dirty over-the-shoulder. Projected through the framing,
// the target's eyes sit on the far vertical third and the upper third line,
// and the foreground character's near shoulder covers a quarter to a third of
// the frame from the near edge, for both sides, two lenses and two speaker
// distances. Shot-reverse-shot cuts stay clean (test/bus/verify-camera-coverage.mjs).
import assert from "node:assert/strict";
import { shoulderFraming } from "../src/camera-techniques/framing.js";
import { eyePoint, framingOf, projectPoint } from "../src/camera-coverage/composition.js";
import { SUBJECT_HEIGHT_M } from "../src/shot.js";

const filmback = { aspectRatio: 16 / 9 };
let passed = 0;
const rows = [];

for (const gap of [1.4, 2.4]) {
	for (const side of ["right", "left"]) {
		for (const focalMm of [35, 50]) {
			const over = { x: 0, z: 0, rot: 90, height: SUBJECT_HEIGHT_M }, target = { x: gap, z: 0, rot: -90, height: SUBJECT_HEIGHT_M };
			const exact = shoulderFraming(target, over, { side, size: "medium close-up", focalMm }, filmback), framing = framingOf(exact, filmback);
			const eyes = projectPoint(framing, eyePoint(target), filmback.aspectRatio), farX = side === "left" ? -1 / 3 : 1 / 3;
			assert.ok(Math.abs(eyes.x - farX) < 0.02 && Math.abs(eyes.y - 1 / 3) < 0.02, `${gap} m ${side} ${focalMm}mm: eyes at ${eyes.x.toFixed(3)}, ${eyes.y.toFixed(3)}`);
			// The shoulder's inner edge, independently: 0.23 m to the camera's side of the listener's axis, at shoulder height.
			const toCamera = Math.sign((exact.position.z - over.z) || 1), edge = { x: over.x, y: 0.82 * SUBJECT_HEIGHT_M, z: over.z + toCamera * 0.23 };
			const shoulder = projectPoint(framing, edge, filmback.aspectRatio), cover = side === "left" ? (1 - shoulder.x) / 2 : (1 + shoulder.x) / 2;
			assert.ok(shoulder.depth > 0 && cover >= 0.25 && cover <= 0.4, `${gap} m ${side} ${focalMm}mm: shoulder covers ${cover.toFixed(3)}`);
			assert.ok(shoulder.y > -1 && shoulder.y < 0, `${gap} m ${side} ${focalMm}mm: the shoulder top is in the lower half (${shoulder.y.toFixed(3)})`);
			assert.ok(Math.sign(eyes.x) !== Math.sign(shoulder.x), "shoulder and eyes on opposite halves");
			assert.equal(exact.focalMm, focalMm, "an asked lens is kept");
			const behind = -(exact.position.x - over.x);
			assert.ok(behind > 0 && Math.hypot(exact.position.x - over.x, exact.position.z - over.z) < 1, "the camera stands behind the listener, within a metre");
			rows.push(`${gap} m ${side} ${focalMm}mm: eyes ${eyes.x.toFixed(2)},${eyes.y.toFixed(2)} shoulder ${(cover * 100).toFixed(0)}%`);
			passed += 1;
		}
	}
}
console.log(`PASS dirty OTS framings\n  ${rows.join("\n  ")}`);

// The automatic lens (no focalMm) still frames the size and reports what it reached.
const auto = shoulderFraming({ x: 2.4, z: 0, rot: -90 }, { x: 0, z: 0, rot: 90 }, { side: "right", size: "medium close-up" }, filmback);
assert.ok(auto.shoulderCover >= 0.25 && auto.shoulderCover <= 0.4, `auto lens covers ${auto.shoulderCover}`);
assert.ok(auto.focalMm > 35 && auto.focalMm < 75, `auto lens ${auto.focalMm}`);
console.log(`PASS automatic lens: ${auto.focalMm.toFixed(1)} mm, shoulder ${auto.shoulderCover}`);

console.log(`${passed + 1} checks passed (camera-polish A2 dirty OTS)`);
