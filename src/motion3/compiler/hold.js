// The hand follows a held object (docs/motion-api-v3.1.md C14). On frames where
// spec.objects[id].keys lead (../object-keys.js), pose.js calls holdHand after the plain arm
// (IK or FK, wrist channels, fingers): the wrist target and the hand's orientation are solved so
// the grip (the prop's palm frame) lands on the pose the object keys ask for, hand = object o
// attach^-1. The whole arm turns the object (arm-orient.js, lane K8): the elbow swings about the
// shoulder-wrist axis to the pole that leaves the wrist least strained, the forearm takes its
// share of the turn about its own axis, and the wrist adds the rest within anatomical limits
// relative to the forearm: twist about the forearm, flex about the knuckle line, deviation toward
// the thumb (+, radial) or the little finger (-, ulnar). What the arm or the wrist cannot do is
// left as a residual: QA measures it on the object (qa/key-checks.js) and reads the reasons from
// diag.hold_<side>.
import { add, sub, scale, norm, dot, len, mul, T, apply, axisRot, angle, quatFromMat, matFromQuat } from "./math.js";
import { twoBone, palmAxes } from "./limbs.js";
import { rotateSubtree } from "./skeleton.js";
import { slerp } from "./quat.js";
import { WRIST_LIMITS, FOREARM_SHARE, ELBOW_REST, wristNeed, swivel, landscape } from "./arm-orient.js";

const ITERATIONS = 3, REACH_PRICE = 1;
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/**
 * Turn the hand (and its fingers) about the wrist so its world rotation is `goal`, as far as the
 * limits let it: the forearm bone turns FOREARM_SHARE of the twist about its own axis, the hand
 * the rest plus flex and deviation. Returns what it needed, degrees { twist, flex, dev }.
 */
function orient(sk, s, side, h, fa, goal) {
	const axT = scale(sub(s.P[h], s.P[fa]), 1 / len(sub(s.P[h], s.P[fa]))), neutral = mul(s.R[fa], mul(T(sk.restWorldRot[fa]), sk.restWorldRot[h]));
	const { axF, axD, ...need } = wristNeed(neutral, goal, axT, apply(mul(neutral, T(s.R[h])), palmAxes(sk, s, side).l));
	const got = Object.fromEntries(Object.entries(need).map(([k, v]) => [k, clampTo(v, WRIST_LIMITS[k])]));
	const want = mul(mul(axisRot(add(scale(axF, got.flex), scale(axD, got.dev)), Math.hypot(got.flex, got.dev)), axisRot(axT, got.twist)), neutral);
	rotateSubtree(sk, s, fa, s.P[fa].slice(), axisRot(axT, FOREARM_SHARE * got.twist));
	rotateSubtree(sk, s, h, s.P[h].slice(), mul(want, T(s.R[h])));
	return need;
}

/** What holding `palm` with weight w needs on pose s: the hand's goal rotation, the wrist target for a hand rotation (pin "wrist": where it is; "palm": where the palm stays put), the channels' bend direction. */
function aimArm(sk, s, side, palm, now, w, pole, pin) {
	const I = sk.index, a = I[`${side}Arm`], fa = I[`${side}ForeArm`], h = I[`${side}Hand`];
	// the palm frame in the hand bone's frame: fixed for this frame's finger curl
	const localR = mul(T(s.R[h]), now.R), localP = apply(T(s.R[h]), sub(now.pos, s.P[h]));
	const goal = matFromQuat(slerp(quatFromMat(s.R[h]), quatFromMat(mul(palm.R, T(localR))), w));
	const from = s.P[h].slice(), bend = sub(s.P[fa], scale(add(s.P[a], s.P[h]), 0.5));
	// the wrist goes where the grip lands with the orientation the wrist reached (the goal at first)
	const grip = R => sub(palm.pos, apply(R, localP));
	return { goal, plane: len(bend) > 1e-4 ? bend : pole, wristAt: pin === "wrist" ? () => from : pin === "palm" ? grip : R => add(from, scale(sub(grip(R), from), w)) };
}

/**
 * held = { w, palm: { pos, R }, measure(s) -> { pos, R }, pole?, second?, pin? }: blend weight
 * (1 inside the keyed span), the palm frame the keys ask for, the function that measures it on a
 * pose, the planned elbow pole (../hold-plan.js; searched here when absent) and, for a second hand
 * (../second-hand.js), the id of the object it grips and what stays put (pin "wrist" or "palm").
 * `pole` is the fallback bend direction for an arm the channels left straight.
 */
export function holdHand(sk, s, side, held, pole, restBend, diag, k) {
	const I = sk.index, a = I[`${side}Arm`], fa = I[`${side}ForeArm`], h = I[`${side}Hand`], { w } = held;
	const { goal, plane, wristAt } = aimArm(sk, s, side, held.palm, held.measure(s), w, pole, held.pin);
	const arm = swivel(sk, s, side, goal, wristAt(goal), plane, restBend, { toward: held.pole, w });
	let miss = 0, need = { twist: 0, flex: 0, dev: 0 };
	for (let i = 0; i < ITERATIONS; i++) {
		miss = twoBone(sk, s, a, fa, h, wristAt(i ? s.R[h] : goal), arm.pole, restBend);
		need = orient(sk, s, side, h, fa, goal);
	}
	diag[`hold_${k}`] = { w, miss: Math.max(0, miss), ...need, swivel: swungFrom(s, a, fa, h, plane), ...(held.second ? { second: held.second } : {}) };
	diag[`arm_miss_${k}`] *= 1 - w;
}

/**
 * The swivel landscape holdHand searches for `held` on pose s (the plain arm of `side`): what
 * ../hold-plan.js plans the elbow's path on. holdLandscape and holdCost read a plain arm left
 * straight against straight down (holdHand: the channels' elbow pole).
 */
export function holdLandscape(sk, s, side, held) {
	const { goal, plane, wristAt } = aimArm(sk, s, side, held.palm, held.measure(s), held.w, [0, -1, 0]);
	return landscape(sk, s, side, goal, wristAt(goal), plane, ELBOW_REST);
}

/**
 * The arm's cost of holding the palm frame `palm` on pose s (the plain arm of `side`, `now` its
 * palm frame there): the wrist strain at the pole holdHand would take, plus REACH_PRICE per
 * squared centimetre the arm is short. An aim key without roll takes the cheapest roll (key-aim.js).
 */
export function holdCost(sk, s, side, palm, now) {
	const { goal, plane, wristAt } = aimArm(sk, s, side, palm, now, 1, [0, -1, 0]);
	const arm = swivel(sk, s, side, goal, wristAt(goal), plane, ELBOW_REST);
	return arm.cost + REACH_PRICE * (arm.miss * 100) ** 2;
}

/** Degrees the elbow swung about the shoulder-wrist axis from the bend direction `plane` the channels gave. */
function swungFrom(s, a, fa, h, plane) {
	const u = norm(sub(s.P[h], s.P[a])), off = v => sub(v, scale(u, dot(v, u)));
	return angle(off(sub(s.P[fa], s.P[a])), off(plane));
}
