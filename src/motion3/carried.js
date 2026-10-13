// Scene objects a hand carries: spec.objects[id] = { prop, at?, along?, visible? } puts the
// record on prop `prop` (spec.props) every frame. `at` is the record's base along the palm axes
// [d, l, n] from the prop origin, `along` the palm direction its +Y (a cylinder's length) takes,
// and `visible` a channel that shows the record while it is above 0.5 (a step key in the pocket).
import { palmAxes } from "./compiler/limbs.js";
import { SIDES } from "./compiler/pose.js";
import { add, scale, norm, sub, dot, cross } from "./compiler/math.js";

export const isCarried = o => typeof o?.prop === "string";

/** World { pos, R } of a carried record on pose s. */
export function carriedPose(sk, spec, s, o) {
	const prop = spec.props[o.prop], ax = palmAxes(sk, s, SIDES[prop.hand]);
	const origin = scale(prop.origin.map(b => s.P[sk.index[b]]).reduce((a, p) => add(a, p), [0, 0, 0]), 1 / prop.origin.length);
	const palm = v => add(scale(ax.d, v[0]), add(scale(ax.l, v[1]), scale(ax.n, v[2])));
	const y = norm(palm(o.along ?? [0, 0, 1]));
	let x = sub(ax.d, scale(y, dot(ax.d, y)));
	if (Math.hypot(...x) < 1e-6) x = sub(ax.l, scale(y, dot(ax.l, y)));
	x = norm(x);
	const z = cross(x, y);
	return { pos: add(origin, palm(o.at ?? [0, 0, 0])), R: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]] };
}
