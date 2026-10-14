// The hand follows a held object (docs/motion-api-v3.1.md C14). On frames where
// spec.objects[id].keys lead (../object-keys.js), pose.js calls holdHand after the plain arm
// (IK or FK, wrist channels, fingers): the wrist target and the hand's orientation are solved so
// the grip (the prop's palm frame) lands on the pose the object keys ask for, hand = object o
// attach^-1. The arm IK reaches for it, keeping the elbow in the plane the channels gave it. The
// wrist turns within anatomical limits relative to the forearm: twist about the forearm, flex
// about the knuckle line, deviation toward the thumb (+, radial) or the little finger (-, ulnar).
// What the arm or the wrist cannot do is left as a residual: QA measures it on the object
// (qa/key-checks.js) and reads the reasons from diag.hold_<side>.
import { add, sub, scale, norm, dot, cross, len, mul, T, apply, quatFromMat, matFromQuat } from "./math.js";
import { twoBone, palmAxes } from "./limbs.js";
import { rotateSubtree } from "./skeleton.js";
import { qmul, qconj, qlog, qexp, slerp } from "./quat.js";

/** Wrist limits in degrees, relative to the hand at rest on the forearm. */
export const WRIST_LIMITS = { twist: [-85, 85], flex: [-70, 70], dev: [-35, 20] };
const ITERATIONS = 3;
const DEG = 180 / Math.PI;
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/**
 * Turn the hand (and its fingers) about the wrist so its world rotation is `goal`, as far as the
 * limits let it. `neutral` is the hand's rotation at rest on the forearm. Returns what it needed,
 * degrees { twist, flex, dev }.
 */
function orient(sk, s, side, h, fa, neutral, goal) {
	const axT = norm(sub(s.P[h], s.P[fa]));
	let q = quatFromMat(mul(goal, T(neutral)));
	if (q[3] < 0) q = q.map(v => -v);
	const along = dot([q[0], q[1], q[2]], axT), twist = 2 * Math.atan2(along, q[3]);
	const swing = qlog(qmul(q, qconj(qexp(scale(axT, twist)))));
	const lNeutral = apply(mul(neutral, T(s.R[h])), palmAxes(sk, s, side).l), lTwisted = apply(matFromQuat(qexp(scale(axT, twist))), lNeutral);
	const axF = norm(sub(lTwisted, scale(axT, dot(lTwisted, axT)))), axD = cross(axT, axF);
	const need = { twist: twist * DEG, flex: dot(swing, axF) * DEG, dev: dot(swing, axD) * DEG };
	const got = Object.fromEntries(Object.entries(need).map(([k, v]) => [k, clampTo(v, WRIST_LIMITS[k]) / DEG]));
	const turn = qmul(qexp(add(scale(axF, got.flex), scale(axD, got.dev))), qexp(scale(axT, got.twist)));
	rotateSubtree(sk, s, h, s.P[h].slice(), mul(mul(matFromQuat(turn), neutral), T(s.R[h])));
	return need;
}

/**
 * held = { w, palm: { pos, R }, measure(s) -> { pos, R } }: blend weight (1 inside the keyed
 * span), the palm frame the keys ask for and the function that measures it on a pose. `pole` is
 * the fallback bend direction for an arm the channels left straight.
 */
export function holdHand(sk, s, side, held, pole, restBend, diag, k) {
	const I = sk.index, a = I[`${side}Arm`], fa = I[`${side}ForeArm`], h = I[`${side}Hand`], { w, palm } = held;
	const now = held.measure(s);
	// the palm frame in the hand bone's frame: fixed for this frame's finger curl
	const localR = mul(T(s.R[h]), now.R), localP = apply(T(s.R[h]), sub(now.pos, s.P[h]));
	const goal = matFromQuat(slerp(quatFromMat(s.R[h]), quatFromMat(mul(palm.R, T(localR))), w));
	const from = s.P[h].slice(), mid = scale(add(s.P[a], s.P[h]), 0.5), bend = sub(s.P[fa], mid);
	const plane = len(bend) > 1e-4 ? bend : pole;
	const neutralRel = mul(T(sk.restWorldRot[fa]), sk.restWorldRot[h]);
	let miss = 0, need = { twist: 0, flex: 0, dev: 0 };
	for (let i = 0; i < ITERATIONS; i++) {
		// the wrist goes where the grip lands with the orientation the wrist reached (the goal at first)
		const R = i ? s.R[h] : goal, at = sub(palm.pos, apply(R, localP));
		miss = twoBone(sk, s, a, fa, h, add(from, scale(sub(at, from), w)), plane, restBend);
		need = orient(sk, s, side, h, fa, mul(s.R[fa], neutralRel), goal);
	}
	diag[`hold_${k}`] = { w, miss: Math.max(0, miss), ...need };
	diag[`arm_miss_${k}`] *= 1 - w;
}
