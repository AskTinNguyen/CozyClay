// Authored story beats (camera-motivation D3): the marks a scene's story makes
// that the cast's motion cannot show, such as a line of dialogue, a reveal or
// a decision. A beat is { id, frame, label, kind } on the timeline clock. They
// live on the shot document (`storyBeats`, absent while there are none, so an
// older body reads and writes back unchanged), are drawn on the timeline,
// written to OTIO as markers, named in the sequence brief and read by the
// motivation check. Pure and dependency-light: the shot document repair imports it.
import { normalizeStableItems } from "../stable-items.js";

export const STORY_BEAT_KINDS = Object.freeze(["disclosure", "reveal", "threat", "decision", "input", "event"]);
export const STORY_BEAT_MAX = 64;
const LABEL_MAX = 80;

const label = (value) => (typeof value === "string" ? Array.from(value.replace(/\s+/g, " ").trim()).slice(0, LABEL_MAX).join("") : "");

/** One beat as stored, or null when it is unreadable (no frame, no label). */
function repairBeat(entry, frameCount) {
	if (!entry || typeof entry !== "object" || !Number.isFinite(entry.frame) || !label(entry.label)) return null;
	const last = Number.isFinite(frameCount) && frameCount > 0 ? frameCount - 1 : Number.POSITIVE_INFINITY;
	return { id: entry.id, frame: Math.max(0, Math.min(last, Math.round(entry.frame))), label: label(entry.label), kind: STORY_BEAT_KINDS.includes(entry.kind) ? entry.kind : "event" };
}

/** The persisted list: readable beats with unique ids, in frame order (then label), at most STORY_BEAT_MAX. */
export function repairStoryBeats(entries, frameCount = null, ids = new Set()) {
	if (!Array.isArray(entries) || !entries.length) return [];
	return normalizeStableItems(entries.slice(0, STORY_BEAT_MAX), "story-beat", ids).map((entry) => repairBeat(entry, frameCount)).filter(Boolean)
		.sort((a, b) => a.frame - b.frame || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** `{ storyBeats }` when there are any, else {} (older documents stay byte-identical). */
export const storyBeatsField = (entries, frameCount = null) => {
	const beats = repairStoryBeats(entries, frameCount);
	return beats.length ? { storyBeats: beats } : {};
};

/** The next free id: story-beat-1, story-beat-2, ... (deterministic, so agents and tests can name it). */
export function nextStoryBeatId(beats) {
	const taken = new Set((beats ?? []).map((beat) => beat.id));
	let n = 1;
	while (taken.has(`story-beat-${n}`)) n += 1;
	return `story-beat-${n}`;
}

/** A beat named by id, by label (case-insensitive, then a label that starts with the words), or by frame (the nearest within 12 frames). */
export function findStoryBeat(beats, ref) {
	const list = beats ?? [];
	if (Number.isInteger(ref)) {
		const near = [...list].sort((a, b) => Math.abs(a.frame - ref) - Math.abs(b.frame - ref))[0];
		return near && Math.abs(near.frame - ref) <= 12 ? near : null;
	}
	const text = label(ref).toLowerCase().replace(/^["'“‘]|["'”’]$/g, "");
	if (!text) return null;
	return list.find((beat) => beat.id === ref) ?? list.find((beat) => beat.label.toLowerCase() === text)
		?? list.find((beat) => beat.label.toLowerCase().startsWith(text)) ?? list.find((beat) => beat.label.toLowerCase().includes(text)) ?? null;
}

/** A beat in words: `reveal "the letter" at f120`. */
export const storyBeatWords = (beat) => `${beat.kind} "${beat.label}" at f${beat.frame}`;
