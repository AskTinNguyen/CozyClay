// Transitions on a cut, stored on the incoming shot (shot.transition): how the
// edit moves from the previous shot into this one. A plain cut stores nothing.
// Dissolves and fades draw in the shot camera preview (as a weighted blend of
// the two cameras, or a fall to black), a whip is a short blurred blend, and
// match, J and L cuts are hard picture cuts whose note (and audio offset) the
// prompt and the OTIO metadata carry. Pure: no DOM, no three.js.

export const TRANSITION_TYPES = Object.freeze(["cut", "dissolve", "fade-to-black", "fade-from-black", "whip", "match-cut", "j-cut", "l-cut"]);
const BLENDED = new Set(["dissolve", "fade-to-black", "fade-from-black", "whip"]);
const DEFAULT_FRAMES = { dissolve: 12, "fade-to-black": 12, "fade-from-black": 12, whip: 6 };
export const TRANSITION_FRAMES_MAX = 96;
const AUDIO = new Set(["j-cut", "l-cut"]);

/** The persisted shape, or null for a plain cut / anything unreadable. */
export function repairTransition(value) {
	if (!value || typeof value !== "object" || !TRANSITION_TYPES.includes(value.type) || value.type === "cut") return null;
	const out = { type: value.type };
	if (BLENDED.has(value.type)) out.frames = Number.isFinite(value.frames) ? Math.max(2, Math.min(TRANSITION_FRAMES_MAX, Math.round(value.frames))) : DEFAULT_FRAMES[value.type];
	if (AUDIO.has(value.type)) out.offsetFrames = Number.isFinite(value.offsetFrames) ? Math.max(1, Math.min(TRANSITION_FRAMES_MAX, Math.round(value.offsetFrames))) : 12;
	if (typeof value.note === "string" && value.note.trim()) out.note = Array.from(value.note.trim()).slice(0, 120).join("");
	return out;
}

const seconds = (frames, fps) => `${Number((frames / (fps || 24)).toFixed(2))}s`;

/** The prompt words for a transition into a shot ("a 12-frame dissolve from the previous shot (0.5s)"). */
export function transitionWords(transition, fps = 24) {
	const t = repairTransition(transition);
	if (!t) return null;
	const note = t.note ? ` (${t.note})` : "";
	switch (t.type) {
		case "dissolve": return `a ${t.frames}-frame dissolve from the previous shot (${seconds(t.frames, fps)})${note}`;
		case "fade-to-black": return `the previous shot fades to black over ${t.frames} frames, then this shot opens hard${note}`;
		case "fade-from-black": return `this shot fades in from black over ${t.frames} frames${note}`;
		case "whip": return `a whip-pan transition: the previous shot whips out and this one whips in, blurred, over ${t.frames} frames${note}`;
		case "match-cut": return `a match cut: this shot opens on a shape or motion that matches the end of the previous one${note}`;
		case "j-cut": return `a J-cut: this shot's sound starts ${t.offsetFrames} frames (${seconds(t.offsetFrames, fps)}) before its picture${note}`;
		case "l-cut": return `an L-cut: the previous shot's sound runs ${t.offsetFrames} frames (${seconds(t.offsetFrames, fps)}) into this picture${note}`;
		default: return null;
	}
}

/** The short slate tag the timeline and the cut inspector show. */
export const transitionTag = (transition) => ({ dissolve: "DISS", "fade-to-black": "FADE OUT", "fade-from-black": "FADE IN", whip: "WHIP", "match-cut": "MATCH", "j-cut": "J-CUT", "l-cut": "L-CUT" })[repairTransition(transition)?.type] ?? "CUT";

/**
 * What the shot camera shows around a cut at `frame`: null for a plain frame,
 * else { selfWeight, other?: { shot, frame }, otherWeight } where `other` is
 * the shot on the far side of the cut, sampled at its nearest frame (an
 * outgoing camera holds its last pose, an incoming one its first), and the
 * weights blend the two pictures (a fade has no other: the rest is black).
 * @param {Array} shots  the shot list (clip shots in time order)
 */
export function transitionAt(shots, frame) {
	const ordered = (shots ?? []).filter((shot) => shot.kind !== "still").sort((a, b) => a.startFrame - b.startFrame);
	for (let i = 1; i < ordered.length; i++) {
		const into = ordered[i], from = ordered[i - 1], t = repairTransition(into.transition);
		if (!t || !BLENDED.has(t.type) || from.endFrame + 1 !== into.startFrame) continue;
		const cut = into.startFrame, n = t.frames;
		if (t.type === "fade-to-black" && frame >= cut - n && frame < cut) return { selfWeight: 1 - (frame - (cut - n) + 0.5) / n, otherWeight: 0, type: t.type };
		if (t.type === "fade-from-black" && frame >= cut && frame < cut + n) return { selfWeight: (frame - cut + 0.5) / n, otherWeight: 0, type: t.type };
		const start = cut - Math.floor(n / 2);
		if ((t.type === "dissolve" || t.type === "whip") && frame >= start && frame < start + n) {
			const k = (frame - start + 0.5) / n, before = frame < cut;
			return { type: t.type, selfWeight: before ? 1 - k : k, otherWeight: before ? k : 1 - k, other: before ? { shot: into, frame: into.startFrame } : { shot: from, frame: from.endFrame } };
		}
	}
	return null;
}

const rational = (value, rate) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });

/** An OTIO Transition.1 for the cut into `shot`, or null when OTIO has no transition for it (then the clip metadata carries it). */
export function otioTransition(shot, rate = 24) {
	const t = repairTransition(shot?.transition);
	if (!t || !BLENDED.has(t.type)) return null;
	const [inOffset, outOffset] = t.type === "fade-to-black" ? [t.frames, 0] : t.type === "fade-from-black" ? [0, t.frames] : [Math.floor(t.frames / 2), Math.ceil(t.frames / 2)];
	return {
		OTIO_SCHEMA: "Transition.1", name: `${t.type} into ${typeof shot.name === "string" ? shot.name : "shot"}`,
		transition_type: t.type === "dissolve" ? "SMPTE_Dissolve" : "Custom_Transition",
		in_offset: rational(inOffset, rate), out_offset: rational(outOffset, rate), metadata: { cozyclay: { transition: t } },
	};
}
