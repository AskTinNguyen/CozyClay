// One frame of the body: channel values -> world-space bone state.
// Conventions (CozyClay): metres, +Y up, yaw 0 faces +Z, positive yaw turns toward +X,
// the character's left is +X at yaw 0. Body-frame vectors (poles, body-local targets) are
// rotated by the root yaw only.
import { add, sub, scale, norm, len, apply, mul, rx, ry, rz } from "./math.js";
import { restState, rotateSubtree } from "./skeleton.js";
import { twoBone, orientFoot, wrist, fingers } from "./limbs.js";
import { holdHand } from "./hold.js";

export const SIDES = { l: "Left", r: "Right" };
const KNEE_REST = [0, 0, 1], ELBOW_REST = [0, 0, -1];

const v3 = (x, d = [0, 0, 0]) => (Array.isArray(x) || ArrayBuffer.isView(x) ? [x[0], x[1], x[2]] : d);
const num = (x, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** Split a body-frame rotation over a chain of bones, each turning about its own joint. */
function spread(sk, s, bones, yaw, pitch, roll) {
	const k = bones.length;
	for (const name of bones) {
		const b = sk.index[name];
		rotateSubtree(sk, s, b, s.P[b].slice(), mul(ry(yaw / k), mul(rx(pitch / k), rz(roll / k))));
	}
}

// Soft reach (spec.fix.reach): a wrist target up to 5 cm beyond the arm's reach is pulled onto
// the reach sphere through a C1 soft knee, so the arm never snaps straight; the overshoot is
// recorded. Farther targets are staging errors and stay for QA (REACH).
const SOFT_KNEE = 0.99, SOFT_MAX = 0.9995;
export const REACH_FIX_MAX = 0.05;
function softReach(sk, s, a, fa, h, target, diag, k) {
	const R = len(sub(s.P[fa], s.P[a])) + len(sub(s.P[h], s.P[fa])), v = sub(target, s.P[a]), d = len(v);
	const k0 = SOFT_KNEE * R, w = (SOFT_MAX - SOFT_KNEE) * R;
	if (d <= k0 || d - SOFT_MAX * R > REACH_FIX_MAX) return target;
	const dc = k0 + w * (1 - Math.exp(-(d - k0) / w));
	diag[`reach_over_${k}`] = Math.max(0, d - SOFT_MAX * R);
	return add(s.P[a], scale(v, dc / d));
}

/**
 * hooks.handTarget(side, s) -> { target:[x,y,z] } world wrist target before the FK/IK blend
 * hooks.afterArm(side, s, diag) lets the caller measure props carried by that hand.
 * hooks.push(side) -> [x,y,z] | undefined, a world offset added to the IK target (auto-fix).
 * hooks.softReach clamps unreachable wrist targets smoothly (auto-fix).
 * hooks.hold(side) -> { w, palm, measure } | null: a held object's keys lead the hand (hold.js).
 */
export function pose(sk, c, hooks = {}) {
	const s = restState(sk);
	const diag = {};
	// Base: arms down from the bind T-pose (body frame, before everything else).
	const down = num(c.arm_rest, 72);
	for (const [side, sg] of [["Left", -1], ["Right", 1]]) {
		const a = sk.index[`${side}Arm`];
		rotateSubtree(sk, s, a, s.P[a].slice(), rz(sg * down));
	}
	// FK arm swing (forward +) and elbow bend, body frame.
	for (const [k, side] of Object.entries(SIDES)) {
		const bd = num(c[`abend_${k}`]), sw = num(c[`aswing_${k}`]);
		const fa = sk.index[`${side}ForeArm`], a = sk.index[`${side}Arm`];
		if (bd) rotateSubtree(sk, s, fa, s.P[fa].slice(), rx(-bd));
		if (sw) rotateSubtree(sk, s, a, s.P[a].slice(), rx(-sw));
	}
	spread(sk, s, ["Neck", "Head"], num(c.head_yaw), num(c.head_pitch), num(c.head_roll));
	spread(sk, s, ["Spine", "Spine1", "Spine2"], num(c.spine_yaw), num(c.spine_pitch), num(c.spine_roll));
	// Root: turn about the hips joint, then put the hips at `root`.
	const hips = sk.index.Hips, yaw = num(c.yaw);
	rotateSubtree(sk, s, hips, s.P[hips].slice(), mul(ry(yaw), mul(rx(num(c.pitch)), rz(num(c.roll)))));
	const shift = sub(v3(c.root, s.P[hips]), s.P[hips]);
	for (let j = 0; j < s.P.length; j++) s.P[j] = add(s.P[j], shift);
	const body = ry(yaw);
	// Legs: two-bone IK to the ankle targets, then aim the feet.
	for (const [k, side] of Object.entries(SIDES)) {
		if (!c[`foot_${k}`]) continue;
		diag[`leg_miss_${k}`] = twoBone(sk, s, sk.index[`${side}UpLeg`], sk.index[`${side}Leg`], sk.index[`${side}Foot`],
			v3(c[`foot_${k}`]), apply(body, v3(c[`knee_${k}`], KNEE_REST)), KNEE_REST);
		orientFoot(sk, s, side, num(c[`fyaw_${k}`], yaw), num(c[`fpitch_${k}`]));
	}
	// Arms: blend the FK hand toward the hook's target, poles blended the same way.
	for (const k of hooks.armOrder ?? ["r", "l"]) {
		const side = SIDES[k], w = num(c[`armw_${k}`]);
		const a = sk.index[`${side}Arm`], fa = sk.index[`${side}ForeArm`], h = sk.index[`${side}Hand`];
		const poleIk = norm(apply(body, v3(c[`elbow_${k}`], [0, -1, -0.3])));
		diag[`arm_miss_${k}`] = 0;
		if (w > 1e-4 && hooks.handTarget) {
			const fkHand = s.P[h].slice();
			const goal = hooks.handTarget(k, s, diag) ?? fkHand;
			let target = add(fkHand, scale(sub(goal, fkHand), w));
			const push = hooks.push?.(k);
			if (push) target = add(target, push);
			if (hooks.softReach) target = softReach(sk, s, a, fa, h, target, diag, k);
			const poleFk = norm(sub(s.P[fa], scale(add(s.P[a], fkHand), 0.5)));
			const pole = add(scale(poleFk, 1 - w), scale(poleIk, w));
			diag[`arm_miss_${k}`] = twoBone(sk, s, a, fa, h, target, pole, ELBOW_REST);
		}
		wrist(sk, s, side, num(c[`wtwist_${k}`]), num(c[`wflex_${k}`]));
		fingers(sk, s, side, c[`fingers_${k}`]);
		const held = hooks.hold?.(k);
		if (held) holdHand(sk, s, side, held, poleIk, ELBOW_REST, diag, k);
		hooks.afterArm?.(k, s, diag);
	}
	return { s, diag };
}
