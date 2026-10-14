// The arms' paths over a keyed span (C14, lane K8). What the arm does on a frame the keys lead
// (the holding elbow's swivel, compiler/arm-orient.js; the second hand's roll about the object,
// second-hand.js) is read as a cost per frame on the pose that frame starts from, and the path
// minimises, over all those frames at once, the cost of each frame plus SMOOTH times the squared
// acceleration of the point that choice moves (the elbow; the free end of the second hand): where
// the cost barely cares the arm glides, where it does the arm goes where the wrist needs it. The
// best choice alone can move 20 deg from one frame to the next while a bat whips through the
// zone, and an arm that followed it would jerk (QA POP). Solved by NEWTON Gauss-Newton steps from
// each frame's soft minimum, each a banded (5-diagonal) linear solve. Every frame reads the same
// plan, so a frame still solves on its own (a windowed compile, a frame solved on demand) and the
// same spec gives the same take.
import { holdLandscape } from "./compiler/hold.js";
import { add, sub, scale, dot } from "./compiler/math.js";

const SMOOTH = 1000, NEWTON = 4, STEP = 0.03, MAX_STEP = 0.6, MIN_CURVE = 0.05, SIGMA = 2;

/** Solve the symmetric 5-diagonal system A x = b; A[i][k] is the entry (i, i + k - 2). */
function solveBand(A, b) {
	const n = b.length, x = Array.from(b);
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j <= Math.min(i + 2, n - 1); j++) {
			const m = A[j][i - j + 2] / A[i][2];
			for (let k = i; k <= Math.min(i + 2, n - 1); k++) A[j][k - j + 2] -= m * A[i][k - i + 2];
			x[j] -= m * x[i];
		}
	}
	for (let i = n - 1; i >= 0; i--) {
		for (let k = i + 1; k <= Math.min(i + 2, n - 1); k++) x[i] -= A[i][k - i + 2] * x[k];
		x[i] /= A[i][2];
	}
	return x;
}

/**
 * The angle per frame (radians, frames in a row) that minimises sum cost(i, x_i) + SMOOTH *
 * sum |P(i-1) - 2 P(i) + P(i+1)|^2 with P(i) = point(i, x_i) (metres), from x0 (each frame's own
 * best, unwrapped here so neighbours differ by less than half a turn).
 */
export function smoothPath(cost, point, x0) {
	const n = x0.length, x = x0.slice();
	for (let i = 1; i < n; i++) x[i] = x[i - 1] + Math.atan2(Math.sin(x[i] - x[i - 1]), Math.cos(x[i] - x[i - 1]));
	for (let it = 0; it < NEWTON && n > 2; it++) {
		const A = x.map(() => new Float64Array(5)), b = new Float64Array(n);
		x.forEach((t, i) => {
			const c0 = cost(i, t), cp = cost(i, t + STEP), cm = cost(i, t - STEP);
			A[i][2] = Math.max(MIN_CURVE, (cp + cm - 2 * c0) / (STEP * STEP));
			b[i] = -(cp - cm) / (2 * STEP);
		});
		// linearised: the point moves along tan = dP/dx
		const P = x.map((t, i) => point(i, t)), tan = x.map((t, i) => scale(sub(point(i, t + STEP), point(i, t - STEP)), 1 / (2 * STEP)));
		for (let r = 0; r + 2 < n; r++) {
			const c = [1, -2, 1], acc = add(sub(P[r], scale(P[r + 1], 2)), P[r + 2]);
			for (let p = 0; p < 3; p++) {
				b[r + p] -= 2 * SMOOTH * c[p] * dot(acc, tan[r + p]);
				for (let q = 0; q < 3; q++) A[r + p][q - p + 2] += 2 * SMOOTH * c[p] * c[q] * dot(tan[r + p], tan[r + q]);
			}
		}
		const step = solveBand(A, b);
		x.forEach((t, i) => { x[i] = t + Math.max(-MAX_STEP, Math.min(MAX_STEP, step[i])); });
	}
	return x;
}

/** Values over frames in a row, smoothed by a Gaussian of SIGMA frames (the weights renormalised at the ends). */
export function smoothed(v) {
	return v.map((_, i) => {
		let sum = 0, wsum = 0;
		for (let j = Math.max(0, i - 3 * SIGMA); j <= Math.min(v.length - 1, i + 3 * SIGMA); j++) { const g = Math.exp(-((j - i) ** 2) / (2 * SIGMA * SIGMA)); sum += g * v[j]; wsum += g; }
		return sum / wsum;
	});
}

/**
 * The holding elbow's planned pole per frame, Map f -> world direction, over `frames` (ascending
 * and contiguous, the frames the keys lead). frameAt(f) -> { s, held }: the plain pose of frame f
 * and what the hand holds there (object-keys.js lead).
 */
export function polePlan(sk, side, frames, frameAt) {
	const lands = frames.map(f => { const { s, held } = frameAt(f); return holdLandscape(sk, s, side, held); });
	const th = smoothPath((i, t) => lands[i].at(t).cost, (i, t) => lands[i].at(t).elbow, lands.map(l => l.softmin()));
	return new Map(frames.map((f, i) => [f, lands[i].at(th[i]).pv]));
}
