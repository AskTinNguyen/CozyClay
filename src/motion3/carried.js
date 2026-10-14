// Scene objects a hand carries: spec.objects[id] = { prop, grab?, release?, at?, along?, visible? }
// puts the record (a body, or a group root) on prop `prop` (spec.props). `at` is the record's base
// along the palm axes [d, l, n] from the prop origin, `along` the palm direction its +Y (a
// cylinder's length) takes, and `visible` a channel that shows the record while it is above 0.5
// (a step key in the pocket). Without at/along a grabbed record keeps the transform it had
// against the palm at the grab frame (object-pose.js). Also the rigid-pose algebra and the hinge
// pose the compiler, the take and QA share.
import { palmAxes } from "./compiler/limbs.js";
import { SIDES } from "./compiler/pose.js";
import { add, scale, norm, sub, dot, cross, apply, mul, T, axisRot, I3 } from "./compiler/math.js";

export const isCarried = o => typeof o?.prop === "string";
/** A switch entry { visible?, level? } (C15): no prop and no hinge field, so it moves nothing; it shows, hides or dims its record. */
export const isSwitch = o => !!o && typeof o === "object" && !Array.isArray(o) && ["prop", "pivot", "axis", "channel"].every(k => o[k] === undefined);
/** An entry that moves its record (a carry or a hinge), as opposed to a switch. */
export const movesRecord = o => !!o && typeof o === "object" && !isSwitch(o);

/** Mean of the prop's origin joints on pose s (the point the hand holds the prop by). */
export function propOrigin(sk, spec, s, o) {
	const prop = spec.props[o.prop];
	return scale(prop.origin.map(b => s.P[sk.index[b]]).reduce((a, p) => add(a, p), [0, 0, 0]), 1 / prop.origin.length);
}

/** World { pos, R } of a carried record on pose s (at/along offset, PR #14). */
export function carriedPose(sk, spec, s, o) {
	const ax = palmAxes(sk, s, SIDES[spec.props[o.prop].hand]), origin = propOrigin(sk, spec, s, o);
	const palm = v => add(scale(ax.d, v[0]), add(scale(ax.l, v[1]), scale(ax.n, v[2])));
	const y = norm(palm(o.along ?? [0, 0, 1]));
	let x = sub(ax.d, scale(y, dot(ax.d, y)));
	if (Math.hypot(...x) < 1e-6) x = sub(ax.l, scale(y, dot(ax.l, y)));
	x = norm(x);
	const z = cross(x, y);
	return { pos: add(origin, palm(o.at ?? [0, 0, 0])), R: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]] };
}

/** a * b for rigid poses { pos, R }. */
export const compose = (a, b) => ({ pos: add(a.pos, apply(a.R, b.pos)), R: mul(a.R, b.R) });
/** a^-1 * b: b in a's frame. */
export const relative = (a, b) => ({ pos: apply(T(a.R), sub(b.pos, a.pos)), R: mul(T(a.R), b.R) });

/** A record at `rest` turned by hinge { pivot, axis, channel } at frame f of the baked channels. */
export function hingePose(hinge, rest, baked, f) {
	const angle = baked[hinge.channel]?.[f] ?? 0, R = axisRot(hinge.axis ?? [0, 1, 0], angle);
	return { pos: add(hinge.pivot, apply(R, sub(rest.pos, hinge.pivot))), R: mul(R, rest.R ?? I3()), angle };
}
