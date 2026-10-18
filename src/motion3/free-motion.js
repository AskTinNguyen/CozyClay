// C17. Objects nobody holds (a can inside a machine, a box on a shelf) move by keys and fall.
// spec.objects[id] with no prop, follow or hinge field, for a body or a group (its root):
//   keys  [{ f, pos, rot | aim (+ roll) }]   the world pose of its root (a body's base pivot, a group's
//         origin) at frame f, on the curve held keys use (object-keys.js keyedPose, C14). aim turns the
//         scene pose's +Y onto aim, then roll degrees about it. Before the first key of a run it stays
//         where it was (its scene pose, or where it landed), after the last it holds the last key.
//   fall  { at, onto?, bounce? } or a list   from where it is at frame `at` it drops straight down
//         under gravity (G m/s^2, no tumbling) onto the top of the highest still body under the centre of
//         its parts (onto: that object's top; nothing below: the floor, y 0), bounces at most once (bounce:
//         the restitution 0..0.6, default 0.25, never higher than BOUNCE_MAX m) and rests there.
// Keys and falls chain in frame order: a fall starts from the pose the keys before it leave (a key on the
// fall's own frame comes first), keys after a fall take over at their first frame.
// A carry (C3) takes fall too: before its grab (the hand finds it where it landed) or from its release on.
// A free object moves like a hinged one (compiler/compile.js objectTracks): an obstacle at its pose that
// frame, read through object-pose.js by refs, goals, probes, observations.near and QA. Pure over the spec,
// the scene and the time map (a retime moves its keys and falls with the body's keys): the body never
// moves it, and nothing it lands on moves (bodies a spec.objects entry moves are no support).
import { isCarried, compose, relative, movesRecord } from "./carried.js";
import { groupsOf } from "./scene.js";
import { curveOf, keyedPose } from "./object-keys.js";
import { add, apply, sub, T, quatFromMat } from "./compiler/math.js";

/** Gravity, m/s^2. */
export const G = 9.8;
/** The highest a bounce goes, metres. */
export const BOUNCE_MAX = 0.03;
const BOUNCE = 0.25, TOUCH = 0.005;
const HELD_OR_HINGED = ["prop", "follow", "pivot", "axis", "channel"];

/** A free entry (C17): no prop, follow or hinge field, and keys or fall. */
export const isFree = o => !!o && typeof o === "object" && !Array.isArray(o) && HELD_OR_HINGED.every(k => o[k] === undefined) && (o.keys !== undefined || o.fall !== undefined);
/** The falls of an entry (fall is one or a list), as given. */
const fallsOf = o => (o?.fall === undefined ? [] : Array.isArray(o.fall) ? o.fall : [o.fall]);

const restOf = (scene, id) => scene?.objects?.[id] ?? groupsOf(scene)[id] ?? null;
const partsIn = (scene, id) => Object.keys(scene?.objects ?? {}).filter(k => k === id || scene.objects[k].ancestors?.includes(id));

/** The 8 corners of a base-pivot box { pos, R, half }. */
function corners(box) {
	const out = [];
	for (const x of [-1, 1]) for (const y of [0, 2]) for (const z of [-1, 1]) out.push(add(box.pos, apply(box.R, [x * box.half[0], y * box.half[1], z * box.half[2]])));
	return out;
}
const topOf = box => Math.max(...corners(box).map(p => p[1]));
/** True when the vertical through x/z point p crosses the footprint of box. */
const under = (box, p) => { const q = apply(T(box.R), sub([p[0], box.pos[1] + box.half[1], p[2]], box.pos)); return Math.abs(q[0]) <= box.half[0] && Math.abs(q[2]) <= box.half[2]; };

/** Bodies a spec.objects entry moves (itself or a group above it): they hold nothing up. */
function moversIn(spec, scene) {
	const out = new Set();
	for (const [id, o] of Object.entries(scene?.objects ?? {})) if ([id, ...(o.ancestors ?? [])].some(k => movesRecord(spec.objects?.[k]))) out.add(id);
	return out;
}

