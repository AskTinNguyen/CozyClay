// C6. Repair: apply the QA patches (qa/patch.js) that make the motion better, round by round.
// Stub until lane D1: compiles once and changes nothing.
// Lane D1: each round tries the top 3 groups that carry a patch, one at a time; a patch is kept
// when the summed severity (qa/severity.js) drops, else undone; a round that keeps nothing ends
// the repair. Deterministic, at most 20 s.

/**
 * repairSpec(spec, { rounds }, compile) -> { spec, result, repair }
 * @param {object} spec  the agent's spec (patches address it)
 * @param {{ rounds: number }} opts  1..8
 * @param {(spec: object) => object} compile  spec -> pipeline.js compileSpec result (qa.groups[i].patch)
 * @returns {{ spec: object, result: object, repair: { rounds: number, compiles: number,
 *   applied: { kind: string, subject: string, patch: object[], severity: number[] }[], rejected: number } }}
 */
export function repairSpec(spec, opts, compile) {
	return { spec, result: compile(spec), repair: { rounds: 0, compiles: 1, applied: [], rejected: 0 } };
}
