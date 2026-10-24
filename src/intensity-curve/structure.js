// The structure rules (intensity-curve A2), read against the curve
// (curve.js) and the story beats (camera-motivation):
//
//   flat           N or more shots in a row with every cut under the contrast limit
//   peak-off-beat  the highest-intensity shot neither holds nor follows the strongest beat
//   no-build       intensity does not rise into a reveal, threat or decision beat
//
// With no story beats only `flat` runs (D2). Each issue carries its frames and
// a suggestion as a technique stack (one size tighter, a lower angle, a longer
// lens) that camera.applyTechnique applies, and shorter shots in words. Report
// only: nothing here changes a shot. Limits live in weights.js. Pure.
import { castAt } from "../camera-coverage/cut-geometry.js";
import { PRIME_SET } from "../shot.js";
import { findStoryBeat, storyBeatWords } from "../camera-motivation/story-beats.js";
import { sequenceIntensity } from "./curve.js";
import { BEAT_STRENGTH, BUILD_KINDS, STRUCTURE_LIMITS } from "./weights.js";

export const STRUCTURE_RULES = Object.freeze(["flat", "peak-off-beat", "no-build"]);
const SIZE_IDS = ["extreme-close-up", "close-up", "medium-close-up", "medium-shot", "cowboy-shot", "wide-shot", "extreme-long-shot"];
const SIZE_WORDS = ["extreme close-up", "close-up", "medium close-up", "medium shot", "medium-wide shot", "wide shot", "extreme wide shot"];
const f2 = (value) => value.toFixed(2);

/** The suggestion for one shot: a technique stack one size tighter on the next longer prime (at least 1.2x the focal), from a lower angle, and shorter shots in words. */
function intensitySuggestion(row) {
	if (row.unmeasured) return { shotId: row.shotId, stack: [], text: `${row.shotName} is a follow camera: re-lay it tighter, lower and on a longer lens, or cut it shorter` };
	const rung = Math.min(...row.raw.rung), tighter = Math.max(0, rung - 1), focal = Math.max(...row.raw.focalMm);
	const longer = PRIME_SET.find((mm) => mm >= focal * 1.2) ?? PRIME_SET.at(-1);
	const low = Math.min(...row.raw.elevationDeg) > -10;
	const stack = [{ id: SIZE_IDS[tighter], params: { focalMm: longer } }, ...(low ? [{ id: "low-angle" }] : [])];
	const shorter = row.raw.seconds > 2 ? `, shorter shots (${row.shotName} to about ${f2(Math.max(1, row.raw.seconds / 2))}s)` : "";
	const text = `${rung > 0 ? `one size tighter (${SIZE_WORDS[tighter]})` : "hold the extreme close-up"}${low ? ", a lower angle" : ""}, a longer lens (${longer} mm)${shorter}`;
	return { shotId: row.shotId, stack, text, action: "camera.applyTechnique", args: { shotId: row.shotId, stack, ...(row.subjectId ? { subjectId: row.subjectId } : {}) } };
}

/** The shot a frame falls in (or the next one after a gap), as an index into rows. */
const shotOf = (rows, frame) => {
	const inside = rows.findIndex((row) => frame >= row.startFrame && frame <= row.endFrame);
	return inside >= 0 ? inside : rows.findIndex((row) => row.startFrame > frame);
};
const label = (row) => `shot ${row.index} '${row.shotName}'`;

function flatRuns(curve, limits) {
	const issues = [];
	let start = 0;
	for (let k = 0; k <= curve.cuts.length; k++) {
		if (k < curve.cuts.length && curve.cuts[k].total < limits.flatContrast) continue;
		const rows = curve.shots.slice(start, k + 1);
		if (rows.length >= limits.flatShots) {
			const cuts = curve.cuts.slice(start, k), target = rows[Math.floor(rows.length / 2)], largest = Math.max(...cuts.map((cut) => cut.total));
			issues.push({ rule: "flat", severity: "medium", shotIds: rows.map((row) => row.shotId), shots: [rows[0].index, rows.at(-1).index], frames: [rows[0].startFrame, rows.at(-1).endFrame],
				message: `Shots ${rows[0].index}-${rows.at(-1).index} (f${rows[0].startFrame}-${rows.at(-1).endFrame}) go flat: no cut changes the intensity by ${f2(limits.flatContrast)} or more (the largest is ${f2(largest)}).`,
				suggestion: intensitySuggestion(target) });
		}
		start = k + 1;
	}
	return issues;
}

/** The beat whose shot the sequence should peak on: the strongest kind, the later on a tie. */
const strongest = (beats) => [...beats].sort((a, b) => (BEAT_STRENGTH[b.kind] ?? 1) - (BEAT_STRENGTH[a.kind] ?? 1) || b.frame - a.frame)[0] ?? null;

