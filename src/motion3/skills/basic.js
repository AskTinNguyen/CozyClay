// Basic skills: stand, walk, reach-and-grip. Each reads the channel state the earlier keys
// leave at its f0 and returns keys plus whatever anchors, props, fits and checks it needs.
import { add, apply, len, ry, sub } from "../compiler/math.js";
import { walk, stateAt } from "../compiler/walk.js";
import { keyBook, skillError } from "./book.js";
import { walkEnd } from "./info.js";
import { GRASP_FINGERS, GRASP_POINTS } from "../compiler/vocab.js";
import { clearStance, reachStance } from "./stance.js";
import { CLOSE, GAZE, gazeAt, headKeyed, earlyTransport, holdsOpen, transportKeys } from "./reach-human.js";

/** The fingers' point a reachGrip fits onto its anchor: the finger middles, or where a grasp holds the thing (the palm is -n on the right hand). */
const graspPoint = (grasp, k) => (GRASP_POINTS[grasp] ? GRASP_POINTS[grasp].map((v, i) => (i === 2 && k === "r" ? -v : v)) : [0, 0, 0]);

/**
 * standIdle({ at: [x, z], heading = 0, until }): a neutral standing pose, arms down (FK). Without `at` (and no root
 * keyed) before a reachGrip it stands within that hand's reach of the anchor, facing it; a stance in a scene body
 * slides out of it (stance.js). Either says so in `placed`.
 */
export function standIdle(ctx) {
	const { sk, args, state } = ctx, I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
	let h = args.heading ?? state.yaw ?? 0, base = args.at ?? (state.root ? [state.root[0], state.root[2]] : null), placed = null;
	if (!base) {
		const auto = reachStance(ctx);
		if (!auto) skillError(ctx.tag, "needs args.at: [x, z] (no root is keyed before f0), or a reachGrip after it to stand within reach of");
		({ at: base, heading: h } = auto);
		placed = { at: base, heading: h, why: `within reach of anchor ${auto.anchor}` };
	} else if (args.at && ctx.place !== false) {
		const out = clearStance(sk, ctx.scene, [base[0], base[base.length - 1]], h);
		if (out) { base = out.at; placed = { at: base, heading: h, why: `moved ${out.moved} m out of a scene body` }; }
	}
	const c = [base[0], 0, base[base.length - 1]], R = ry(h), foot = v => { const p = add(c, apply(R, v)); p[1] = ank; return p; };
	const set = { root: [c[0], P[I.Hips][1] - 0.01, c[2]], yaw: h, pitch: 0, roll: 0, spine_yaw: 0, spine_pitch: 0, spine_roll: 0, head_yaw: 0, head_pitch: 0,
		foot_l: foot([0.09, 0, -0.03]), foot_r: foot([-0.09, 0, 0.03]), fyaw_l: h, fyaw_r: h, fpitch_l: 0, fpitch_r: 0, knee_l: [0.05, 0, 1], knee_r: [-0.05, 0, 1],
		armw_l: 0, armw_r: 0, aswing_l: 0, aswing_r: 0, abend_l: 0, abend_r: 0, arm_hang: 1 };
	const keys = [{ f: ctx.f0, set }];
	if (args.until !== undefined) keys.push({ f: args.until, set: structuredClone(set) });
	return { keys, end: args.until ?? ctx.f0, ...(placed ? { placed } : {}) };
}

/** The feet's midpoint [x, z] once the walk's keys have played out. */
function walkEndAt(keys) {
	const st = stateAt(keys, Infinity);
	return [(st.foot_l[0] + st.foot_r[0]) / 2, (st.foot_l[2] + st.foot_r[2]) / 2];
}
const r2 = v => Math.round(v * 100) / 100, xzText = p => `[${p.map(r2).join(", ")}]`;
// A natural gait for the rig (fitTo): a step STEP of the leg (hip to ankle: 0.25..0.7 m on the Y Bot), the first of a
// two-step walk FIRST of it (a short shuffle is a natural reposition), CADENCE steps a second, and the step over the cadence
// within RATIO of WALK_RATIO legs x s: a person's walk ratio (about 6.5 mm per step a minute, 0.39 m x s on a 0.83 m leg)
// holds from a slow walk to a brisk one, so longer steps come with quicker ones. A stride fitted at a fixed cadence went to
// 0.87 m at 1.2 steps a second in the agent sessions (a lunge); the walk generator slides or pops in most cadences from a
// 0.75 m step, and pops above 1.8 steps a second (31 of 47 fitted walks at period 12-13, none at 14-18; a person's brisk walk
// reaches 2.1).
const STEP = [0.3, 0.85], FIRST = [0.18, 0.85], CADENCE = [1, 1.8], WALK_RATIO = 0.47, RATIO = [0.7, 1.4], CHANGE = 0.1, REACH_TOL = 0.1, HEADING_TOL = 20;
const legOf = sk => { const P = sk.restWorldPos, I = sk.index; return len(sub(P[I.LeftLeg], P[I.LeftUpLeg])) + len(sub(P[I.LeftFoot], P[I.LeftLeg])); };

