// C6. Repair: apply the QA patches (qa/patch.js) that make the motion better, round by round.
// Each round takes the top 3 groups that carry a patch and tries them one at a time, each with
// the patch the latest compile gives that group; a patch is kept when the summed severity
// (qa/severity.js) drops, else undone. A round that keeps nothing ends the repair. The compiler
// is deterministic, so the repair is too; it stops starting new compiles after 20 s.
import { applyPatch } from "./json-patch.js";
import { groupKey } from "./qa/severity.js";

const TRIES = 3, LIMIT_MS = 20000;
const groupsOf = r => r?.qa?.groups ?? [];
const totalOf = r => groupsOf(r).reduce((sum, g) => sum + (g.severity ?? 0), 0);
const groupIn = (r, key) => groupsOf(r).find(g => groupKey(g) === key);

/**
 * repairSpec(spec, { rounds }, compile) -> { spec, result, repair }
 * @param {object} spec  the agent's spec (patches address it)
 * @param {{ rounds?: number }} opts  1..8 (default 4)
 * @param {(spec: object) => object} compile  spec -> pipeline.js compileSpec result (qa.groups[i].patch)
 * @returns {{ spec: object, result: object, repair: { rounds: number, compiles: number,
 *   applied: { kind: string, subject: string, patch: object[], severity: number[] }[], rejected: number } }}
 */
export function repairSpec(spec, opts, compile) {
	const want = Math.min(8, Math.max(1, Math.round(Number(opts?.rounds ?? 4)) || 4)), t0 = performance.now();
	const late = () => performance.now() - t0 >= LIMIT_MS;
	let current = spec, result = compile(spec), compiles = 1, rejected = 0, rounds = 0;
	const applied = [];
	while (rounds < want && !late()) {
		const keys = groupsOf(result).filter(g => g.patch).slice(0, TRIES).map(groupKey);
		if (!keys.length) break;
		rounds += 1;
		let kept = 0;
		for (const key of keys) {
			const g = groupIn(result, key);
			if (!g?.patch || late()) continue;
			let next, r;
			try {
				next = applyPatch(current, g.patch);
				compiles += 1;
				r = compile(next);
			} catch {
				rejected += 1;
				continue;
			}
			if (totalOf(r) < totalOf(result) - 1e-9) {
				applied.push({ kind: g.kind, subject: g.subject, patch: g.patch, severity: [g.severity, groupIn(r, key)?.severity ?? 0] });
				current = next; result = r; kept += 1;
			} else rejected += 1;
		}
		if (!kept) break;
	}
	return { spec: current, result, repair: { rounds, compiles, applied, rejected } };
}
