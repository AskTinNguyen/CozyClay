// Goals (C8): what the motion must achieve, measured on the compiled frames. A goal names one
// predicate and the frames it must hold on (at: an absolute frame or [f0, f1]):
//   near:  [a, b]  refDistance(a, b) <= tol (default 0.05 m)
//   above: [a, b]  a.y - b.y >= by (default 0 m)
//   moved: ref     an object's point (default its base) is at least by (default 0.05 m) from
//                  where the scene put it; any other point ref (prop:, joint:, landmark:, anchor:)
//                  gets at least by from where it was at at[0]: one value, its farthest frame
// mode "all" (default) needs every frame of at, "any" one of them. Each goal answers one result
// { name, kind, ok, value, at, need }: for "all" the frame closest to failing (or the worst
// failure), for "any" the best frame. A failed goal adds GOAL issues (value = the shortfall,
// limit 0): "all" one per failing frame, so the group's count and first..last show how much of
// at fails and the search (search.js) sees progress; "any" one, at the best frame. Issue frames
// index out.frames (out.f0 + i); goals[].at and every frame in a message are absolute.
import { refPoint, refDistance } from "../refs.js";
import { partsOf } from "../object-pose.js";
import { add, apply, len, sub } from "../compiler/math.js";
import { m3 } from "./fmt.js";

/** The goal predicates, one per goal. */
export const GOAL_KINDS = ["near", "above", "moved"];
const DEFAULT_NEED = { near: 0.05, above: 0, moved: 0.05 };

/** The predicates goal g names (validation wants exactly one). */
export const goalKinds = g => GOAL_KINDS.filter(k => g?.[k] !== undefined);
/** A goal's name: its own, else its place in spec.goals ("goals[1]", which groupKey keeps apart). */
export const goalName = (g, i) => g.name ?? `goals[${i}]`;
/** The bound: tol for near, by for above and moved. */
export const goalNeed = (g, kind) => (kind === "near" ? g.tol : g.by) ?? DEFAULT_NEED[kind];

/** moved measures the named point of an object ref (its base when none is named), any other ref as it is. */
export const movedRef = ref => (!ref.startsWith("object:") || /\.(center|top|base)$/.test(ref) ? ref : `${ref}.base`);

/** Where the scene put the point of a moved object ref: the same AABB point refs.js answers, from the scene boxes. */
function scenePoint(scene, ref) {
	const [, id, which] = /^object:(.+)\.(center|top|base)$/s.exec(movedRef(ref)) ?? [];
	const boxes = partsOf(scene, id).map(p => scene.objects[p]);
	if (!boxes.length) return null;
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
	for (const b of boxes) for (const x of [-1, 1]) for (const y of [0, 2]) for (const z of [-1, 1]) {
		const p = add(b.pos, apply(b.R, [x * b.half[0], y * b.half[1], z * b.half[2]]));
		for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
	}
	const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
	return which === "top" ? [c[0], hi[1], c[2]] : which === "base" ? [c[0], lo[1], c[2]] : c;
}

/** The measured value of goal g at absolute frame f (metres), or null when a ref is unknown there. */
function measure(out, g, kind, f, home) {
	if (kind === "near") return refDistance(out, f, g.near[0], g.near[1]);
	if (kind === "above") {
		const a = refPoint(out, f, g.above[0]), b = refPoint(out, f, g.above[1]);
		return a && b ? a[1] - b[1] : null;
	}
	const p = home && refPoint(out, f, movedRef(g.moved));
	return p ? len(sub(p, home)) : null;
}

/** Where a moved goal measures from: an object's point where the scene put it, any other point where it is at at[0]. */
export const movedHome = (out, g) => (g.moved.startsWith("object:") ? scenePoint(out.ctx.scene, g.moved) : refPoint(out, Array.isArray(g.at) ? g.at[0] : g.at, g.moved));

/** How far value v is from meeting the bound (> 0 fails). */
const shortOf = (kind, v, need) => (kind === "near" ? v - need : need - v);
const round4 = x => Math.max(1e-4, Math.round(x * 1e4) / 1e4);

function message(name, kind, row, need, any, from) {
	const where = any ? `f${row.f}, the best of f${any[0]}-f${any[1]}` : `f${row.f}`;
	if (kind === "near") return `${name}: ${m3(row.v)} m at ${where} (needs <= ${need})`;
	if (kind === "above") return `${name}: ${m3(row.v)} m above at ${where} (needs >= ${need})`;
	return `${name}: moved ${m3(row.v)} m${from === undefined ? "" : ` from f${from}`} at ${where} (needs >= ${need})`;
}

/**
 * goalChecks(out, goals) -> { issues, results }
 * @param {object} out  compileMotion result (refs.js reads it)
 * @param {object[]} goals  spec.goals
 * @returns {{ issues: object[], results: { name: string, kind: string, ok: boolean, value: number, at: number, need: number }[] }}
 */
export function goalChecks(out, goals) {
	const issues = [], results = [], f0 = out.f0 ?? 0, last = f0 + (out.frames?.length ?? 0) - 1;
	goals.forEach((g, i) => {
		const kind = goalKinds(g)[0];
		if (!kind) return;
		const name = goalName(g, i), need = goalNeed(g, kind), [a, b] = Array.isArray(g.at) ? g.at : [g.at, g.at];
		const home = kind === "moved" ? movedHome(out, g) : null, from = kind === "moved" && !g.moved.startsWith("object:") ? a : undefined;
		let rows = [];
		for (let f = Math.max(a, f0); f <= Math.min(b, last); f++) {
			const v = measure(out, g, kind, f, home);
			if (v !== null) rows.push({ f, v, short: shortOf(kind, v, need) });
		}
		// a windowed trial compile (search.js) may not reach at; those frames cannot change there
		if (!rows.length) return;
		// a point's moved is one value: the farthest it gets from where it was at at[0]
		if (from !== undefined) rows = [rows.reduce((p, r) => (r.v > p.v ? r : p))];
		const any = g.mode === "any";
		const pick = rows.reduce((p, r) => ((any ? r.short < p.short : r.short > p.short) ? r : p));
		const ok = pick.short <= 0;
		results.push({ name, kind, ok, value: m3(pick.v), at: pick.f, need });
		if (ok) return;
		for (const r of any ? [pick] : rows.filter(r => r.short > 0)) {
			issues.push({ kind: "GOAL", msg: message(name, kind, r, need, any && a !== b ? [a, b] : null, from), frame: r.f - f0, value: round4(r.short), limit: 0 });
		}
	});
	return { issues, results };
}
