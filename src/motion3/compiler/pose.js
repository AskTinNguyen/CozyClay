// One frame of the body: channel values -> world-space bone state.
// Conventions (CozyClay): metres, +Y up, yaw 0 faces +Z, positive yaw turns toward +X,
// the character's left is +X at yaw 0. Body-frame vectors (poles, body-local targets) are
// rotated by the root yaw only.
import { add, sub, scale, norm, len, apply, mul, rx, ry, rz } from "./math.js";
import { restState, rotateSubtree } from "./skeleton.js";
import { twoBone, orientFoot, wrist, fingers, limitFold, askedFold, swivelElbow, ELBOW_FOLD, KNEE_FOLD } from "./limbs.js";
import { holdHand } from "./hold.js";
import { ELBOW_REST } from "./arm-orient.js";

export const SIDES = { l: "Left", r: "Right" };
/** How much of an auto-fix elbow turn an arm at IK weight w takes (fix/self.js plans with the same). */
export const turnWeight = w => { const x = Math.min(1, Math.max(0, w)); return x * x * (3 - 2 * x); };
const KNEE_REST = [0, 0, 1], LEG = ["UpLeg", "Leg", "Foot"];

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
 * hooks.push(side) -> [x,y,z] | undefined, a world offset added to the IK target (auto-fix); hooks.skinPush(side) the same
 * for the self fix (fix/self.js), taken as far as the arm is on its IK.
 * hooks.softReach clamps unreachable wrist targets smoothly (auto-fix).
 * hooks.foldFree lets the arm IK fold past the elbow's stop (a fit's measuring passes, compile.js).
 * hooks.hold(side, s) -> { w, palm, measure, pole?, second? } | null: a held object's keys lead the hand (hold.js).
 * hooks.keepOut(side, s, target) -> target: the blended wrist target kept out of the body (auto-fix, compile.js).
 * hooks.swivel(side) -> deg | undefined, an elbow turn about the shoulder-wrist line, the hand kept (auto-fix, fix/self.js).
 * diag.arm_fold_<k>: the flexion (deg) the wrist target asked when past ELBOW_FOLD (arm_miss_<k> is then how far inside).
 * diag.leg_fold_<k>: the knee flexion (deg) the ankle target asked when past KNEE_FOLD (leg_miss_<k> is then how far inside).
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
		// an FK bend past the fold eases to its stop like the IK (limbs.js elbowFold)
		if (bd) { rotateSubtree(sk, s, fa, s.P[fa].slice(), rx(-bd)); limitFold(sk, s, side); }
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
	// Legs: two-bone IK to the ankle targets, the knee no further folded than its stop (limbs.js KNEE_STOP), then aim the feet.
	for (const [k, side] of Object.entries(SIDES)) {
		if (!c[`foot_${k}`]) continue;
		const target = v3(c[`foot_${k}`]);
		diag[`leg_miss_${k}`] = twoBone(sk, s, sk.index[`${side}UpLeg`], sk.index[`${side}Leg`], sk.index[`${side}Foot`],
			target, apply(body, v3(c[`knee_${k}`], KNEE_REST)), KNEE_REST, "knee");
		// a target nearer the hip than the knee folds leaves a residual (leg_miss); leg_fold says what it asked
		const fold = askedFold(sk, s, side, target, LEG);
		if (fold > KNEE_FOLD) diag[`leg_fold_${k}`] = fold;
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
			if (hooks.keepOut) target = hooks.keepOut(k, s, target);
			const push = hooks.push?.(k);
			if (push) target = add(target, push);
			// the self fix's push rides the IK as far as the arm is on it (an arm coming in from FK would jump)
			const skinPush = hooks.skinPush?.(k);
			if (skinPush) target = add(target, scale(skinPush, turnWeight(w)));
			if (hooks.softReach) target = softReach(sk, s, a, fa, h, target, diag, k);
			const poleFk = norm(sub(s.P[fa], scale(add(s.P[a], fkHand), 0.5)));
			const pole = add(scale(poleFk, 1 - w), scale(poleIk, w));
			// a target nearer the shoulder than the elbow folds leaves a residual too; arm_fold says what it asked
			diag[`arm_miss_${k}`] = twoBone(sk, s, a, fa, h, target, pole, ELBOW_REST, hooks.foldFree ? null : "elbow");
			const fold = askedFold(sk, s, side, target);
			if (fold > ELBOW_FOLD && !hooks.foldFree) diag[`arm_fold_${k}`] = fold;
		}
		wrist(sk, s, side, num(c[`wtwist_${k}`]), num(c[`wflex_${k}`]));
		fingers(sk, s, side, c[`fingers_${k}`]);
		const held = hooks.hold?.(k, s);
		if (held) holdHand(sk, s, side, held, ELBOW_REST, diag, k);
		// after a held object's grip, so its hand keeps the grip the hold solved; an arm coming in from FK turns
		// no more than its IK weight (the IK elbow already lands somewhere else than the FK one)
		const turn = hooks.swivel?.(k);
		if (turn) swivelElbow(sk, s, side, turn * turnWeight(w));
		hooks.afterArm?.(k, s, diag);
	}
	return { s, diag };
}
