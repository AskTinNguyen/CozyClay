// The stop rule of the compile-repair loop (motion.compile): a short note in the answer when more
// compiles stopped paying. It never refuses a compile; the agent reads output.stuck and the prompt
// tells it to obey. The agent's own logs set the numbers: a compile is ~0.3 s but a repair step is
// ~1,250 output tokens of model time, a turn compiles median 8 / p90 17 times, a failure that survives
// two retries unchanged survives a third about a third of the time, and about a fifth of the
// compiles after a take first passes QA failed QA again (re-tweaking what already passed).
//   polish  an earlier compile of this character in this turn passed QA: say so, stop unless asked
//   cap     REPAIR_CAP compiles after the first: stop and report what still fails, name the best
//   stuck   the same failing groups (or more) for STUCK_AFTER compiles in a row, neither fewer nor
//           DELTA_STEP less severe: stop patching them (or re-applying their hints), start over,
//           take another approach, or report; name the best take so far to go back to
// History is per character and agent turn (context.turnId); without a turn (MCP, tests) per character,
// with the cap counted along the base chain (a whole spec starts it again). A whole spec sent after a
// stuck note is the fresh start the note asked for, so the streak starts again too.
import { groupKey } from "./qa/severity.js";

const STUCK_AFTER = 3;
const REPAIR_CAP = 10;
const DELTA_STEP = 0.05;
const KEPT = 32;
const SAY_CODES = 2;

const severity = groups => groups.reduce((s, g) => s + (Number.isFinite(g.severity) ? g.severity : 0), 0);
const superset = (a, b) => [...b].every(k => a.has(k));
const better = (a, b) => (a.ok !== b.ok ? a.ok : a.n !== b.n ? a.n < b.n : a.sev < b.sev);
const problems = n => `${n} problem${n === 1 ? "" : "s"}`;
const cut = s => (s.length > 40 ? `${s.slice(0, 39)}~` : s);

export function createRepairWatch() {
	const lines = new Map();
	const lineOf = key => {
		let line = lines.get(key);
		if (line) { lines.delete(key); lines.set(key, line); return line; }
		line = { compiles: 0, last: null, passed: null, best: null, noted: false, depth: new Map() };
		lines.set(key, line);
		if (lines.size > KEPT) lines.delete(lines.keys().next().value);
		return line;
	};
	/**
	 * One compile's note, or undefined. qa is the full QA (every group); base the specId it patched,
	 * absent for a whole spec.
	 * @param {{ characterId: string, turnId?: string | null, specId: string, base?: string, qa: { ok: boolean, groups: object[] } }} c
	 * @returns {string | undefined}
	 */
	function note({ characterId, turnId = null, specId, base, qa }) {
		const line = lineOf(`${characterId}\u0000${turnId ?? ""}`), groups = qa.groups ?? [];
		const now = { specId, ok: Boolean(qa.ok), fails: new Set(groups.map(groupKey)), n: groups.length, sev: severity(groups), streak: 1 };
		// core: the failures the whole streak shares (its first compile's; the later ones hold them all)
		now.core = now.fails;
		const prev = line.last, fresh = base === undefined && line.noted;
		if (prev && !fresh && now.fails.size && prev.fails.size && superset(now.fails, prev.fails) && now.n >= prev.n && now.sev > prev.sev * (1 - DELTA_STEP))
			Object.assign(now, { streak: prev.streak + 1, core: prev.core });
		line.compiles += 1;
		const depth = base === undefined ? 0 : (line.depth.get(base) ?? 0) + 1;
		line.depth.set(specId, depth);
		const repairs = turnId ? line.compiles - 1 : depth, passed = line.passed, best = line.best;
		line.last = now;
		if (now.ok && !line.passed) line.passed = specId;
		if (!best || better(now, best)) line.best = now;
		const back = best && best.specId !== specId && better(best, now) ? `; best so far ${best.specId} (${best.ok ? "QA passes" : problems(best.n)})` : "";
		let say;
		if (passed && passed !== specId) say = `${passed} already passed QA: stop unless the user asked for a specific change.`;
		else if (repairs >= REPAIR_CAP && !now.ok) say = `${repairs} repair compiles${back}: stop and report what still fails, unless the user asked for more.`;
		else if (now.streak >= STUCK_AFTER) {
			const codes = [...now.core], names = codes.slice(0, SAY_CODES).map(cut).join(", ") + (codes.length > SAY_CODES ? ` +${codes.length - SAY_CODES}` : "");
			say = `${names} unchanged over ${now.streak} compiles${back}. Stop patching it (or re-applying its hint): start afresh with what you learned, try another skill or approach, or tell the user what blocks it.`;
		}
		line.noted = Boolean(say) && !passed;
		return say;
	}
	return { note };
}
