// The stop rule of the compile-repair loop (motion.compile): a short note in the answer when more
// compiles stopped paying. It never refuses a compile; the agent reads output.stuck and the prompt
// tells it to obey. The agent's own logs set the numbers: a compile is ~0.3 s but a repair step is
// ~1,250 output tokens of model time, a turn compiles median 8 / p90 17 times, a failure that survives
// two retries unchanged survives a third about a third of the time, and about a fifth of the
// compiles after a take first passes QA failed QA again (re-tweaking what already passed).
//   polish  an earlier compile of this character in this turn passed QA: say so, stop unless asked
//   cap     REPAIR_CAP compiles after the first: report what still fails on the best take
//   stuck   the same failing groups (or more) for STUCK_AFTER compiles in a row, neither fewer nor
//           DELTA_STEP less severe: stop patching them (or re-applying their hints), start over,
//           take another approach, or report what the best take still fails
// History is per character and agent turn (context.turnId); without a turn (MCP, tests) per character,
// with the cap counted along the base chain (a whole spec starts it again). A whole spec sent after a
// stuck note is the fresh start the note asked for, so the streak starts again too.
// A note never leaves the take empty: the agent obeys it by reporting, and a turn whose compiles all ran
// install: "ifClean" (or false) unclean ended with no take (5 of 30 bench runs). So the line keeps its best
// compile at the current placement (`at`: a take only fits the body and scene it was baked in) with its
// take, and a note on a compile that did not install itself answers `install`: the best take, when the
// character does not already carry this line's take at least as good. The caller installs it (no
// compile: the take is the one baked then).
import { groupKey } from "./qa/severity.js";

const STUCK_AFTER = 3;
const REPAIR_CAP = 10;
const DELTA_STEP = 0.05;
const KEPT = 32;
// lines whose best take is kept (the newest): a take is ~0.25 MB a 240-frame Y Bot take (rotations, 65 bones), so at
// most about 1 MB here; an older line keeps its notes but no take (its turn is over)
const TAKES = 4;
const SAY_CODES = 2;

const severity = groups => groups.reduce((s, g) => s + (Number.isFinite(g.severity) ? g.severity : 0), 0);
const superset = (a, b) => [...b].every(k => a.has(k));
const better = (a, b) => (a.ok !== b.ok ? a.ok : a.n !== b.n ? a.n < b.n : a.sev < b.sev);
const problems = n => `${n} problem${n === 1 ? "" : "s"}`;
const cut = s => (s.length > 40 ? `${s.slice(0, 39)}~` : s);
const named = c => `${c.specId} (${c.ok ? "QA passes" : problems(c.n)})`;

export function createRepairWatch() {
	const lines = new Map();
	const lineOf = key => {
		let line = lines.get(key);
		if (line) { lines.delete(key); lines.set(key, line); return line; }
		line = { compiles: 0, last: null, passed: null, best: null, pick: null, held: null, noted: false, depth: new Map() };
		lines.set(key, line);
		if (lines.size > KEPT) lines.delete(lines.keys().next().value);
		return line;
	};
	/**
	 * One compile's note. qa is the full QA (every group); base the specId it patched, absent for a whole
	 * spec; at the placement key of the compile (character pose and scene), take its baked take (kept while
	 * it is the best at `at`), installed whether this compile put its own take on the character, current the
	 * specId of the take the character carries now (after this compile).
	 * -> { say?, install?: { specId, take } } : install is the best take the caller puts on the character.
	 * @param {{ characterId: string, turnId?: string | null, specId: string, base?: string, qa: { ok: boolean, groups: object[] },
	 *   at?: string, take?: unknown, installed?: boolean, current?: string | null }} c
	 */
	function note({ characterId, turnId = null, specId, base, qa, at = "", take, installed = false, current = null }) {
		const line = lineOf(`${characterId}\u0000${turnId ?? ""}`), groups = qa.groups ?? [];
		const now = { specId, at, ok: Boolean(qa.ok), fails: new Set(groups.map(groupKey)), n: groups.length, sev: severity(groups), streak: 1 };
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
		// the best take at this placement (a compile elsewhere starts it again), and the take this line put on
		if (!line.pick || line.pick.at !== at || better(now, line.pick)) {
			line.pick = { ...now, take };
			let older = lines.size - TAKES;
			for (const other of lines.values()) if (older-- > 0 && other.pick) other.pick.take = undefined;
		}
		if (installed) line.held = now;
		const back = best && best.specId !== specId && better(best, now) ? `; best so far ${best.specId} (${best.ok ? "QA passes" : problems(best.n)})` : "";
		const kind = passed && passed !== specId ? "polish" : repairs >= REPAIR_CAP && !now.ok ? "cap" : now.streak >= STUCK_AFTER ? "stuck" : null;
		line.noted = Boolean(kind) && !passed;
		if (!kind) return {};
		// the take to leave on the character: this compile's when it installed itself; else what the line put on
		// when the character still carries it here and the pick does not beat it; else the pick (a take plays in the
		// character's placement frame, take.js, so one baked before a move no longer meets the scene where it stands)
		const held = line.held, keeps = installed || (held && held.specId === current && held.at === at && !better(line.pick, held));
		const install = keeps || line.pick.take === undefined ? undefined : { specId: line.pick.specId, take: line.pick.take };
		if (install) line.held = line.pick;
		const on = installed ? null : keeps ? held : install ? line.pick : null;
		const report = install ? `installed the best take, ${named(on)}: report what it still fails` : on ? `${named(on)} stays installed: report what it still fails`
			: installed ? "this take is installed: report what still fails" : "install the best take and report what it still fails";
		let say;
		if (kind === "polish") say = `${passed} already passed QA: stop unless the user asked for a specific change${install ? `; installed ${named(on)}` : ""}.`;
		else if (kind === "cap") say = `${repairs} repair compiles${on ? "" : back}: ${report}, unless the user asked for more.`;
		else {
			const codes = [...now.core], names = codes.slice(0, SAY_CODES).map(cut).join(", ") + (codes.length > SAY_CODES ? ` +${codes.length - SAY_CODES}` : "");
			say = `${names} unchanged over ${now.streak} compiles${on ? "" : back}. Stop patching it (or re-applying its hint): start afresh, try another approach, or ${report}.`;
		}
		return { say, ...(install ? { install } : {}) };
	}
	return { note };
}
