// A group or branching pattern -> a shot plan (group-coverage A2): the cast
// (three to six, or two speakers for a branching scene), each shot's stack,
// subject and the pair whose line it keeps, and each pair's side: outside the
// group, away from the others, so every pair's cameras sit on one side of
// its own line. A branching pattern compiles each setup once and repeats it,
// camera for camera, in every branch range. Pure, like plan.js, which lays the
// two-person patterns; planAnyCoverage picks between them.
import { compileStack } from "../camera-techniques/compile.js";
import { lineSide } from "./cut-geometry.js";
import { pairLabel } from "./cut-line.js";
import { planCoverage, plannedShot, splitRange } from "./plan.js";
import { checkCuts } from "./cut-rules.js";
import { groupPattern } from "./patterns-group.js";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const NEUTRAL_M = 0.2;
const nameOf = (row) => String(row.name ?? row.id).split(",")[0];

/** Members in order round their centre, starting from the first, so neighbours follow each other. */
function roundTheGroup(members) {
	const c = { x: members.reduce((s, r) => s + r.x, 0) / members.length, z: members.reduce((s, r) => s + r.z, 0) / members.length };
	const angle = (row) => Math.atan2(row.x - c.x, row.z - c.z), a0 = angle(members[0]);
	return [...members].sort((p, q) => ((angle(p) - a0 + 4 * Math.PI) % (2 * Math.PI)) - ((angle(q) - a0 + 4 * Math.PI) % (2 * Math.PI)));
}

/** The frame spans of each branch: explicit ranges, or the range split into `count` (default 2). */
function branchSpans(range, branches) {
	if (Array.isArray(branches) && branches.length) {
		const spans = [...branches].sort((a, b) => a.startFrame - b.startFrame);
		spans.forEach((span, i) => { if (span.endFrame < span.startFrame || (i && span.startFrame <= spans[i - 1].endFrame)) fail("INVALID_RANGE", `Branch ${span.startFrame}-${span.endFrame} is empty or overlaps the one before it.`); });
		return spans;
	}
	return splitRange(range, Math.max(2, Math.min(8, Number.isInteger(branches) ? branches : 2)));
}

/**
 * @param {string} patternId  a GROUP_PATTERNS id
 * @param {object} ctx { cast: visible rows, subjects: cast ids (the members, in order), range, filmback, branches?: count | [{ startFrame, endFrame }] }
 */
function planGroupCoverage(patternId, ctx) {
	const pattern = groupPattern(patternId) ?? fail("INVALID_ARGUMENT", `Unknown group pattern "${patternId}".`);
	const named = (ctx.subjects ?? []).filter(Boolean).map((id) => ctx.cast.find((row) => row.id === id) ?? fail("STALE_TARGET", `${id} is not a visible character in this scene.`));
	const first = named[0] ?? ctx.cast[0];
	// Unnamed members: the nearest others to the first, up to what the pattern takes.
	let members = named.length >= pattern.cast ? named : [...named, ...ctx.cast.filter((row) => !named.includes(row)).sort((p, q) => Math.hypot(p.x - first.x, p.z - first.z) - Math.hypot(q.x - first.x, q.z - first.z))].slice(0, Math.max(pattern.cast, named.length));
	if (members.length < pattern.cast) fail("TARGET_NOT_READY", `${pattern.name} covers ${pattern.cast} people or more; the scene shows ${members.length}.`);
	if (members.length > pattern.castMax) fail("INVALID_ARGUMENT", `${pattern.name} covers up to ${pattern.castMax} people; name ${pattern.castMax} or fewer.`);
	if (pattern.id === "group-singles" || (pattern.branching && members.length > 2)) members = roundTheGroup(members);
	if (pattern.id !== "triangle-dialogue") return layOut(pattern, members, ctx);
	// A triangle: the pairs are the same in any order, but which pair opens (and the master keeps) decides the cuts between them.
	// Try the orders from the one asked for and keep the first that cuts clean, else the one with the fewest flags.
	const [a, b, c] = members, scored = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]].map((order) => {
		const plan = layOut(pattern, order, ctx);
		return { plan, flags: checkCuts(plan.shots.map((row) => ({ ...plannedShot(row, ctx.filmback), ...(row.line ? { line: { between: row.line } } : {}) })), { cast: ctx.cast, filmback: ctx.filmback }).issueCount + plan.notes.length };
	});
	return (scored.find((row) => row.flags === 0) ?? [...scored].sort((p, q) => p.flags - q.flags)[0]).plan;
}