/**
 * to with steps (C21): the steps walk where they walk, and to only turns the heading, so a walk with both is fitted
 * when ctx.fit asks (correct.js fitWalks, before the spec is stored), in a natural gait (the bands above):
 *   the stride (steps >= 3, the first step keeping its share of it) or the first step (steps 2) that makes the steps end
 *   at to, when it stays in its band and in the walk ratio band at the walk's cadence;
 *   else the step count whose stride is nearest the walk ratio, its stride and cadence in their bands: in the walk's own
 *   stepping time (steps x period frames, the period the one that fits, never ending later; fewer steps stand at the end),
 *   or at the walk's own period when nothing comes after it in a frames "auto" spec (ctx.fit.stretch: it may end later);
 *   else, or for a heading that points away from to, a line in ctx.fit.refusals with what the walk would do and needs.
 * Deterministic: a walk at a candidate count is estimated (its end is linear in the stride) and the chosen one walked
 * once more to set its stride. -> { gen, adjust } with the fitted gen.
 */
function fitTo(ctx, gen, c0, d, bearing) {
	const { args, tag, sk } = ctx, steps = gen.steps, h = Array.isArray(args.heading) ? args.heading[1] : args.heading;
	const off = h === undefined ? 0 : Math.abs(((h - bearing) % 360 + 540) % 360 - 180);
	if (off > HEADING_TOL) {
		ctx.fit.refusals.push(`${tag}: heading ${h} points ${Math.round(off)} deg away from to ${xzText(args.to)} (it lies at heading ${Math.round(bearing)}), so the walk would not go there; with to the walk turns toward it by itself: leave heading out, or give heading without to to walk that way`);
		return { gen };
	}
	const period = gen.period ?? 20, swing = gen.swing ?? 14, was = gen.step ?? 0.5, first = gen.firstStep ?? 0.4;
	if (args.steps === undefined || args.arrive !== undefined || !(steps >= 2) || ![steps, period, swing, was, first].every(Number.isFinite)) return { gen };
	const u = [Math.sin(bearing * Math.PI / 180), Math.cos(bearing * Math.PI / 180)];
	const reach = g => { const e = walkEndAt(walk(g, ctx.keys, sk, tag)); return { end: e, along: (e[0] - c0[0]) * u[0] + (e[1] - c0[1]) * u[1] }; };
	const { end, along } = reach(gen);
	if (Math.abs(d - along) <= REACH_TOL) return { gen };
	const fps = ctx.fps ?? 24, leg = legOf(sk), nat = WALK_RATIO * leg, span = steps * period;
	const band = n => (n >= 3 ? STEP : FIRST).map(x => r2(x * leg)), pLo = Math.ceil(fps / CADENCE[1]), pHi = Math.floor(fps / CADENCE[0]);
	const stretch = ctx.fit.stretch === true && !(ctx.use ?? []).some((x, j) => j !== ctx.index && x?.f0 > ctx.f0) && !ctx.keys.some(k => k.f > ctx.f0 && /^keys\[/.test(k.src ?? ""));
	// n steps: the period (its own, or the one that keeps the stepping time), the stride that ends them at to (the end moves
	// by the first step and a stride a middle step, rest the closing step's share; with steps 3 and up the first step keeps
	// its share of the stride unless args give it, as a person's first step is a little shorter), whether they stay in their bands
	const rest = along - first - (steps - 2) * was, share = args.firstStep === undefined ? first / was : 0;
	const at = n => {
		const p = stretch || n === steps ? period : Math.min(Math.max(pHi, period), Math.floor(span / n)), name = n >= 3 ? "step" : "firstStep";
		const value = n >= 3 ? (d - rest - (share ? 0 : first)) / (share + n - 2) : d - rest, lead = n >= 3 && share ? share * value : first;
		const [lo, hi] = band(n), ratio = value * p / fps / nat, inBand = (x, [a, b]) => x >= a && x <= b;
		return { n, p, name, value, ratio, ok: inBand(value, [lo, hi]) && inBand(lead, band(2)) && (p === period || inBand(p, [pLo, pHi])) };
	};
	const own = at(steps), most = Math.min(60, Math.ceil(d / band(3)[0]) + 2);
	let pick = own.ok && own.ratio >= RATIO[0] && own.ratio <= RATIO[1] ? own : null;
	if (!pick) {
		const all = Array.from({ length: most - 1 }, (_, i) => at(i + 2)).filter(c => c.ok);
		// nearest the walk ratio, a step count further from the one asked costing CHANGE of it a step
		const cost = c => Math.abs(Math.log(c.ratio)) + CHANGE * Math.abs(c.n - steps);
		pick = all.sort((a, b) => cost(a) - cost(b) || a.n - b.n)[0];
	}
	const [sLo, sHi] = band(3), gait = `a natural gait (step ${sLo}..${sHi} m, ${CADENCE[0]}..${CADENCE[1]} steps a second: period ${pLo}..${pHi} at ${fps} fps`;
	const miss = `${r2(Math.abs(d - along))} m ${along < d ? "short of" : "past"} to ${xzText(args.to)} (${r2(d)} m away)`;
	if (!pick) {
		// short: the fewest steps at the longest natural step, at the quickest natural cadence (the least stepping time that reaches)
		const n = 2 + Math.ceil((d - rest - first) / sHi - 1e-9), e = ctx.f0 + 16 + n * pLo + 18;
		ctx.fit.refusals.push(`${tag}: steps ${steps} at period ${period} (${span} frames of stepping) walk ${r2(along)} m and end at ${xzText(end)}, ${miss}; ${along < d
			? `in ${gait}) that takes ${n} steps and ${n * pLo} frames of stepping or more (the walk would end at f${e} or later, not f${ctx.f0 + 16 + span + 18}): leave steps${args.step === undefined ? "" : " and step"} out (walkTo picks the count), or give steps: ${n} and room for the walk before what follows`
			: `no natural step count ends there: leave steps out (walkTo picks the count)`}`);
		return { gen };
	}
	const timed = pick.p === period ? {} : { period: pick.p, swing: Math.max(2, Math.min(pick.p - 1, Math.round(swing * pick.p / period))) };
	const lead = pick.n >= 3 && share > 0, strides = v => ({ [pick.name]: r2(v), ...(lead ? { firstStep: r2(share * v) } : {}) });
	let fitted = { ...gen, steps: pick.n, ...timed, ...strides(pick.value) };
	const left = d - reach(fitted).along;
	if (Math.abs(left) > 0.02) fitted = { ...fitted, ...strides(pick.value + left / (pick.n >= 3 ? share + pick.n - 2 : 1)) };
	const v = fitted[pick.name], dflt = pick.name === "step" ? was : first, e0 = ctx.f0 + 16 + span + 18, e1 = ctx.f0 + 16 + pick.n * pick.p + 18;
	const changes = [pick.n !== steps && `steps ${steps} -> ${pick.n}`, timed.period && `period ${period} -> ${timed.period} (swing ${swing} -> ${timed.swing})`, `${pick.name} ${dflt} -> ${v} m`,
		lead && fitted.firstStep !== first && `firstStep ${first} -> ${fitted.firstStep} m`].filter(Boolean).join(", ");
	const when = e1 === e0 ? "" : `; it ends f${e1}, not f${e0} (${stretch ? "nothing follows it" : `the pose holds to f${e0}`})`;
	const why = pick.n === steps && !timed.period ? ` (at ${pick.name} ${dflt} they walk ${r2(along)} of ${r2(d)} m)` : ` in ${gait}; steps ${steps} would need a ${own.name} of ${r2(own.value)} m at ${r2(fps / period)} steps a second)${when}`;
	const adjust = { args: { ...(pick.n === steps ? {} : { steps: pick.n }), ...timed, [pick.name]: v, ...(lead && fitted.firstStep !== first ? { firstStep: fitted.firstStep } : {}) }, note: `${tag}: ${changes}, so steps ${pick.n} end at to ${xzText(args.to)}${why}` };
	return { gen: fitted, adjust };
}

