// C7. What changed against a base spec's QA. Stub until lane D2: nothing changed.
// Lane D2 matches groups by severity.js groupKey: resolved = in base only, new = in this compile
// only, worse/better = in both with a severity change of 5 % or more; keys lists at most 6
// groupKeys of each.

/**
 * deltaOf(baseGroups, groups, baseId) ->
 *   { base, resolved, new, worse, better, keys: { resolved: [], new: [], worse: [] } }
 * @param {object[]} baseGroups  the base spec's full qa.groups (spec store parts)
 * @param {object[]} groups  this compile's qa.groups
 * @param {string} baseId
 */
export function deltaOf(baseGroups, groups, baseId) {
	return { base: baseId, resolved: 0, new: 0, worse: 0, better: 0, keys: { resolved: [], new: [], worse: [] } };
}
