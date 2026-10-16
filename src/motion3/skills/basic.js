// Basic skills: stand, walk, reach-and-grip. Each reads the channel state the earlier keys
// leave at its f0 and returns keys plus whatever anchors, props, fits and checks it needs.
import { add, apply, ry } from "../compiler/math.js";
import { walk } from "../compiler/walk.js";
import { keyBook, skillError } from "./book.js";
import { walkEnd } from "./info.js";

/** standIdle({ at: [x, z], heading = 0, until }): a neutral standing pose, arms down (FK). */
export function standIdle(ctx) {
	const { sk, args, state } = ctx, I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
	const h = args.heading ?? state.yaw ?? 0, base = args.at ?? (state.root ? [state.root[0], state.root[2]] : null);
	if (!base) skillError(ctx.tag, "needs args.at: [x, z] (no root is keyed before f0)");
	const c = [base[0], 0, base[base.length - 1]], R = ry(h), foot = v => { const p = add(c, apply(R, v)); p[1] = ank; return p; };
	const set = { root: [c[0], P[I.Hips][1] - 0.01, c[2]], yaw: h, pitch: 0, roll: 0, spine_yaw: 0, spine_pitch: 0, spine_roll: 0, head_yaw: 0, head_pitch: 0,
		foot_l: foot([0.09, 0, -0.03]), foot_r: foot([-0.09, 0, 0.03]), fyaw_l: h, fyaw_r: h, fpitch_l: 0, fpitch_r: 0, knee_l: [0.05, 0, 1], knee_r: [-0.05, 0, 1],
		armw_l: 0, armw_r: 0, aswing_l: 0, aswing_r: 0, abend_l: 0, abend_r: 0 };
	const keys = [{ f: ctx.f0, set }];
	if (args.until !== undefined) keys.push({ f: args.until, set: structuredClone(set) });
	return { keys, end: args.until ?? ctx.f0 };
}

/**
 * walkTo({ to: [x, z] } | { heading: h | [h0, h1] }, steps, step = 0.5, turnDistance, ...): the
 * walk generator from the pose at f0. With `to` the heading turns toward the point and the step
 * count covers the distance. Ends 16 + steps * period + 18 frames after f0, feet together; a
 * take that ends after the last step holds that pose to its end. The steps keep a natural rhythm
 * (compiler/gait-rhythm.js); vary: 0 makes every step the same.
 */
export function walkTo(ctx) {
	const { args, state } = ctx;
	if (!state.foot_l || !state.foot_r || !state.root) skillError(ctx.tag, "needs a standing pose keyed before f0 (use standIdle or another skill first)");
	const gen = { type: "walk", f0: ctx.f0, ...args };
	delete gen.to;
	const h0 = state.yaw ?? 0, step = args.step ?? 0.5, first = args.firstStep ?? 0.4;
	if (args.to) {
		const c0 = [(state.foot_l[0] + state.foot_r[0]) / 2, (state.foot_l[2] + state.foot_r[2]) / 2];
		const dx = args.to[0] - c0[0], dz = args.to[args.to.length - 1] - c0[1], d = Math.hypot(dx, dz);
		let h1 = Math.atan2(dx, dz) * 180 / Math.PI;
		while (h1 - h0 > 180) h1 -= 360;
		while (h1 - h0 < -180) h1 += 360;
		gen.heading = args.heading ?? [h0, h1];
		gen.steps = args.steps ?? Math.max(2, 2 + Math.round((d - first) / step));
	}
	if (typeof gen.heading === "number") gen.heading = [h0, gen.heading];
	const keys = walk(gen, ctx.keys, ctx.sk, ctx.tag), end = walkEnd(gen), last = ctx.frames - 1;
	// the settle after the last step only holds the pose: a take that ends in it ends the walk there
	if (end > last && Math.max(...keys.filter(k => k.f < end).map(k => k.f)) <= last) return { keys: keys.filter(k => k.f <= last), end: last, cut: `settle cut at f${last} (hold to the end)` };
	return { keys, end };
}

/**
 * reachGrip({ anchor, side, reach = 20, hold = 22, release = 12, elbow, fingers = "grip",
 * define, orient = true }): the hand goes to the anchor (defined elsewhere, or by `define`) over
 * `reach` frames with the fingers closing, holds, and lets go. Adds a fit of the fingertips on the
 * anchor (on a body it also turns the hand into a grip, compiler/grip.js; orient: false leaves the
 * hand's turn alone) and a contact check. A take that ends during the release holds the grip to its end.
 */
export function reachGrip(ctx) {
	const { args, state } = ctx, k = args.side, name = args.anchor;
	if (k !== "l" && k !== "r") skillError(ctx.tag, `args.side must be "l" or "r", got ${JSON.stringify(k)}`);
	if (typeof name !== "string" || /_[lr]$/.test(name)) skillError(ctx.tag, "args.anchor must name an anchor (not ending in _l/_r)");
	const reach = args.reach ?? 20, hold = args.hold ?? 22, release = args.release ?? 12, preset = args.fingers ?? "grip";
	const w = `w_${name}_${k}`, fg = `fingers_${k}`, armw = `armw_${k}`, el = `elbow_${k}`, wasFk = !(state[armw] > 0.5);
	// a take that ends after the hold but before the hand lets go cuts the release: the grip holds to the last frame
	const last = ctx.frames - 1, cut = ctx.f0 + reach + hold <= last && ctx.f0 + reach + hold + release > last;
	for (const [c, v] of [[w, 0], [fg, { [preset]: 0 }], [armw, 0]]) if (state[c] === undefined) state[c] = v;
	const b = keyBook(state, ctx.f0);
	b.hold(0, w, fg, armw, el);
	b.at(reach, { [w]: 1, [fg]: { ...state[fg], [preset]: 1 }, [armw]: 1, ...(args.elbow ? { [el]: args.elbow } : {}) });
	b.hold(reach + hold, w, fg, armw, el);
	if (!cut) b.at(reach + hold + release, { [w]: 0, [fg]: { ...state[fg], [preset]: 0 }, ...(wasFk ? { [armw]: 0 } : {}) });
	const S = k === "l" ? "Left" : "Right", prop = `${name}Grip`;
	const def = args.define ? { [name]: args.define } : {};
	const obj = args.define?.kind === "object" ? args.define.object : ctx.anchors?.[name]?.kind === "object" ? ctx.anchors[name].object : null;
	return {
		keys: b.keys, end: cut ? last : ctx.f0 + reach + hold + release, ...(cut ? { cut: `release cut at f${last} (hold to the end)` } : {}), anchors: def,
		props: { [prop]: { hand: k, origin: [`${S}HandIndex2`, `${S}HandMiddle2`], points: { fingers: [0, 0, 0] } } },
		fits: [{ side: k, anchor: name, effector: { prop, point: "fingers" }, ...(args.orient === false ? { orient: false } : {}) }],
		checks: { contacts: [{ name: `fingers on ${name}`, point: `prop:${prop}.fingers`, target: `anchor:${name}`, tol: 0.04, when: w }],
			allow: obj ? [{ part: "hand", object: obj, depth: 0.04 }] : [] },
	};
}