/** The plan of a group pattern for these members, in this order. */
function layOut(pattern, members, ctx) {
	const rows = pattern.shots(members.length), spans = pattern.branching ? branchSpans(ctx.range, ctx.branches) : [ctx.range];
	const ranges = spans.map((span) => splitRange(span, rows.length)), notes = [];
	// Each pair's side: away from the rest of the group (outside it); with nobody else, the first shot picks it.
	const wanted = new Map();
	const pairOf = (row) => (row.pair ? row.pair.map((i) => members[i]) : null), keyOf = (pair) => pair.map((row) => row.id).sort().join("|");
	for (const pair of rows.map(pairOf).filter(Boolean)) {
		const [a, b] = pair, others = members.filter((row) => !pair.includes(row)), d = { x: b.x - a.x, z: b.z - a.z };
		const lean = others.reduce((sum, row) => sum + lineSide(row, a, d), 0);
		if (!wanted.has(keyOf(pair)) && Math.abs(lean) > NEUTRAL_M) wanted.set(keyOf(pair), -Math.sign(lean));
	}
	const compile = (row, range, side) => compileStack(row.stack, { subject: members[row.who], cast: ctx.cast, shot: range, filmback: ctx.filmback }, { side });
	const ends = (plan) => (plan.keys?.length ? [plan.keys[0].framing.position, plan.keys.at(-1).framing.position] : plan.rail ? [plan.rail.points[0], plan.rail.points.at(-1)] : []);
	const sides = (plan, pair) => ends(plan).map((point) => lineSide(point, pair[0], { x: pair[1].x - pair[0].x, z: pair[1].z - pair[0].z }));
	// Setups: compiled once on the first branch's range; later branches repeat the same stack and side.
	const setups = rows.map((row, i) => {
		const subject = members[row.who], over = row.over !== undefined ? members[row.over] : null, pair = pairOf(row);
		const stack = row.stack.map((item) => (over && item.id === "over-the-shoulder" ? { ...item, params: { ...item.params, over: over.id } } : item));
		const stacks = [stack, ...(pair ? row.alternates ?? [] : [])];
		const tries = stacks.flatMap((each) => ["right", "left"].map((side) => ({ side, stack: each, plan: compile({ ...row, stack: each }, ranges[0][i], side) })));
		let pick = tries[0];
		if (pair) {
			const key = keyOf(pair);
			if (!wanted.has(key)) wanted.set(key, Math.sign(sides(pick.plan, pair).reduce((s, v) => s + v, 0)) || 1);
			const fits = (entry) => sides(entry.plan, pair).every((value) => Math.sign(value) === wanted.get(key) || Math.abs(value) <= NEUTRAL_M);
			pick = tries.find(fits) ?? pick;
			// A master that cannot reach the outside (the group nearly in a line) sets its pair's side instead.
			if (!fits(pick) && row.role === "Master") wanted.set(key, Math.sign(sides(pick.plan, pair).reduce((s, v) => s + v, 0)) || wanted.get(key));
			else if (!fits(pick)) notes.push(`${row.role} on ${nameOf(subject)} cannot stay on its side of the ${pairLabel(pair)} line; check that cut`);
		}
		return { row, subject, stack: pick.stack, pair, side: pick.side, plan: pick.plan };
	});
	const shots = ranges.flatMap((branchRanges, b) => setups.map((setup, i) => {
		const range = branchRanges[i], shift = range.startFrame - ranges[0][i].startFrame, { row, subject, pair } = setup;
		const plan = shift ? (spans.length > 1 && (setup.plan.rail || range.endFrame - range.startFrame !== ranges[0][i].endFrame - ranges[0][i].startFrame) ? compile({ ...row, stack: setup.stack }, range, setup.side)
			: { ...setup.plan, keys: setup.plan.keys?.map((key) => ({ ...key, frame: key.frame + shift })) ?? null }) : setup.plan;
		const group = row.stack.some((item) => ["master-shot", "three-shot", "two-shot"].includes(item.id));
		const number = pattern.branching ? `${b + 1}.${i + 1}` : `${i + 1}`;
		return { index: b * setups.length + i, name: `${pattern.tag} ${number} · ${row.role}${group ? "" : ` ${nameOf(subject)}`}`, role: row.role, subjectId: subject.id, ...range,
			stack: setup.stack, side: setup.side, plan, line: pair ? pair.map((member) => member.id) : null, ...(row.setup ? { setup: row.setup, branch: b } : {}) };
	}));
	const lines = [...wanted].map(([key, sign]) => ({ between: key.split("|"), side: sign > 0 ? "left" : "right" }));
	return { pattern: pattern.id, name: pattern.name, subjects: members.map((row) => row.id), lineSide: lines.length === 1 ? lines[0].side : null, lines, shots, notes: [...new Set(notes)],
		...(pattern.branching ? { branches: spans.map((span) => ({ startFrame: span.startFrame, endFrame: span.endFrame })) } : {}) };
}

/** Any pattern: the group planner for a group or branching pattern, plan.js for the rest (the first two subjects). */
export const planAnyCoverage = (patternId, ctx) => (groupPattern(patternId) ? planGroupCoverage(patternId, ctx) : planCoverage(patternId, { ...ctx, subjects: (ctx.subjects ?? []).slice(0, 2) }));
