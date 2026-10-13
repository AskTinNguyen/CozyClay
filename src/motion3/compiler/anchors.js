// Hand-target anchors and hand-held props for the motion3 compiler.
//
// spec.anchors = { name: anchor }, an anchor being one of
//   { kind: "world",    p: [x,y,z] }                        fixed world point (m)
//   { kind: "body",     p: [x,y,z] }                        root-relative, rotated by root yaw
//   { kind: "bone",     bone: "LeftLeg", offset: [x,y,z] }  world offset from a bone joint
//   { kind: "segment",  from: "LeftUpLeg", to: "LeftLeg", t: 0.4, offset: [x,y,z], reach: "l" }
//                       point along a segment; with reach, slides toward `from` until the arm reaches
//   { kind: "object",   object: "Car_Door_L", local: [x,y,z] }  point fixed to an animated scene object
//   { kind: "landmark", name: "mouth" }                     measured face landmark on the Head bone
//   { kind: "prop",     prop: "cig", point: "tip" }         a point on a prop held by the other hand
// spec.props = { name: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"],
//                        points: { name: [d, l, n] } } }   offsets along the palm axes (m)
import { add, sub, scale, len, apply, ry } from "./math.js";
import { bonePoint } from "./skeleton.js";
import { palmAxes } from "./limbs.js";
import { SIDES } from "./pose.js";

function armReach(sk, k) {
	const side = SIDES[k], P = sk.restWorldPos, I = sk.index;
	return len(sub(P[I[`${side}ForeArm`]], P[I[`${side}Arm`]])) + len(sub(P[I[`${side}Hand`]], P[I[`${side}ForeArm`]]));
}

/** Resolve a named anchor to a world point for the current (partial) frame state. */
export function resolveAnchor(ctx, name, s, diag, c) {
	const a = ctx.spec.anchors?.[name];
	if (!a) throw new Error(`MOTION_SPEC_INVALID: unknown anchor "${name}"`);
	const { sk } = ctx, I = sk.index;
	switch (a.kind) {
		case "world": return a.p.slice();
		case "body": return add(c.root ?? s.P[I.Hips], apply(ry(c.yaw ?? 0), a.p));
		case "bone": return add(s.P[I[a.bone]], a.offset ?? [0, 0, 0]);
		case "segment": {
			const A = s.P[I[a.from]], B = s.P[I[a.to]], off = a.offset ?? [0, 0, 0];
			const at = t => add(add(A, scale(sub(B, A), t)), off);
			if (!a.reach) return at(a.t ?? 0.5);
			const sh = s.P[I[`${SIDES[a.reach]}Arm`]], r = 0.95 * armReach(sk, a.reach);
			for (let t = a.t ?? 0.45; t >= (a.tMin ?? 0.15); t -= 0.01) if (len(sub(at(t), sh)) <= r) return at(t);
			return at(a.tMin ?? 0.15);
		}
		case "object": {
			const o = ctx.objectsAt(diag.frame)[a.object];
			if (!o) throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" names unknown object "${a.object}"`);
			return add(o.pos, apply(o.R, a.local ?? [0, 0, 0]));
		}
		case "landmark": return bonePoint(s, I.Head, sk.landmarks[a.name] ?? (() => { throw new Error(`MOTION_SPEC_INVALID: unknown landmark "${a.name}"`); })());
		case "prop": {
			const p = diag.props?.[a.prop]?.[a.point];
			if (!p) throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" needs prop ${a.prop}.${a.point}, which is held by an arm solved later`);
			return p.slice();
		}
		default: throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" has unknown kind "${a.kind}"`);
	}
}

/** Points of every prop held by hand k, in world space, written to diag.props. */
export function measureProps(ctx, k, s, diag) {
	const { sk } = ctx;
	for (const [name, prop] of Object.entries(ctx.spec.props ?? {})) {
		if (prop.hand !== k) continue;
		const ax = palmAxes(sk, s, SIDES[k]);
		const origin = scale(prop.origin.map(b => s.P[sk.index[b]]).reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / prop.origin.length);
		const pts = {};
		for (const [pn, [d, l, n]] of Object.entries(prop.points ?? {})) pts[pn] = add(origin, add(scale(ax.d, d), add(scale(ax.l, l), scale(ax.n, n))));
		pts.origin = origin;
		pts.axes = ax;
		(diag.props ??= {})[name] = pts;
	}
}
