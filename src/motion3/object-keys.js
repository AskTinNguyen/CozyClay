// C14. Held-object keys: spec.objects[id].keys = [{ f, pos, rot }] on a carry entry. Each key is
// the world pose of the object's root (the group root for a group id, else the body: its base
// pivot, rot a quaternion [x, y, z, w]) at absolute frame f, grab <= f <= release.
//   between keys    a cubic Hermite on pos and the same in rotation-vector space on rot (squad
//                   like), Catmull-Rom tangents through inner keys, zero at the first and last key
//   around the span the hand blends from the plain carry into the keyed span over KEY_BLEND frames
//                   (inside grab..release; smoothstep), so nothing jumps
//   the object leads the hand: compile.js asks holdHook for the palm frame the keys put the grip
//                   at, palm = key o attach^-1, and pose.js solves the hand to it (compiler/hold.js)
// The object itself is still drawn in the hand (object-pose.js): the residual is what the arm
// and the wrist could not reach, and QA reports it (qa/key-checks.js).
import { isCarried, carriedPose, compose, relative } from "./carried.js";
import { groupsOf } from "./scene.js";
import { restState } from "./compiler/skeleton.js";
import { add, scale, sub, apply, T, matFromQuat, quatFromMat } from "./compiler/math.js";
import { qmul, qconj, qlog, qexp, qrot, qdot, qnorm } from "./compiler/quat.js";
import { keyRots } from "./key-aim.js";
import { holdCost } from "./compiler/hold.js";
import { polePlan, smoothPath, smoothed } from "./hold-plan.js";
import { secondGrip, secondHold, gripGate } from "./second-hand.js";
import { SIDES } from "./compiler/pose.js";

/** Frames over which the hand blends into and out of the keyed span. */
export const KEY_BLEND = 8;

const smooth = x => x * x * (3 - 2 * x);
/** [grab, release] in absolute frames of `out` (object-pose.js spanOf, kept here to stay out of its import cycle). */
const spanIn = (out, o) => { const map = f => (out.timeMap ? Math.round(out.timeMap(f)) : f); return [map(o.grab ?? 0), o.release === undefined ? out.frameCount - 1 : map(o.release)]; };
const invert = p => { const Rt = T(p.R); return { pos: scale(apply(Rt, p.pos), -1), R: Rt }; };

/** The keys of entry o as a curve: times (after a retime), positions, quaternions on one hemisphere (aim keys resolved: key-aim.js), tangents. */
export function curveOf(o, map, plain, strain) {
	const keys = [...o.keys].sort((a, b) => a.f - b.f), t = keys.map(k => map(k.f)), p = keys.map(k => k.pos.slice()), q = [];
	const rots = keyRots(keys, i => plain(t[i]), strain && ((i, r) => strain(t[i], keys[i].pos, r)));
	for (const r of rots) { const n = qnorm(r); q.push(q.length && qdot(q[q.length - 1], n) < 0 ? n.map(v => -v) : n); }
	const last = keys.length - 1, rate = i => scale(qlog(qmul(qconj(q[i]), q[i + 1])), 1 / (t[i + 1] - t[i]));
	const tangent = (i, of) => (i === 0 || i === last ? [0, 0, 0] : scale(add(scale(of(i), t[i] - t[i - 1]), scale(of(i - 1), t[i + 1] - t[i])), 1 / (t[i + 1] - t[i - 1])));
	const m = p.map((_, i) => tangent(i, j => scale(sub(p[j + 1], p[j]), 1 / (t[j + 1] - t[j])))), w = q.map((_, i) => tangent(i, rate));
	return { t, p, q, m, w, rots };
}

const curves = new WeakMap();
/**
 * The key curve of spec.objects[id] in `out` (cached per compile result, time map and baked
 * channels: an aim key turns from the plain carry at its frame, and one without roll takes the
 * roll the arm holds there most easily).
 */
export function curveIn(out, id) {
	if (!curves.has(out)) curves.set(out, new Map());
	const cache = curves.get(out), map = out.timeMap, baked = out.baked, had = cache.get(id);
	if (!had || had.map !== map || had.baked !== baked) {
		const hold = out.ctx.hold, solved = new Map(), at = t => { const f = Math.round(t); if (!solved.has(f)) solved.set(f, hold.plainFrame(f).s); return solved.get(f); };
		const plain = t => quatFromMat(hold.carryOn(id, at(t)).R), strain = (t, pos, q) => hold.strainOn(id, at(t), { pos, R: matFromQuat(q) });
		cache.set(id, { map, baked, curve: curveOf(out.ctx.spec.objects[id], f => (map ? map(f) : f), plain, strain) });
	}
	return cache.get(id).curve;
}