/**
 * walkTo({ to: [x, z] } | { heading: h | [h0, h1] }, steps, step = 0.5, turnDistance, ...): the
 * walk generator from the pose at f0. With `to` the heading turns toward the point and the step
 * count covers the distance; with steps as well the stride is fitted so they end there (fitTo). Ends
 * 16 + steps * period + 18 frames after f0, feet together; a take that ends after the last step holds
 * that pose to its end. A walk with `to` that ends more than 0.1 m from it says where in `placed`. The
 * steps keep a natural rhythm (compiler/gait-rhythm.js); vary: 0 makes every step the same.
 */
export function walkTo(ctx) {
	const { args, state } = ctx;
	if (!state.foot_l || !state.foot_r || !state.root) skillError(ctx.tag, "needs a standing pose keyed before f0 (use standIdle or another skill first)");
	let gen = { type: "walk", f0: ctx.f0, ...args }, adjust, c0, h1;
	delete gen.to; delete gen.arrive;
	const h0 = state.yaw ?? 0, step = args.step ?? 0.5, first = args.firstStep ?? 0.4;
	if (args.to) {
		c0 = [(state.foot_l[0] + state.foot_r[0]) / 2, (state.foot_l[2] + state.foot_r[2]) / 2];
		const dx = args.to[0] - c0[0], dz = args.to[args.to.length - 1] - c0[1], d = Math.hypot(dx, dz);
		h1 = Math.atan2(dx, dz) * 180 / Math.PI;
		while (h1 - h0 > 180) h1 -= 360;
		while (h1 - h0 < -180) h1 += 360;
		gen.heading = args.heading ?? [h0, h1];
		gen.steps = args.steps ?? Math.max(2, 2 + Math.round((d - first) / step));
		if (typeof gen.heading === "number") gen.heading = [h0, gen.heading];
		if (ctx.fit && d > REACH_TOL) ({ gen, adjust } = fitTo(ctx, gen, c0, d, h1));
	}
	if (typeof gen.heading === "number") gen.heading = [h0, gen.heading];
	const keys = walk(gen, ctx.keys, ctx.sk, ctx.tag), end = walkEnd(gen), last = ctx.frames - 1;
	const at = args.to && walkEndAt(keys), miss = at ? Math.hypot(at[0] - args.to[0], at[1] - args.to[args.to.length - 1]) : 0;
	const placed = miss > REACH_TOL ? { placed: { at: at.map(r2), heading: Math.round(gen.heading?.[1] ?? h0), why: `ends ${r2(miss)} m from to ${xzText(args.to)}` } } : {};
	const more = { ...placed, ...(adjust ? { adjust } : {}) };
	// the settle after the last step only holds the pose: a take that ends in it ends the walk there
	if (end > last && Math.max(...keys.filter(k => k.f < end).map(k => k.f)) <= last) return { keys: keys.filter(k => k.f <= last), end: last, cut: `settle cut at f${last} (hold to the end)`, ...more };
	return { keys, end, ...more };
}

