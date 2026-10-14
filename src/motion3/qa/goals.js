// Goals (C8): what the motion must achieve, measured on the compiled frames. Stub until lane G:
// no issues, no results.
// Lane G: one result per goal { name, kind: "near" | "above" | "moved", ok, value, at, need }
// (value = the measured distance / height / travel, at = the absolute frame it was measured at,
// need = the bound) and, for each failed goal, one issue { kind: "GOAL", msg, frame, value, limit:
// 0 } where value is the shortfall (> 0) and msg reads "cup at mouth: 0.31 m at f150 (needs <=
// 0.06)". Issue frames index out.frames (frame out.f0 + i); goals[].at is absolute. A failed goal
// makes qa.ok false; qa.goals lists the results.

/**
 * goalChecks(out, goals) -> { issues, results }
 * @param {object} out  compileMotion result (refs.js reads it)
 * @param {object[]} goals  spec.goals
 * @returns {{ issues: object[], results: { name: string, kind: string, ok: boolean, value: number, at: number, need: number }[] }}
 */
export function goalChecks(/* out, goals */) {
	return { issues: [], results: [] };
}
