// Hand-target anchors and hand-held props for the motion3 compiler.
//
// spec.anchors = { name: anchor }, an anchor being one of
//   { kind: "world",    p: [x,y,z] }                        fixed world point (m)
//   { kind: "body",     p: [x,y,z] }                        root-relative, rotated by root yaw
//   { kind: "bone",     bone: "LeftLeg", offset: [x,y,z] }  world offset from a bone joint
//   { kind: "segment",  from: "LeftUpLeg", to: "LeftLeg", t: 0.4, offset: [x,y,z], reach: "l" }
//                       point along a segment; with reach, slides toward `from` until the arm reaches
//   { kind: "object",   object: "Car_Door_L", local: [x,y,z] }  point fixed to a scene object or group where it is at
//                       that frame (hinged, carried, following; object-pose.js objectPoseAt), in its own axes
//   { kind: "landmark", name: "mouth" }                     measured face landmark on the Head bone
//   { kind: "prop",     prop: "cig", point: "tip", offset: [x,y,z] }  a point on a prop held by the other hand
// spec.props = { name: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"],
//                        points: { name: [d, l, n] } } }   offsets along the palm axes (m)
import { add, sub, scale, len, apply, ry } from "./math.js";
import { bonePoint } from "./skeleton.js";
import { palmAxes } from "./limbs.js";
import { SIDES } from "./pose.js";
import { HAND_CLEAR, keepOut } from "../body.js";
import { groupsOf } from "../scene.js";

function armReach(sk, k) {
	const side = SIDES[k], P = sk.restWorldPos, I = sk.index;
	return len(sub(P[I[`${side}ForeArm`]], P[I[`${side}Arm`]])) + len(sub(P[I[`${side}Hand`]], P[I[`${side}ForeArm`]]));
}

/** Resolve a named anchor to a world point for the current (partial) frame state. */
/** Anchors placed off the root (a pocket): with fix.self (ctx.keepOut, compile.js) a point the pose put inside
 * the skin resolves onto it, HAND_CLEAR off, for the hand and for every check alike. A bone's or a segment's
 * anchor is the spec's own place on that limb (a hand resting on a thigh) and stays. */
const ON_BODY = new Set(["body"]);
/** side: the hand ("l" | "r") this point is a target for while the compiler solves it; none for a reader of a solved frame. */
export function resolveAnchor(ctx, name, s, diag, c, side) {
	const a = ctx.spec.anchors?.[name];
	if (!a) throw new Error(`MOTION_SPEC_INVALID: unknown anchor "${name}"`);
	const p = anchorPoint(ctx, a, name, s, diag, c, side), skin = ON_BODY.has(a.kind) && ctx.keepOut;
	return skin ? keepOut(skin.body, ctx.sk, s, keepOut(skin.body, ctx.sk, s, p, HAND_CLEAR, skin.skip), HAND_CLEAR, skin.skip) : p;
}

// pose.js solves the right arm, then the left
const ARMS = ["r", "l"], HAND = { l: "left", r: "right" };

/**
 * The pose { pos, R } an object anchor's `local` is in at frame diag.frame: where the object is then (ctx.objectPose,
 * the pose refs and probes read). A hand cannot aim at what rides on it: the hand that carries the object keeps the
 * scene pose, where it took it. While the right arm is solved the left is not, so the right hand cannot aim at what
 * the left carries (refused).
 */
export function objectFrame(ctx, a, name, { s, diag, c }, side) {
	const f = diag.frame, still = () => ctx.objectsAt(f)[a.object] ?? groupsOf(ctx.scene)[a.object];
	const hand = ctx.objectPose && f !== undefined ? ctx.objectHand(a.object, f) : null;
	if (side && hand && ARMS.indexOf(hand) > ARMS.indexOf(side)) throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" is on "${a.object}", which the ${HAND[hand]} hand holds at f${f}; the right arm is solved before the left, so the right hand cannot follow it. Carry "${a.object}" in the right hand (a right-hand prop) and put the left hand on it, or give the right hand another anchor`);
	const pose = !ctx.objectPose || f === undefined || hand === side ? still() : nested(ctx, name, a.object, f, () => ctx.objectPose(a.object, f, { s, diag, c }));
	if (!pose) throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" names unknown object "${a.object}"`);
	return pose;
}

// Reading an object may solve another frame (a keyed carry's grab offset, object-keys.js), whose hands read objects
// again; legitimate reads nest a few deep, so a deeper chain is a loop and is refused instead of overflowing the stack.
const MAX_NEST = 16;
function nested(ctx, name, object, f, read) {
	if ((ctx.nest ?? 0) >= MAX_NEST) throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" on "${object}" at f${f} reads a pose that needs this frame solved again (an anchor and carry loop); anchor the hand on a point that does not ride on the hand it moves`);
	ctx.nest = (ctx.nest ?? 0) + 1;
	try { return read(); } finally { ctx.nest--; }
}

function anchorPoint(ctx, a, name, s, diag, c, side) {
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
		case "object": { const o = objectFrame(ctx, a, name, { s, diag, c }, side); return add(o.pos, apply(o.R, a.local ?? [0, 0, 0])); }
		case "landmark": return bonePoint(s, I.Head, sk.landmarks[a.name] ?? (() => { throw new Error(`MOTION_SPEC_INVALID: unknown landmark "${a.name}"`); })());
		case "prop": {
			const p = diag.props?.[a.prop]?.[a.point];
			if (!p) throw new Error(`MOTION_SPEC_INVALID: anchor "${name}" needs prop ${a.prop}.${a.point}, which is held by an arm solved later`);
			return add(p, a.offset ?? [0, 0, 0]);
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