/** World pose { pos, R } the keys ask for at absolute frame f (held at the first / last key outside them). */
export function keyedPose({ t, p, q, m, w }, f) {
	const n = t.length;
	if (n === 1 || f <= t[0]) return { pos: p[0].slice(), R: matFromQuat(q[0]) };
	if (f >= t[n - 1]) return { pos: p[n - 1].slice(), R: matFromQuat(q[n - 1]) };
	let i = 0;
	while (f > t[i + 1]) i++;
	const h = t[i + 1] - t[i], u = (f - t[i]) / h, u2 = u * u, u3 = u2 * u;
	const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
	const pos = add(add(scale(p[i], h00), scale(m[i], h * h10)), add(scale(p[i + 1], h01), scale(m[i + 1], h * h11)));
	// rotation: q_i exp(v), v a Hermite in q_i's frame from 0 to the step to q_i+1 (the end tangent turned into that frame)
	const step = qmul(qconj(q[i]), q[i + 1]), d = qlog(step);
	const v = add(add(scale(d, h01), scale(w[i], h * h10)), scale(qrot(step, w[i + 1]), h * h11));
	return { pos, R: matFromQuat(qmul(q[i], qexp(v))) };
}

/** 0..1: how much the keys lead the hand at absolute frame f (1 from the first to the last key). */
function leadWeight(curve, [grab, release], f) {
	const t0 = curve.t[0], t1 = curve.t[curve.t.length - 1];
	if (f < grab || f > release) return 0;
	if (f >= t0 && f <= t1) return 1;
	const b = f < t0 ? Math.min(KEY_BLEND, t0 - grab) : Math.min(KEY_BLEND, release - t1), gap = f < t0 ? t0 - f : f - t1;
	return b > 0 && gap < b ? smooth(1 - gap / b) : 0;
}

/** The keyed carry entries: [[id, entry]]. */
export const keyedEntries = spec => Object.entries(spec.objects ?? {}).filter(([, o]) => isCarried(o) && o.keys?.length);

/**
 * The hooks a compile needs when some carry has keys (else null): lead(k, f, s, c) -> { w,
 * palm, measure, pole? } | null for pose.js hooks.hold (the holding hand, or a left hand anchored
 * to the carry: second-hand.js), and attach(id) -> the object in the palm frame (the
 * plain carry's offset: at/along, or the grab-frame offset solved without the keys, so the keys
 * never feed back into it). For aim keys (key-aim.js): plainFrame(f) solves frame f without the
 * keys (solveLed(f) with them, the second hands left out: what a second hand's roll is planned
 * on), carryOn(id, s) is where the plain carry holds id on such a pose (where an aim key turns
 * from) and strainOn(id, s, pose) the arm's cost of holding id at world pose { pos, R } there
 * (compiler/hold.js holdCost, the roll of an aim key without one).
 */
