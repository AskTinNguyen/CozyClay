// C6. Repair's second move: a QA group just past its limit that carries no patch. Its cause names
// what made it, and a skill arg or a key time maps to the geometry too indirectly for a hint to
// predict (in the cup take, firstStep -1 cm cleared a thigh hit but a 5.04 cm/f^2 pop appeared;
// step did nothing). A compile is cheap, so repair tries a few small changes instead and keeps
// the best (repair.js), like an automatic { range } that stays near the agent's value:
//   cause "... use[i] <skill> ..."          each arg in SKILL_INFO[skill].tune, 1 then 2 steps
//                                             either way, from the arg as sent or its default
//   SPEED/POP "between keys[a] fA and keys[b] fB" (the agent's keys)
//                                             key a 1 or 2 frames earlier, key b later
// Every candidate is a JSON Patch on the agent's spec; the order is fixed, so the search is
// deterministic. Least-change candidates come first, so a tie keeps the smaller edit.
import { excessOf } from "./qa/severity.js";
import { SKILL_INFO } from "./skills/info.js";

const NEAR = 0.5, STEPS = [-1, 1, -2, 2];
const isNum = x => typeof x === "number" && Number.isFinite(x);

/** A group no more than half its limit (or 5 mm, for small limits) past it. */
const nearLimit = g => excessOf(g) <= NEAR * Math.max(Math.abs(g.limit), 0.01);

/** use[i] <skill>: one patch per tune arg and step, smallest steps first. */
function skillCandidates(cause, spec) {
	const m = /\buse\[(\d+)\] (\w+)/.exec(cause), i = Number(m?.[1]), u = m && spec.use?.[i];
	const info = m && u?.skill === m[2] ? SKILL_INFO[u.skill] : null;
	if (!info?.tune) return [];
	const out = [];
	for (const n of [1, 2]) for (const [arg, step] of Object.entries(info.tune)) {
		const schema = info.args[arg] ?? {}, now = u.args?.[arg] ?? schema.default;
		if (!isNum(now)) continue;
		for (const sg of STEPS.filter(s => Math.abs(s) === n)) {
			const raw = now + sg * step, value = schema.type === "integer" ? Math.round(raw) : Math.round(raw * 1e4) / 1e4;
			if (!(value > 0) || value === now) continue;
			out.push(u.args ? [{ op: u.args[arg] === undefined ? "add" : "replace", path: `/use/${i}/args/${arg}`, value }]
				: [{ op: "add", path: `/use/${i}/args`, value: { [arg]: value } }]);
		}
	}
	return out;
}

/** SPEED/POP between two of the agent's keys: more frames between them, 1 then 2. */
function keyCandidates(g, cause, spec) {
	if (g.kind !== "SPEED" && g.kind !== "POP") return [];
	const m = /between keys\[(\d+)\] f(\d+) and keys\[(\d+)\] f(\d+)/.exec(cause);
	if (!m) return [];
	const [a, fa, b, fb] = m.slice(1).map(Number), keys = spec.keys ?? [];
	if (keys[a]?.f !== fa || keys[b]?.f !== fb) return [];
	const last = Number.isInteger(spec.frames) ? spec.frames - 1 : Infinity, out = [];
	for (const n of [1, 2]) {
		if (fa - n >= 0) out.push([{ op: "replace", path: `/keys/${a}/f`, value: fa - n }]);
		if (fb + n <= last) out.push([{ op: "replace", path: `/keys/${b}/f`, value: fb + n }]);
	}
	return out;
}

/**
 * tuneCandidates(g, spec) -> patch[] (each a JSON Patch on spec; [] when the group is not near its
 * limit, already carries a patch, or its cause names nothing tunable)
 */
export function tuneCandidates(g, spec) {
	if (g.patch || typeof g.cause !== "string" || !nearLimit(g)) return [];
	return [...skillCandidates(g.cause, spec), ...keyCandidates(g, g.cause, spec)];
}
