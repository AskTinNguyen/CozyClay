// C6. How bad a QA issue group is, one formula for the agent (qa.groups order and severity),
// the open-parameter search (search.js cost) and repair (repair.js): the issue count weighted by
// how far the worst issue is past its limit, at most 4x. See docs/motion-api-v3.1.md.

/** Kinds whose value must stay ABOVE the limit (a cosine, a drop, a clearance). */
export const LOW_IS_BAD = new Set(["ORIENT", "BELOW", "CLEARANCE"]);

/** How far the worst issue of group g is past its limit (>= 0, in the kind's unit). */
export const excessOf = g => Math.max(0, LOW_IS_BAD.has(g.kind) ? g.limit - g.worst : g.worst - g.limit);

/** Unrounded severity; search.js sums these as its cost. */
export const weightOf = g => g.count * (1 + Math.min(3, excessOf(g) / Math.max(Math.abs(g.limit), 0.01)));

/** Severity of group g, rounded to 2 decimals. */
export const severityOf = g => Math.round(weightOf(g) * 100) / 100;

/**
 * The grouping key of an issue (kind + subject): every number in the subject becomes "#", so
 * one problem at many frames and depths is one group. An index in brackets ("contacts[1]",
 * a default check name, qa/check-names.js) stays, so two unnamed checks stay two groups.
 */
export const groupKey = g => `${g.kind} ${g.subject.replace(/(\[\d+\])|[-+]?\d+(\.\d+)?/g, (m, index) => index ?? "#")}`;

/**
 * Adds excess (4 decimals) and severity to every group and returns them ordered: GOAL groups
 * first, then severity, then count, both descending (ties keep their order).
 */
export function rankGroups(groups) {
	for (const g of groups) { g.excess = Math.round(excessOf(g) * 1e4) / 1e4; g.severity = severityOf(g); }
	return groups.sort((a, b) => (b.kind === "GOAL") - (a.kind === "GOAL") || b.severity - a.severity || b.count - a.count);
}
