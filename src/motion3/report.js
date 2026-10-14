// C7. Output budget: a motion action's output must fit the receipt (8 KiB, of which the receipt
// head and readback take about 1.5 KB), so fitOutput keeps the most useful parts within
// MOTION_OUTPUT_BUDGET bytes of JSON and says what it cut in `more`; the cut parts stay in the
// spec store (spec-store.js) and motion.report pages through them. Keep order (first = last cut):
//   1. frames, fps, installed, specId, qa.ok/total/goals, observations, delta, repair  (always;
//      observations are bounded: a fixed set of joints and limbs, about 1 KB)
//   2. the first MIN_FULL qa.groups in full
//   3. probes
//   4. timeline (the planted spans go first, then entries from the end)
//   5. the other groups as one-liners { kind, subject, count, severity, first, last }
//   6. fixed, search, skills, ms
// Room left after that turns one-liners back into full groups, from the top.

export const MOTION_OUTPUT_BUDGET = 6000;
const MIN_FULL = 4;
const size = v => new TextEncoder().encode(JSON.stringify(v)).length;
const oneLine = g => ({ kind: g.kind, subject: g.subject, count: g.count, severity: g.severity, first: g.first, last: g.last });

/**
 * full output -> output within `budget` bytes of JSON. When something was cut it carries
 * more: { specId, groups, timeline, probes }, how many items of each part are missing or
 * shortened; motion.report { specId, part, from } pages the whole part.
 */
export function fitOutput(full, budget = MOTION_OUTPUT_BUDGET) {
	if (size(full) <= budget) return full;
	const { qa, observations, probes, timeline, fixed, search, skills, ms, ...head } = full;
	const groups = qa?.groups ?? [], more = { specId: full.specId, groups: 0, timeline: 0, probes: 0 };
	const out = { ...head, ...(qa ? { qa: { ...qa, groups: [] } } : {}), ...(observations ? { observations } : {}) };
	// the counts in `more` may still grow by a digit or two after a check
	const fits = extra => size({ ...out, ...extra, more }) <= budget - 32;
	const nFull = Math.min(MIN_FULL, groups.length);
	if (qa) out.qa.groups = groups.slice(0, nFull);
	if (probes) {
		const kept = {};
		for (const [k, v] of Object.entries(probes)) if (fits({ probes: { ...kept, [k]: v } })) kept[k] = v;
		out.probes = kept; more.probes = Object.keys(probes).length - Object.keys(kept).length;
	}
	if (timeline) {
		const lean = timeline.map(({ planted, ...rest }) => rest), list = fits({ timeline }) ? timeline : lean;
		let n = list.length;
		while (n > 0 && !fits({ timeline: list.slice(0, n) })) n--;
		out.timeline = list.slice(0, n);
		more.timeline = list === lean ? timeline.length : timeline.length - n;
	}
	for (let i = nFull; i < groups.length && fits({ qa: { ...out.qa, groups: [...out.qa.groups, oneLine(groups[i])] } }); i++) out.qa.groups.push(oneLine(groups[i]));
	for (const [k, v] of [["fixed", fixed], ["search", search], ["skills", skills], ["ms", ms]]) if (v !== undefined && fits({ [k]: v })) out[k] = v;
	for (let i = nFull; i < out.qa?.groups.length && fits({ qa: { ...out.qa, groups: out.qa.groups.map((g, j) => (j === i ? groups[i] : g)) } }); i++) out.qa.groups[i] = groups[i];
	// last resort (huge hints): full groups become one-liners from the end
	for (let i = nFull - 1; i >= 0 && !fits({}); i--) out.qa.groups[i] = oneLine(groups[i]);
	more.groups = groups.length - (out.qa?.groups ?? []).filter(g => "worst" in g).length;
	return { ...out, more };
}

/**
 * One page of a stored part for motion.report: items from index `from` on, as many as fit the
 * budget (at least one). parts = { groups: [], timeline: [], probes: { name: result } }.
 * @returns {{ specId: string, part: string, from: number, items: any[], next: number | null }}
 */
export function reportPage(parts, specId, part, from = 0, budget = MOTION_OUTPUT_BUDGET) {
	const all = part === "probes" ? Object.entries(parts?.probes ?? {}).map(([name, r]) => ({ name, ...r })) : parts?.[part] ?? [];
	const page = { specId, part, from, items: [], next: null };
	for (let i = from; i < all.length; i++) {
		if (page.items.length && size({ ...page, items: [...page.items, all[i]], next: i + 1 }) > budget) { page.next = i; break; }
		page.items.push(all[i]);
	}
	return page;
}