/** The part boxes of `id` with its root at world pose `root`. */
function boxesAtRoot(scene, id, root) {
	const rest = restOf(scene, id);
	return partsIn(scene, id).map(p => ({ id: p, ...compose(root, relative(rest, scene.objects[p])), half: scene.objects[p].half }));
}

/** What `id` lands on from pose `start`: { support (a body id, or null for the floor), top, h (the drop, m) }. */
export function landingOf(spec, scene, id, start, onto = null) {
	const boxes = boxesAtRoot(scene, id, start), own = new Set(boxes.map(b => b.id)), movers = moversIn(spec, scene);
	if (!boxes.length) return { support: null, top: 0, h: 0 };
	const low = Math.min(...boxes.flatMap(b => corners(b).map(p => p[1])));
	const c = boxes.flatMap(corners).reduce((s, p) => add(s, p), [0, 0, 0]).map(v => v / (boxes.length * 8));
	const pool = (onto ? partsIn(scene, onto) : Object.keys(scene.objects)).filter(k => !own.has(k) && !movers.has(k));
	let best = null;
	for (const k of pool) {
		const box = scene.objects[k], top = topOf(box);
		if (under(box, c) && top <= low + TOUCH && (!best || top > best.top)) best = { support: k, top };
	}
	// onto an object that is not right below: its highest top, the agent placed it
	if (!best && onto) for (const k of pool) { const top = topOf(scene.objects[k]); if (top <= low + TOUCH && (!best || top > best.top)) best = { support: k, top }; }
	best ??= { support: null, top: 0 };
	return { ...best, h: Math.max(0, low - best.top) };
}

/** A fall from root pose `start` at (mapped) frame t0: its timing, its pose at a frame, where it rests. */
function fallPlan(spec, scene, id, start, t0, fall, fps) {
	const land = landingOf(spec, scene, id, start, fall.onto ?? null), h = land.h, tl = Math.sqrt(2 * h / G);
	const e = Math.min(0.6, Math.max(0, fall.bounce ?? BOUNCE)), vb = Math.min(e * G * tl, Math.sqrt(2 * G * BOUNCE_MAX)), tb = 2 * vb / G;
	const rest = { pos: [start.pos[0], start.pos[1] - h, start.pos[2]], R: start.R };
	const at = f => {
		const t = (f - t0) / fps;
		if (t <= 0) return start;
		const dy = t <= tl ? -0.5 * G * t * t : t <= tl + tb ? -h + vb * (t - tl) - 0.5 * G * (t - tl) ** 2 : -h;
		return { pos: [start.pos[0], start.pos[1] + Math.min(0, dy), start.pos[2]], R: start.R };
	};
	return { t0, land: t0 + tl * fps, end: t0 + (tl + tb) * fps, h, support: land.support, top: land.top, at, rest };
}

/** The events of an entry's falls and key runs in frame order (keys split into runs by the falls between them). */
function eventsOf(o, map, from = -Infinity, to = Infinity) {
	// a carry's keys pose it in hand (C14); only its falls are free
	const keys = isCarried(o) ? [] : [...(o.keys ?? [])].sort((a, b) => a.f - b.f);
	const falls = fallsOf(o).map(fl => ({ ...fl, t: map(fl.at) })).filter(fl => fl.t >= from && fl.t < to).sort((a, b) => a.t - b.t);
	const events = [];
	let run = [], i = 0;
	for (const k of keys) {
		while (i < falls.length && falls[i].t < map(k.f)) { if (run.length) events.push({ run }); run = []; events.push({ fall: falls[i++] }); }
		run.push(k);
	}
	if (run.length) events.push({ run });
	while (i < falls.length) events.push({ fall: falls[i++] });
	return events;
}