export function holdHook(ctx, out, solvePlain, solveLed) {
	const { sk, spec, scene } = ctx, held = keyedEntries(spec);
	if (!held.length) return null;
	const palmOf = (o, s) => carriedPose(sk, spec, s, { prop: o.prop }), attached = new WeakMap(), attaching = new Set();
	const attach = id => {
		if (!attached.has(out.baked)) attached.set(out.baked, new Map());
		const cache = attached.get(out.baked), o = spec.objects[id];
		if (cache.has(id)) return cache.get(id);
		const rest = scene?.objects?.[id] ?? groupsOf(scene)[id], group = !scene?.objects?.[id] && !!rest;
		const keeps = o.at === undefined && o.along === undefined && (group || o.grab !== undefined);
		// the grab frame solved without the keys: a left hand anchored on id reads it there (object-pose.js), where this offset puts it
		attaching.add(id);
		let s;
		try { s = keeps ? solvePlain(spanIn(out, o)[0]).s : restState(sk); } finally { attaching.delete(id); }
		const a = relative(palmOf(o, s), keeps ? ctx.restingAt?.(id, spanIn(out, o)[0]) ?? { pos: rest.pos, R: rest.R } : carriedPose(sk, spec, s, o));
		cache.set(id, a);
		return a;
	};
	const carryOn = (id, s) => compose(palmOf(spec.objects[id], s), attach(id));
	const strainOn = (id, s, pose) => { const o = spec.objects[id]; return holdCost(sk, s, SIDES[spec.props[o.prop].hand], compose(pose, invert(attach(id))), palmOf(o, s)); };
	const heldAt = (id, o, f) => {
		const curve = curveIn(out, id), w = leadWeight(curve, spanIn(out, o), f);
		return w > 0 ? { w, palm: compose(keyedPose(curve, f), invert(attach(id))), measure: s => palmOf(o, s) } : null;
	};
	// the elbow's planned path over the frames the keys lead (hold-plan.js), once per baked channels and time map
	const plans = new WeakMap();
	const planOf = (id, o) => {
		if (!plans.has(out.baked)) plans.set(out.baked, new Map());
		const cache = plans.get(out.baked), had = cache.get(id);
		if (had && had.map === out.timeMap) return had.plan;
		const [grab, release] = spanIn(out, o), frames = [];
		for (let f = Math.max(0, grab); f <= Math.min(out.frameCount - 1, release); f++) if (leadWeight(curveIn(out, id), [grab, release], f) > 0) frames.push(f);
		const plan = polePlan(sk, SIDES[spec.props[o.prop].hand], frames, f => ({ s: solvePlain(f).s, held: heldAt(id, o, f) }));
		cache.set(id, { map: out.timeMap, plan });
		return plan;
	};
	// a left hand anchored to a carry the right hand holds grips it too (second-hand.js): its roll about the object, planned over the frames like the elbow
	let planning = false;
	const gripAt = (id, s, c) => { const R = carryOn(id, s).R; return secondGrip(sk, spec, id, s, c, [R[0][1], R[1][1], R[2][1]]); };
	const rollPlans = new WeakMap();
	const rollsOf = (id, o) => {
		if (!rollPlans.has(out.baked)) rollPlans.set(out.baked, new Map());
		const cache = rollPlans.get(out.baked), had = cache.get(id);
		if (had && had.map === out.timeMap) return had.plan;
		const [grab, release] = spanIn(out, o), plan = new Map();
		planning = true;
		let run = [];
		const flush = () => {
			const x = smoothPath((i, r) => run[i].grip.cost(r), (i, r) => run[i].grip.point(r), run.map(g => g.grip.softmin())), gate = smoothed(run.map((g, i) => gripGate(g.grip, x[i])));
			// then its elbow's path at those rolls, like the holding elbow's (hold-plan.js)
			const arm = i => run[i].grip.arm(x[i]), th = smoothPath((i, t) => arm(i).at(t).cost, (i, t) => arm(i).at(t).elbow, run.map((_, i) => arm(i).best.th));
			run.forEach((g, i) => plan.set(g.f, { roll: x[i], gate: gate[i], pole: arm(i).at(th[i]).pv }));
			run = [];
		};
		for (let f = Math.max(0, grab); f <= Math.min(out.frameCount - 1, release); f++) {
			const solved = leadWeight(curveIn(out, id), [grab, release], f) > 0 ? solveLed(f) : null, grip = solved && gripAt(id, solved.s, solved.c);
			if (grip) run.push({ f, grip }); else if (run.length) flush();
		}
		if (run.length) flush();
		planning = false;
		cache.set(id, { map: out.timeMap, plan });
		return plan;
	};
	// the hand that holds a keyed carry follows its keys
	const lead = (k, f, s, c) => {
		for (const [id, o] of held) {
			const h = spec.props?.[o.prop]?.hand === k ? heldAt(id, o, f) : null;
			if (h) return { ...h, pole: planOf(id, o).get(f) };
			const w = k === "l" && s && !planning ? leadWeight(curveIn(out, id), spanIn(out, o), f) : 0, grip = w > 0 ? gripAt(id, s, c) : null;
			const planned = grip && rollsOf(id, o).get(f), roll = planned?.roll ?? grip?.softmin();
			if (grip) return secondHold(grip, w, roll, planned?.gate ?? gripGate(grip, roll), planned?.pole ?? grip.arm(roll).best.pole);
		}
		return null;
	};
	return { lead, attach, attaching: id => attaching.has(id), plainFrame: solvePlain, carryOn, strainOn };
}
