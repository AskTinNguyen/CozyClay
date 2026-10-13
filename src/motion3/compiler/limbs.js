// Two-bone limb IK, foot orientation, wrist and finger posing on a world-space state.
// Every edit rotates a bone's subtree about that bone's own joint, so the result maps
// exactly back to local quaternions (skeleton.js toLocal).
import { add, sub, scale, dot, len, norm, cross, clamp, apply, T, align, axisRot, ry, rx } from "./math.js";
import { rotateSubtree } from "./skeleton.js";

/** Direction fixed to bone b that points along `restDir` in the rest pose. */
export const carried = (sk, s, b, restDir) => apply(s.R[b], apply(T(sk.restWorldRot[b]), restDir));

/** Solve root-mid-end so `end` lands on `target` (clamped to reach), bending toward `pole`.
 * `pole0` is the limb's current bend reference carried by the upper bone. Returns the miss (m). */
export function twoBone(sk, s, root, mid, end, target, pole, restBend) {
	const Rt = s.P[root], M = s.P[mid], E = s.P[end];
	const a = len(sub(M, Rt)), b = len(sub(E, M));
	const v = sub(target, Rt), d = len(v), u = scale(v, 1 / Math.max(d, 1e-9));
	const dc = clamp(d, Math.abs(a - b) + 1e-4, (a + b) * 0.9995);
	const l = (a * a - b * b + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(a * a - l * l, 0));
	const pv = norm(sub(pole, scale(u, dot(pole, u))));
	const Mn = add(Rt, add(scale(u, l), scale(pv, h)));
	const p0 = carried(sk, s, root, restBend);
	rotateSubtree(sk, s, root, Rt.slice(), align(sub(M, Rt), p0, sub(Mn, Rt), pv));
	const p1 = carried(sk, s, mid, restBend);
	const Tn = add(Rt, scale(u, dc));
	rotateSubtree(sk, s, mid, s.P[mid].slice(), align(sub(s.P[end], s.P[mid]), p1, sub(Tn, s.P[mid]), pv));
	return d - dc;
}

/** Aim a foot: Foot->ToeBase along yaw/pitch of its rest direction, sole kept level. */
export function orientFoot(sk, s, side, yawDeg, pitchDeg) {
	const foot = sk.index[`${side}Foot`], toe = sk.index[`${side}ToeBase`];
	const rest = sub(sk.restWorldPos[toe], sk.restWorldPos[foot]);
	const want = apply(ry(yawDeg), apply(rx(pitchDeg), rest));
	// level the sole: the foot's own carried up vector goes to world up (no roll from the leg IK)
	rotateSubtree(sk, s, foot, s.P[foot].slice(), align(sub(s.P[toe], s.P[foot]), carried(sk, s, foot, [0, 1, 0]), want, [0, 1, 0]));
	// Toe-off: bend the toe joint so the toes stay flat on the ground while the heel rises.
	const tip = sk.index[`${side}Toe_End`];
	if (pitchDeg > 0 && tip !== undefined) {
		const seg = sub(s.P[tip], s.P[toe]), flat = [seg[0], 0, seg[2]];
		if (len(flat) > 1e-6) rotateSubtree(sk, s, toe, s.P[toe].slice(), align(seg, [0, 1, 0], flat, [0, 1, 0]));
	}
}

export function palmAxes(sk, s, side) {
	const h = sk.index[`${side}Hand`], m1 = sk.index[`${side}HandMiddle1`];
	const d = norm(sub(s.P[m1], s.P[h]));
	let l = sub(s.P[sk.index[`${side}HandIndex1`]], s.P[sk.index[`${side}HandPinky1`]]);
	l = norm(sub(l, scale(d, dot(l, d))));
	return { d, l, n: cross(d, l) };
}

/** Wrist twist (about the forearm) and flex (about the knuckle line), degrees, clamped. */
export function wrist(sk, s, side, twistDeg, flexDeg) {
	if (!twistDeg && !flexDeg) return;
	const h = sk.index[`${side}Hand`], fa = sk.index[`${side}ForeArm`];
	const axT = norm(sub(s.P[h], s.P[fa]));
	const { l } = palmAxes(sk, s, side);
	const axF = norm(sub(l, scale(axT, dot(l, axT))));
	rotateSubtree(sk, s, h, s.P[h].slice(), axisRot(axF, clamp(flexDeg, -70, 70)));
	rotateSubtree(sk, s, h, s.P[h].slice(), axisRot(axT, clamp(twistDeg, -85, 85)));
}

// Finger curl presets, degrees per phalanx (1, 2, 3); thumb is [opposition, curl, curl].
const FINGER_PRESETS = {
	relaxed: { Index: [12, 18, 10], Middle: [15, 20, 12], Ring: [18, 22, 12], Pinky: [20, 24, 14], Thumb: [15, 10, 8] },
	fist: { Index: [80, 95, 60], Middle: [85, 95, 60], Ring: [85, 95, 60], Pinky: [85, 95, 60], Thumb: [45, 30, 35] },
	grip: { Index: [55, 60, 35], Middle: [60, 62, 35], Ring: [62, 62, 35], Pinky: [65, 62, 35], Thumb: [40, 20, 20] },
	cigarette: { Index: [8, 10, 6], Middle: [10, 12, 8], Ring: [60, 75, 45], Pinky: [65, 80, 45], Thumb: [35, 25, 20] },
	point: { Index: [0, 0, 0], Middle: [80, 95, 60], Ring: [85, 95, 60], Pinky: [85, 95, 60], Thumb: [40, 30, 30] },
};

/** Blend presets by weight over `relaxed` and curl every finger toward the palm. */
export function fingers(sk, s, side, weights) {
	const base = FINGER_PRESETS.relaxed, sign = side === "Left" ? -1 : 1;
	const curl = (f, k) => base[f][k] + Object.entries(weights ?? {}).reduce((acc, [p, w]) => acc + (w || 0) * ((FINGER_PRESETS[p]?.[f]?.[k] ?? base[f][k]) - base[f][k]), 0);
	for (const f of ["Index", "Middle", "Ring", "Pinky", "Thumb"]) {
		for (let k = 0; k < 3; k++) {
			const j = sk.index[`${side}Hand${f}${k + 1}`];
			if (j === undefined) continue;
			const { l, d } = palmAxes(sk, s, side);
			const ax = f === "Thumb" && k === 0 ? d : l;
			rotateSubtree(sk, s, j, s.P[j].slice(), axisRot(ax, sign * curl(f, k)));
		}
	}
}