function peakOffBeat(curve, beats, limits) {
	const beat = strongest(beats), at = beat ? shotOf(curve.shots, beat.frame) : -1;
	if (at < 0 || !curve.peak) return [];
	const peaks = curve.shots.filter((row) => row.combined >= curve.peak.combined - limits.peakSlack).map((row) => row.index - 1);
	if (peaks.includes(at) || peaks.includes(at + 1)) return [];
	const peak = curve.shots[curve.peak.index - 1], held = curve.shots[at];
	return [{ rule: "peak-off-beat", severity: "medium", shotIds: [peak.shotId, held.shotId], frames: [peak.startFrame, peak.endFrame], beat,
		message: `The sequence peaks at ${label(peak)} (${f2(peak.combined)}), away from its strongest beat, ${storyBeatWords(beat)} in ${label(held)} (${f2(held.combined)}).`,
		suggestion: intensitySuggestion(held) }];
}

function noBuild(curve, beats, limits, asked) {
	const issues = [];
	for (const beat of beats.filter((row) => BUILD_KINDS.includes(row.kind) || row.id === asked?.id)) {
		const at = shotOf(curve.shots, beat.frame);
		if (at < 1) continue;
		const before = curve.shots[at - 1], into = curve.shots[at], rise = into.combined - before.combined;
		if (rise >= limits.buildMin) continue;
		issues.push({ rule: "no-build", severity: "high", shotIds: [before.shotId, into.shotId], frames: [before.startFrame, beat.frame], beat,
			message: `Intensity does not rise into ${storyBeatWords(beat)}: ${label(before)} ${f2(before.combined)}, ${label(into)} ${f2(into.combined)}.`,
			suggestion: intensitySuggestion(into) });
	}
	return issues;
}

/**
 * @param {object} document  a sequence document with storyBeats
 * @param {{ range?: object, placeAt?: Function, limits?: object, beat?: string|number }} [options]
 *   beat: a story beat (id, label, kind or frame) the sequence must build into, whatever its kind
 * @returns {{ curve, beats, issues, issueCount, rules: string[], limits, beat: object|null }}
 */
export function checkStructure(document, { range = null, placeAt = castAt, limits = {}, beat = null } = {}) {
	const curve = sequenceIntensity(document, { range, placeAt }), limit = { ...STRUCTURE_LIMITS, ...limits };
	const first = curve.shots[0], last = curve.shots.at(-1);
	const beats = first ? (document.storyBeats ?? []).filter((row) => row.frame >= first.startFrame && row.frame <= last.endFrame) : [];
	const asked = beat === null || beat === undefined ? null : findStoryBeat(beats, beat) ?? beats.find((row) => row.kind === String(beat).toLowerCase().replace(/^the /, "")) ?? null;
	const rules = beats.length ? STRUCTURE_RULES : ["flat"];
	const issues = [...flatRuns(curve, limit), ...(beats.length ? [...peakOffBeat(curve, beats, limit), ...noBuild(curve, beats, limit, asked)] : [])]
		.sort((a, b) => a.frames[0] - b.frames[0] || STRUCTURE_RULES.indexOf(a.rule) - STRUCTURE_RULES.indexOf(b.rule));
	return { curve, beats, issues, issueCount: issues.length, rules: [...rules], limits: limit, beat: asked };
}

/** Where a sequence builds and peaks, in words, for the brief's STRUCTURE line ("beat" is a shot of the range, numbered from 1). */
export function structureWords(result) {
	const rows = result.curve.shots;
	if (!rows.length) return "no shots.";
	if (rows.length === 1) return `one beat at intensity ${f2(rows[0].combined)}.`;
	const peak = rows[result.curve.peak.index - 1], low = Math.min(...rows.map((row) => row.combined)), last = rows.at(-1);
	const onBeat = result.beats.filter((row) => row.frame >= peak.startFrame && row.frame <= peak.endFrame).map((row) => `'${row.label}'`);
	const at = `beat ${peak.index}${onBeat.length ? ` on ${onBeat.join(", ")}` : ""}`;
	let words;
	if (peak.combined - low < STRUCTURE_LIMITS.buildMin) words = `holds level at about ${f2(peak.combined)} across beats 1-${last.index}`;
	else if (peak.index === 1) words = `opens at its peak (${f2(peak.combined)}) and releases to ${f2(last.combined)} by beat ${last.index}`;
	else words = `builds from ${f2(rows[0].combined)} at beat 1 to a peak of ${f2(peak.combined)} at ${at}${peak === last ? ", the last" : last.combined >= peak.combined - STRUCTURE_LIMITS.peakSlack ? ` and holds there to beat ${last.index}` : `, then releases to ${f2(last.combined)} by beat ${last.index}`}`;
	const flats = result.issues.filter((issue) => issue.rule === "flat").map((issue) => issue.shots.join("-"));
	return `intensity ${words}${flats.length ? `; flat over beats ${flats.join(", ")}` : ""}.`;
}