/** The pose events give at mapped frame f, starting from pose `start`; `keep` caches each fall's plan on its event. */
function walk(events, f, start, plan, keep = true) {
	let pose = start;
	for (const e of events) {
		if (e.run) {
			const { t } = e.curve;
			if (f < t[0]) return pose;
			if (f <= t[t.length - 1]) return keyedPose(e.curve, f);
			pose = keyedPose(e.curve, t[t.length - 1]);
		} else {
			if (f < e.fall.t) return pose;
			const p = keep ? (e.plan ??= plan(pose, e.fall)) : plan(pose, e.fall);
			if (f < p.end) return p.at(f);
			pose = p.rest;
		}
	}
	return pose;
}

const timelines = new WeakMap();
/** The events of entry o under time map `map`, cached per scene, entry and span (key curves built once). */
function timelineOf(ctx, id, o, map, part) {
	if (!timelines.has(ctx.scene)) timelines.set(ctx.scene, new Map());
	const cache = timelines.get(ctx.scene), key = `${id}|${part}|${ctx.grab}|${ctx.release}`, had = cache.get(key);
	if (had && had.map === map && had.o === o && had.spec === ctx.spec) return had.events;
	const rest = restOf(ctx.scene, id), m = map ?? (f => f), [from, to] = part === "before" ? [-Infinity, ctx.grab] : part === "after" ? [ctx.release, Infinity] : [-Infinity, Infinity];
	const events = eventsOf(o, m, from, to);
	for (const e of events) if (e.run) e.curve = curveOf({ keys: e.run }, m, () => quatFromMat(rest.R), null);
	cache.set(key, { map, o, spec: ctx.spec, events });
	return events;
}

const planner = (ctx, id) => (start, fall) => fallPlan(ctx.spec, ctx.scene, id, start, fall.t, fall, ctx.spec.fps ?? 30);

/**
 * World pose { pos, R } of the root of free entry `id` at absolute frame f (ctx = { spec, scene,
 * timeMap }): keys and falls (C17) from its scene pose. null for an id the scene does not know.
 */
export function freePoseAt(ctx, id, f) {
	const rest = restOf(ctx.scene, id), o = ctx.spec.objects?.[id];
	if (!rest || !o) return null;
	return walk(timelineOf(ctx, id, o, ctx.timeMap, "all"), f, { pos: rest.pos, R: rest.R }, planner(ctx, id));
}

/** Where carry `id` (entry o) is before its grab at absolute f: its scene pose, or where a fall before grab left it. */
export function beforeGrab(ctx, id, o, f, grab) {
	const rest = restOf(ctx.scene, id);
	if (!rest || !fallsOf(o).length) return rest && { pos: rest.pos, R: rest.R };
	return walk(timelineOf({ ...ctx, grab }, id, o, ctx.timeMap, "before"), f, { pos: rest.pos, R: rest.R }, planner(ctx, id));
}

/** Where carry `id` (entry o) is at absolute f after its release, from its release pose; null without a fall from the release on. */
export function afterRelease(ctx, id, o, f, release, releasePose) {
	const events = fallsOf(o).length ? timelineOf({ ...ctx, release }, id, o, ctx.timeMap, "after") : [];
	// the release pose comes from the solved body, which a rebake changes: plan these falls afresh
	return events.length ? walk(events, f, releasePose, planner(ctx, id), false) : null;
}

/** The falls of entry `id` as planned under the current time map, for readers (timeline, tests): [{ t0, land, end, h, support, top }]. */
export function fallPlans(ctx, id) {
	const o = ctx.spec.objects?.[id];
	if (!isFree(o)) return [];
	freePoseAt(ctx, id, Infinity);
	return timelineOf(ctx, id, o, ctx.timeMap, "all").filter(e => e.plan).map(({ plan: { t0, land, end, h, support, top } }) => ({ t0, land, end, h, support, top }));
}
