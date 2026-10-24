// A coverage pattern -> a shot plan: the frame range split into the pattern's
// shots (evenly, or at the cuts asked for), each shot's technique stack and
// subject, and the side of the line every camera keeps. The side is chosen by
// compiling each stack both ways and keeping the one whose camera stays on
// the first shot's side of the line between the two principals, so the plan
// cuts clean by construction. Pure: camera.cover applies it through
// camera.applyTechnique; the MCP tool plans and checks it in memory.
import { compileStack } from "../camera-techniques/compile.js";
import { lineSide } from "./cut-geometry.js";
import { framingOf } from "./composition.js";
import { coveragePattern } from "./patterns.js";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const DEG = Math.PI / 180;
const MIN_SHOT_FRAMES = 6;

/** Shot ranges for `count` shots over [startFrame, endFrame] (inclusive), or at explicit cut frames. */
export function splitRange({ startFrame, endFrame }, count, cuts = null) {
	const length = endFrame - startFrame + 1;
	const marks = cuts?.length ? [...new Set(cuts.map(Math.round))].filter((frame) => frame > startFrame && frame <= endFrame).sort((a, b) => a - b)
		: Array.from({ length: count - 1 }, (_, i) => startFrame + Math.round(((i + 1) * length) / count));
	const edges = [startFrame, ...marks, endFrame + 1];
	const ranges = edges.slice(1).map((edge, i) => ({ startFrame: edges[i], endFrame: edge - 1 }));
	const short = ranges.find((range) => range.endFrame - range.startFrame + 1 < MIN_SHOT_FRAMES);
	if (short) fail("INVALID_RANGE", `Shot ${short.startFrame}-${short.endFrame} would be under ${MIN_SHOT_FRAMES} frames; widen the range or ask for fewer shots.`);
	return ranges;
}

/** The camera positions a compiled plan starts and ends on (keys, or the rail's ends). */
function cameraEnds(plan) {
	if (plan.keys?.length) return [plan.keys[0].framing.position, plan.keys.at(-1).framing.position];
	if (plan.rail) return [plan.rail.points[0], plan.rail.points.at(-1)];
	return [];
}

/**
 * @param {string} patternId
 * @param {object} ctx { cast: visible rows { id, name, x, z, rot, height, eye? }, subjects: [aId, bId?], range: { startFrame, endFrame },
 *   filmback, count?, cuts?, beat?: "insert"|"close-up", side?: "left"|"right" (first shot), lineSign?: +1|-1 (keep that side of the A-B line), composition? }
 */
export function planCoverage(patternId, ctx) {
	const pattern = coveragePattern(patternId) ?? fail("INVALID_ARGUMENT", `Unknown coverage pattern "${patternId}".`);
	const byId = (id) => ctx.cast.find((row) => row.id === id);
	const a = byId(ctx.subjects?.[0]) ?? fail("STALE_TARGET", `${ctx.subjects?.[0] ?? "The first cast member"} is not a visible character in this scene.`);
	const others = ctx.cast.filter((row) => row.id !== a.id).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
	const b = byId(ctx.subjects?.[1]) ?? others[0] ?? null, notes = [];
	if (pattern.cast > 1 && !b) fail("TARGET_NOT_READY", `${pattern.name} covers two characters; add a second character first.`);
	const rows = pattern.shots(ctx.count, ctx.beat).map((row) => ({ ...row, who: row.who === 1 && !b ? 0 : row.who }));
	const ranges = splitRange(ctx.range, ctx.cuts?.length ? ctx.cuts.length + 1 : rows.length, ctx.cuts);
	if (ranges.length !== rows.length) {
		// Explicit cuts decide the count: the pattern repeats (a reverse pattern alternates) or is cut short.
		const base = pattern.shots(ranges.length, ctx.beat);
		rows.splice(0, rows.length, ...ranges.map((_, i) => ({ ...base[i % base.length], who: base[i % base.length].who === 1 && !b ? 0 : base[i % base.length].who })));
	}
	const r = (a.rot ?? 0) * DEG, line = b ? { from: a, direction: { x: b.x - a.x, z: b.z - a.z } } : { from: a, direction: { x: Math.sin(r), z: Math.cos(r) } };
	const compile = (row, range, side) => compileStack(row.stack, { subject: row.who === 1 ? b : a, cast: ctx.cast, shot: range, filmback: ctx.filmback,
		...(ctx.composition && !row.stack.some((item) => ["two-shot", "master-shot"].includes(item.id)) ? { composition: ctx.composition } : {}) }, { side });
	const sides = (plan) => cameraEnds(plan).map((point) => lineSide(point, line.from, line.direction));
	// lineSign: the side of the A-B line the neighbouring shot already holds (+1 / -1), so a pattern laid next to it keeps that side.
	let wanted = ctx.lineSign ? Math.sign(ctx.lineSign) : 0;
	const shots = rows.map((row, i) => {
		const range = ranges[i], subject = row.who === 1 ? b : a, first = i === 0 ? ctx.side ?? "right" : "right";
		const stacks = [row.stack, ...(i === 0 && !wanted ? [] : row.alternates ?? [])];
		const tries = stacks.flatMap((stack) => [first, first === "right" ? "left" : "right"].map((side) => ({ side, stack, plan: compile({ ...row, stack }, range, side) })));
		let pick = tries[0];
		if (i === 0 && !wanted) wanted = Math.sign(sides(pick.plan).reduce((sum, value) => sum + value, 0)) || 1;
		else {
			const fits = (entry) => sides(entry.plan).every((value) => Math.sign(value) === wanted || Math.abs(value) <= 0.2);
			pick = tries.find(fits) ?? tries.sort((p, q) => sides(q.plan).reduce((s, v) => s + v * wanted, 0) - sides(p.plan).reduce((s, v) => s + v * wanted, 0))[0];
			if (!fits(pick)) notes.push(`${row.role} on ${subject.name ?? subject.id} cannot stay on the line's side; check that cut`);
		}
		const groupShot = row.stack.some((item) => ["two-shot", "master-shot"].includes(item.id)) || row.role === "Master";
		const name = `${pattern.tag} ${i + 1} · ${row.role}${groupShot ? "" : ` ${(subject.name ?? subject.id).split(",")[0]}`}`;
		return { index: i, name, role: row.role, subjectId: subject.id, ...range, stack: pick.stack, side: pick.side, plan: pick.plan };
	});
	return { pattern: pattern.id, name: pattern.name, subjects: [a.id, ...(b ? [b.id] : [])], lineSide: wanted > 0 ? "left" : "right", shots, notes: [...new Set(notes)] };
}

/** A planned shot as the document holds one (keys or a rail), so the cut rules can read a plan in memory. */
export function plannedShot(row, filmback = {}) {
	const { plan } = row, base = { id: `plan-${row.index + 1}`, name: row.name, startFrame: row.startFrame, endFrame: row.endFrame, kind: "clip", cast: {}, coverage: { subjectId: row.subjectId } };
	if (plan.rail) {
		const { points, height, aimHeight, focalMm, response } = plan.rail;
		return { ...base, cameraKeys: [], camera: { mode: "rail", cameraRail: points, craneHeight: { points: [{ t: 0, height }, { t: 1, height }] }, aim: { ids: [row.subjectId], height: aimHeight }, focalMm, ...(response ? { followCam: { response } } : {}) } };
	}
	return { ...base, camera: { mode: "keys" }, cameraKeys: (plan.keys ?? []).map((key, i) => ({ id: `key-${i}`, frame: key.frame, framing: framingOf(key.framing, filmback), ...(key.ease ? { ease: key.ease } : {}) })) };
}