/** base when `props` has no other prop of that name (the same one again is fine), else base_<side>, base_<side>2, ... */
function freeName(props = {}, base, k, mine) {
	const taken = n => props[n] && JSON.stringify(props[n]) !== JSON.stringify(mine);
	if (!taken(base)) return base;
	let name = `${base}_${k}`;
	for (let i = 2; taken(name); i++) name = `${base}_${k}${i}`;
	return name;
}

/** What a hand on `obj` may touch: the object, or for a group (an Empty, no body of its own) every part under it. */
const touchable = (scene, obj) => {
	const objects = scene?.objects ?? {};
	if (!obj || objects[obj] || obj.startsWith("person:")) return obj ? [obj] : [];
	const parts = Object.keys(objects).filter(k => objects[k].ancestors?.includes(obj));
	return parts.length ? parts : [obj];
};

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
	const reach = args.reach ?? 20, hold = args.hold ?? 22, release = args.release ?? 12;
	// an anchor that takes a grasp closes the hand to that grasp's fingers (../sockets.js)
	const grasp = (args.define ?? ctx.anchors?.[name])?.grasp, preset = args.fingers ?? GRASP_FINGERS[grasp] ?? "grip";
	const w = `w_${name}_${k}`, fg = `fingers_${k}`, armw = `armw_${k}`, el = `elbow_${k}`, wasFk = !(state[armw] > 0.5);
	// a take that ends before the hand lets go cuts the hold or the release: the grip holds to the last frame (a hold
	// asked past the end was refused, session 7f15b4ae: "needs 92 frames from f10 (to f102), past the last frame f85")
	const last = ctx.frames - 1, cut = ctx.f0 + reach <= last && ctx.f0 + reach + hold + release > last;
	const held = Math.min(reach + hold, last - ctx.f0);
	for (const [c, v] of [[w, 0], [fg, { [preset]: 0 }], [armw, 0]]) if (state[c] === undefined) state[c] = v;
	// the head looks at what the hand goes for unless the keys already move it (reach-human.js); read before the keys move state
	// the reach's own view: a thing that spec.objects moves before the hand gets there is not at rest (reach-human.js)
	const end = reach + hold + release, rc = { ...ctx, until: ctx.f0 + reach };
	const look = !headKeyed(ctx.keys ?? [], ctx.f0, ctx.f0 + end) && gazeAt(rc, args.define ?? ctx.anchors?.[name], state);
	const head = look ? { head_yaw: state.head_yaw ?? 0, head_pitch: state.head_pitch ?? 0 } : null;
	const b = keyBook(state, ctx.f0);
	b.hold(0, w, fg, armw, el, ...(look ? ["head_yaw", "head_pitch"] : []));
	// the transport's early-peaked bell; on a thing the open hand clears, the fingers stay open to CLOSE of the reach, then close
	// (a reach for a moving point, or below the knees, keeps the plain ease: reach-human.js earlyTransport)
	const target = args.define ?? ctx.anchors?.[name], w0 = state[w], a0 = state[armw], lerp = (a, z, t) => a + (z - a) * t;
	if (earlyTransport(rc, target)) for (const [f, t, ta] of transportKeys(reach)) b.at(f, { [w]: lerp(w0, 1, t), [armw]: lerp(a0, 1, ta) });
	const close = Math.round(CLOSE * reach);
	if (close > 0 && close < reach && holdsOpen(rc, target, state)) b.hold(close, fg);
	if (look) b.at(Math.max(1, Math.round(GAZE * reach)), look);
	b.at(reach, { [w]: 1, [fg]: { ...state[fg], [preset]: 1 }, [armw]: 1, ...(args.elbow ? { [el]: args.elbow } : {}) });
	b.hold(held, w, fg, armw, el, ...(look ? ["head_yaw", "head_pitch"] : []));
	if (!cut) b.at(end, { [w]: 0, [fg]: { ...state[fg], [preset]: 0 }, ...(wasFk ? { [armw]: 0 } : {}), ...(head ?? {}) });
	// the fingers' prop is <anchor>Grip, unless the spec (or another skill) has a prop of that name of its own: its points
	// would replace these (session 7f15b4ae: props.ballGrip for a carry broke reachGrip on anchor "ball")
	const S = k === "l" ? "Left" : "Right", fingersProp = { hand: k, origin: [`${S}HandIndex2`, `${S}HandMiddle2`], points: { fingers: graspPoint(grasp, k) } };
	const prop = freeName(ctx.props, `${name}Grip`, k, fingersProp);
	const def = args.define ? { [name]: args.define } : {};
	// the hand may touch what it grips: an object, or the other person (people.js) whose joint the anchor is on
	const a = args.define ?? ctx.anchors?.[name], obj = a?.kind === "object" ? a.object : a?.kind === "person" ? `person:${a.person}` : null;
	return {
		keys: b.keys, end: cut ? last : ctx.f0 + reach + hold + release, ...(cut ? { cut: `${held < reach + hold ? "hold" : "release"} cut at f${last} (hold to the end)` } : {}), anchors: def,
		props: { [prop]: fingersProp },
		fits: [{ side: k, anchor: name, effector: { prop, point: "fingers" }, ...(args.orient === false ? { orient: false } : {}) }],
		checks: { contacts: [{ name: `fingers on ${name}`, point: `prop:${prop}.fingers`, target: `anchor:${name}`, tol: 0.04, when: w }],
			allow: touchable(ctx.scene, obj).map(object => ({ part: "hand", object, depth: 0.04 })) },
	};
}
