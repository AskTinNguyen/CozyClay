// Collision proxies for motion QA: body capsules on Mixamo joints, scene objects as oriented
// boxes (base pivot = bottom centre, CozyClay convention), the head as the measured ellipsoid.
import { add, sub, scale, dot, len, apply, T, clamp } from "../compiler/math.js";
import { bonePoint } from "../compiler/skeleton.js";

// [part, from joint, to joint, radius m]. Radii are fitted to the X/Y Bot skin.
export const CAPSULES = [
	["torso_lo", "Spine", "Spine2", 0.12], ["torso_hi", "Spine2", "Neck", 0.105], ["hips", "LeftUpLeg", "RightUpLeg", 0.095],
	["neck", "Neck", "Head", 0.055],
	...["Left", "Right"].flatMap(S => {
		const k = S === "Left" ? "l" : "r";
		return [[`thigh_${k}`, `${S}UpLeg`, `${S}Leg`, 0.07], [`shin_${k}`, `${S}Leg`, `${S}Foot`, 0.05],
			[`uarm_${k}`, `${S}Arm`, `${S}ForeArm`, 0.042], [`farm_${k}`, `${S}ForeArm`, `${S}Hand`, 0.033],
			[`hand_${k}`, `${S}Hand`, `${S}HandMiddle3`, 0.022]];
	}),
];

export const segPoints = (a, b, n = 9) => Array.from({ length: n }, (_, i) => add(a, scale(sub(b, a), i / (n - 1))));

/** Signed distance from p to a box (negative inside). */
export function sdBox(p, box) {
	const q = apply(T(box.R), sub(p, box.pos));
	const c = [0, box.half[1], 0];
	const d = [Math.abs(q[0] - c[0]) - box.half[0], Math.abs(q[1] - c[1]) - box.half[1], Math.abs(q[2] - c[2]) - box.half[2]];
	const outside = len([Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)]);
	return outside + Math.min(Math.max(d[0], d[1], d[2]), 0);
}

export function segDist(p1, q1, p2, q2) {
	let best = Infinity;
	const d2 = sub(q2, p2), dd = dot(d2, d2);
	for (const a of segPoints(p1, q1)) {
		const u = dd < 1e-12 ? 0 : clamp(dot(sub(a, p2), d2) / dd, 0, 1);
		best = Math.min(best, len(sub(a, add(p2, scale(d2, u)))));
	}
	return best;
}

/** Depth (m) of point p inside the head ellipsoid, negative when outside. */
export function headDepth(sk, s, p) {
	const c = bonePoint(s, sk.index.Head, sk.landmarks.headCentre), R = s.R[sk.index.Head];
	const q = apply(T(R), sub(p, c)), r = sk.landmarks.headRadii;
	const v = len([q[0] / r[0], q[1] / r[1], q[2] / r[2]]);
	return (1 - v) * Math.min(...r);
}

/** Sole points carried by a foot: heel (below the ankle) and toe tip, from the rest pose. */
export function solePoints(sk, s, side) {
	const I = sk.index, P = sk.restWorldPos;
	const foot = I[`${side}Foot`], toeEnd = I[`${side}Toe_End`] ?? I[`${side}ToeBase`];
	const heelRest = [P[foot][0], 0.005, P[foot][2] - 0.045];
	const heelLocal = apply(T(sk.restWorldRot[foot]), sub(heelRest, P[foot]));
	return { heel: bonePoint(s, foot, heelLocal), ball: s.P[I[`${side}ToeBase`]], tip: s.P[toeEnd] };
}
