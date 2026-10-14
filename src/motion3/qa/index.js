// Motion QA entry: general checks on every take, the checks the spec declares, the objects it
// moves (object-checks.js) and its goals (goals.js). Groups are ranked by severity.js.
import { generalChecks } from "./checks.js";
import { specChecks } from "./spec-checks.js";
import { objectChecks } from "./object-checks.js";
import { goalChecks } from "./goals.js";
import { explainGroups } from "./explain.js";
import { LOW_IS_BAD, groupKey, rankGroups } from "./severity.js";

/** Group issues by kind + subject (severity.js groupKey); each group reports count, worst value and frame range. */
function summarizeIssues(issues) {
	const groups = new Map();
	for (const i of issues) {
		const key = groupKey({ kind: i.kind, subject: i.msg });
		const g = groups.get(key) ?? { kind: i.kind, subject: i.msg, count: 0, worst: i.value, worstFrame: i.frame, first: i.frame, last: i.frame, limit: i.limit };
		g.count++; g.first = Math.min(g.first, i.frame); g.last = Math.max(g.last, i.frame);
		const worse = LOW_IS_BAD.has(i.kind) ? i.value < g.worst : i.value > g.worst;
		if (worse) { g.worst = i.value; g.worstFrame = i.frame; g.subject = i.msg; }
		groups.set(key, g);
	}
	return rankGroups([...groups.values()]);
}

/**
 * opts.explain (default true) adds cause + hint (and patch, qa/patch.js) to the top groups
 * (explain.js); opts.userSpec is the spec as the agent sent it, which patches address. Frames
 * are absolute even when the compile was windowed (out.f0). qa.goals is there when spec.goals is.
 */
export function runMotionQa(sk, out, spec, opts = {}) {
	const checks = spec.checks ?? {}, goals = goalChecks(out, spec.goals ?? []);
	const issues = [...generalChecks(sk, out, { allow: checks.allow, limits: checks.limits, mouthPoints: checks.mouthPoints }), ...specChecks(out, checks),
		...objectChecks(sk, out, spec), ...goals.issues];
	if (out.f0) for (const i of issues) i.frame += out.f0;
	const groups = summarizeIssues(issues);
	if (opts.explain !== false) explainGroups(sk, out, spec, groups, { userSpec: opts.userSpec });
	return { ok: issues.length === 0, total: issues.length, ...(spec.goals ? { goals: goals.results } : {}), groups };
}
