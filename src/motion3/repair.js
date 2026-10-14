// C6. Repair: apply the QA patches (qa/patch.js) that make the motion better, round by round.
// Each round takes the top 3 groups that carry a patch and tries them one at a time, each with
// the patch the latest compile gives that group. When none is kept, the top 2 groups just past
// their limit with no patch get a small local search (repair-tune.js: the responsible skill's
// args, or the key pair of a speed spike); the best candidate is the round's change. A change
// is kept only when the summed severity (qa/severity.js) drops and no goal that held fails, else
// it is undone. A round that keeps nothing ends the repair. The compiler is deterministic and
// the candidates come in a fixed order, so the repair is too; no new compile starts after 20 s.
import { applyPatch } from "./json-patch.js";
import { groupKey } from "./qa/severity.js";
import { tuneCandidates } from "./repair-tune.js";

const TRIES = 3, TUNE_GROUPS = 2, LIMIT_MS = 20000;
const groupsOf = r => r?.qa?.groups ?? [];
const totalOf = r => groupsOf(r).reduce((sum, g) => sum + (g.severity ?? 0), 0);
const failedOf = r => (r?.qa?.goals ?? []).filter(g => !g.ok).length;
const groupIn = (r, key) => groupsOf(r).find(g => groupKey(g) === key);
const better = (r, than) => totalOf(r) < totalOf(than) - 1e-9 && failedOf(r) <= failedOf(than);

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
	/** Compiles current + patch; null (counted as rejected) when the patch or the spec fails. */
	const attempt = patch => {
		try {
			const next = applyPatch(current, patch);
			compiles += 1;
			return { next, r: compile(next) };
		} catch {
			rejected += 1;
			return null;
		}
	};
	const keep = (g, key, patch, { next, r }) => {
		applied.push({ kind: g.kind, subject: g.subject, patch, severity: [g.severity, groupIn(r, key)?.severity ?? 0] });
		current = next; result = r;
	};
	/** The best tune candidate for group g (repair-tune.js); true when it is kept. */
	const tune = g => {
		let best = null;
		for (const patch of tuneCandidates(g, current)) {
			if (late()) break;
			const t = attempt(patch);
			if (!t) continue;
			if (better(t.r, best?.r ?? result)) { if (best) rejected += 1; best = { ...t, patch }; } else rejected += 1;
			if (best && totalOf(best.r) === 0 && !failedOf(best.r)) break;
		}
		if (best) keep(g, groupKey(g), best.patch, best);
		return Boolean(best);
	};
	while (rounds < want && !late()) {
		const keys = groupsOf(result).filter(g => g.patch).slice(0, TRIES).map(groupKey);
		const near = groupsOf(result).filter(g => tuneCandidates(g, current).length).slice(0, TUNE_GROUPS).map(groupKey);
		if (!keys.length && !near.length) break;
		rounds += 1;
		let kept = 0;
		for (const key of keys) {
			const g = groupIn(result, key);
			if (!g?.patch || late()) continue;
			const t = attempt(g.patch);
			if (t && better(t.r, result)) { keep(g, key, g.patch, t); kept += 1; } else if (t) rejected += 1;
		}
		for (const key of kept ? [] : near) {
			const g = groupIn(result, key);
			if (g && !late() && tune(g)) { kept += 1; break; }
		}
		if (!kept) break;
	}
	return { spec: current, result, repair: { rounds, compiles, applied, rejected } };
}
