// A foreground in the frame (depth-staging A3): a named prop or character
// takes a share of the frame width from the near edge, the subject's eyes on
// the far third. Solved by the over-the-shoulder's own solve (framing.js
// solveForeground, camera-polish D2/D6); only the measure differs: the near
// thing's world box, its eight corners projected through the camera, where
// the shoulder solve projects one shoulder point. Pure.
import { SUBJECT_HEIGHT_M } from "../shot.js";
import { framingOf, projectPoint } from "../camera-coverage/composition.js";
import { scaleOf, solveForeground } from "./framing.js";

export const FOREGROUND_SHARE = Object.freeze({ min: 0.1, max: 0.6, default: 0.3 });
const NEAR_M = 0.15, LENS_Y = 1.55;

/** The eight corners of a world box { min, max }. */
export const boxCorners = (box) => [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => ({ x, y, z }))));

/** A character's body as a world box (a column 0.46 m across at its stature), for a foreground or a depth band. */
export function figureBox(row) {
	const s = scaleOf(row), half = 0.23 * s;
	return { min: { x: row.x - half, y: 0, z: row.z - half }, max: { x: row.x + half, y: SUBJECT_HEIGHT_M * s, z: row.z + half } };
}

/**
 * How much of the frame width a box covers from the near edge (side +1: the left edge, -1: the right one)
 * through a stored framing { pos, yaw, pitch, fovDeg }, and the top of the box in NDC (`low`). Only the
 * part of the box inside the frame's height counts: each vertical edge is sampled at nine heights.
 * A box reaching behind the near plane covers everything and has no top in frame.
 */
export function boxCover(framing, box, side, aspectRatio = 16 / 9) {
	const points = [box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].flatMap((z) => Array.from({ length: 9 }, (_, i) => ({ x, y: box.min.y + ((box.max.y - box.min.y) * i) / 8, z }))))
		.map((corner) => projectPoint(framing, corner, aspectRatio));
	if (points.some((point) => point.depth < NEAR_M)) return { cover: 1, low: -Infinity };
	const seen = points.filter((point) => Math.abs(point.y) <= 1);
	return { cover: seen.length ? (1 + Math.max(...seen.map((point) => side * point.x))) / 2 : 0, low: Math.max(...points.map((point) => point.y)) };
}

/**
 * Frame `subject` past `near` ({ id, name, box }), the near thing covering `share` of the frame width
 * from the camera side's edge, the eyes on the far third at the headroom's eye line (`eyeLineY` in NDC).
 * @returns the exact framing ({ position, lookAt, focalMm }) plus foregroundShare (the share reached)
 */
export function foregroundFraming(subject, near, state, filmback, { share = FOREGROUND_SHARE.default, eyeLineY = 1 / 3 } = {}) {
	const side = state.side === "left" ? -1 : 1, aspect = filmback.aspectRatio ?? 16 / 9, box = near.box;
	const anchor = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 }, reach = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
	// A low prop brings the lens down to just over its top, so the frame looks across it at the eyes.
	const s = scaleOf(subject), lensY = Math.min(LENS_Y * s, Math.max(0.6 * s, box.max.y + 0.25));
	const measure = (exact) => boxCover(framingOf(exact, filmback), box, side, aspect);
	const best = solveForeground(subject, anchor, state, filmback, { measure, cover: share, lensY, scale: s, reach, slide: 1, settle: true, depth: 6, far: { x: side / 3, y: eyeLineY } });
	return { ...best.exact, foregroundShare: Math.round(best.cover * 1000) / 1000 };
}
