// The second hand on a held object (C14, lane K8). While keys lead a carry the right hand holds
// (object-keys.js), a left hand anchored to that prop (w_<anchor>_l on a kind "prop" anchor of
// the same prop, with or without a fit) turns with the object too. The wrist stays where the
// anchor puts it (with a fit, the palm stays where the fit puts it). The hand takes the holding
// hand's grip mirrored across the plane of the object's axis and the holding fingers (the object's
// +Y runs through the left palm frame as through the right one, knuckles in line), turned about
// the axis to the roll its wrist holds most easily (planned over the frames, object-keys.js and
// hold-plan.js). The forearm and the wrist follow as for the holding hand (compiler/hold.js); the
// elbow stays in its plane. The hold eases in with the keys' weight times the anchor weight, and a
// grip the wrist cannot hold fades out. Only a hand solved after the holding hand can follow it
// (pose.js solves the right arm first), so the second hand is the left.
import { palmAxes } from "./compiler/limbs.js";
import { SIDES } from "./compiler/pose.js";
import { add, sub, scale, norm, dot, cross, mul, T, apply, axisRot } from "./compiler/math.js";
import { strainHere } from "./compiler/arm-orient.js";

const ROLLS = 36, TEMP = 0.05, PULL = 0.3, EASY = 3, SLACK = 10;
const cols = (a, b, c) => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
const col = (R, i) => [R[0][i], R[1][i], R[2][i]];

/** The palm frame of `side` on pose s: the finger middles, axes d, l, n as columns. */
function palmFrame(sk, s, side) {
	const I = sk.index, ax = palmAxes(sk, s, side);
	return { pos: scale(add(s.P[I[`${side}HandIndex2`]], s.P[I[`${side}HandMiddle2`]]), 0.5), R: cols(ax.d, ax.l, ax.n) };
}

/**
 * The left hand's grip on carry `id` at this frame, or null when the left hand is not anchored to
 * its prop: s is the pose with the holding hand done and the left arm on its plain target, c the
 * frame's channels, axis the object's +Y as drawn. The grip is the holding hand's mirrored (knuckles
 * in line), turned `roll` radians about the axis; cost(roll) is the wrist's strain there (pulled
 * lightly toward the mirror), point(roll) the end of the hand that moves
 * (the palm with the wrist pinned, the wrist with the palm pinned), softmin() the easiest roll.
 */
export function secondGrip(sk, spec, id, s, c, axis) {
	const o = spec.objects[id];
	if (spec.props[o.prop].hand !== "r") return null;
	const weight = Object.entries(spec.anchors ?? {}).reduce((sum, [name, a]) => sum + (a.kind === "prop" && a.prop === o.prop ? Math.max(0, c[`w_${name}_l`] ?? 0) : 0), 0);
	if (!(weight > 1e-4)) return null;
	// the mirror of the holding palm frame across the plane of the axis and the holding fingers
	const R = palmFrame(sk, s, SIDES.r).R, d = col(R, 0), p = norm(cross(axis, sub(d, scale(axis, dot(d, axis))))), mirror = v => sub(v, scale(p, 2 * dot(v, p)));
	const base = cols(mirror(d), mirror(col(R, 1)), scale(mirror(col(R, 2)), -1));
	const left = palmFrame(sk, s, SIDES.l), I = sk.index, h = I.LeftHand, wrist = s.P[h], local = mul(T(s.R[h]), left.R), localP = apply(T(s.R[h]), sub(left.pos, wrist));
	// with a fit the palm (its effector) stays where the fit put it, else the wrist stays on the anchor
	const pin = (spec.fits ?? []).some(x => x.side === "l" && spec.anchors?.[x.anchor]?.kind === "prop" && spec.anchors[x.anchor].prop === o.prop && c[`w_${x.anchor}_l`] > 1e-4) ? "palm" : "wrist";
	const rolled = r => mul(axisRot(axis, r * 180 / Math.PI), base), hand = r => mul(rolled(r), T(local));
	const cost = r => strainHere(sk, s, SIDES.l, hand(r)) + PULL * (1 - Math.cos(r));
	const point = r => (pin === "wrist" ? add(wrist, apply(hand(r), localP)) : sub(left.pos, apply(hand(r), localP)));
	const softmin = () => {
		const all = Array.from({ length: ROLLS }, (_, i) => { const r = (2 * Math.PI * i) / ROLLS - Math.PI; return [r, cost(r)]; }), low = Math.min(...all.map(x => x[1]));
		const m = all.reduce((acc, [r, v]) => { const e = Math.exp(-(v - low) / TEMP); return [acc[0] + e * Math.cos(r), acc[1] + e * Math.sin(r)]; }, [0, 0]);
		return Math.atan2(m[1], m[0]);
	};
	const bend = sub(s.P[I.LeftForeArm], scale(add(s.P[I.LeftArm], wrist), 0.5));
	return { id, weight, pin, pole: bend, at: left.pos, rolled, cost, point, softmin, measure: s2 => palmFrame(sk, s2, SIDES.l) };
}

/** How much of a grip at `roll` the wrist can take: 1 while its strain is under EASY, fading by SLACK past it. */
export const gripGate = (grip, roll) => Math.exp(-Math.max(0, grip.cost(roll) - EASY) / SLACK);

/**
 * The hold ({ w, palm, measure, pole, pin, second } for compiler/hold.js) of a grip at `roll`
 * radians, w the keys' lead weight, gate the planned gripGate: a grip the wrist cannot hold fades
 * out, so the hand stays nearer where the plain arm put it instead of turning to a limit and
 * flipping there.
 */
export const secondHold = (grip, w, roll, gate) => ({ w: w * Math.min(1, grip.weight) * gate, second: grip.id, pin: grip.pin,
	pole: grip.pole, palm: { pos: grip.at, R: grip.rolled(roll) }, measure: grip.measure });
