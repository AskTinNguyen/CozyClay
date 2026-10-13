// Motion QA entry: general checks on every take plus the checks the spec declares.
import { generalChecks } from "./checks.js";
import { specChecks } from "./spec-checks.js";
import { explainGroups } from "./explain.js";

/** Group issues by kind + subject; each group reports count, worst value and frame range. */
function summarizeIssues(issues) {
	const groups = new Map();
	for (const i of issues) {
		const key = `${i.kind} ${i.msg.replace(/[-+]?\d+(\.\d+)?/g, "#")}`;
		const g = groups.get(key) ?? { kind: i.kind, subject: i.msg, count: 0, worst: i.value, worstFrame: i.frame, first: i.frame, last: i.frame, limit: i.limit };
		g.count++; g.first = Math.min(g.first, i.frame); g.last = Math.max(g.last, i.frame);
		const worse = i.kind === "ORIENT" || i.kind === "BELOW" || i.kind === "CLEARANCE" ? i.value < g.worst : i.value > g.worst;
		if (worse) { g.worst = i.value; g.worstFrame = i.frame; g.subject = i.msg; }
		groups.set(key, g);
	}
	return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * opts.explain (default true) adds cause + hint to the top groups (explain.js). Frames are
 * absolute even when the compile was windowed (out.f0).
 */
export function runMotionQa(sk, out, spec, opts = {}) {
	const checks = spec.checks ?? {};
	const issues = [...generalChecks(sk, out, { allow: checks.allow, limits: checks.limits, mouthPoints: checks.mouthPoints }), ...specChecks(out, checks)];
	if (out.f0) for (const i of issues) i.frame += out.f0;
	const groups = summarizeIssues(issues);
	if (opts.explain !== false) explainGroups(sk, out, spec, groups);
	return { ok: issues.length === 0, total: issues.length, groups };
}
