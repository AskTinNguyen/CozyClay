// Motivation requests in a director's words, ahead of the technique resolver
// (camera-coverage/route.js asks here first): "is this move motivated?" ->
// camera.checkMotivation; "start the push on the reveal", "settle the move on
// the landing" -> camera.alignMove; "add a beat 'confession' at 120" ->
// story.addBeat (move and remove a beat likewise). Answers { action, args,
// via, matched, confidence } like the coverage resolver, or null. Pure.
import { normalizePhrase } from "../camera-techniques/resolve.js";
import { STORY_BEAT_KINDS } from "./story-beats.js";

const QUESTION = /\b(unmotivated|motivated|motivation|motivate|motivates|why (?:does|did|is) the camera (?:move|moving|push|pushing|pan|panning)|reason (?:for (?:the|this|that) (?:move|push|pan|tilt|dolly|zoom|crane|track|camera)|to move))\b/;
const BEAT = /\b(story beats?|beats?|story marks?)\b/;
const ADD = /\b(add|mark|put|place|drop in|insert|set)\b/, MOVE = /\b(move|shift|slide|retime)\b/, REMOVE = /\b(remove|delete|clear|drop)\b/;
const MOVE_WORDS = /\b(push in|push|pull out|pull back|pull|pan|tilt|zoom|dolly|crane|track|tracking|arc|orbit|move|camera)\b/;
const START = /\b(start|begin|kick off|trigger|time|align|sync|cue)\b/, SETTLE = /\b(settle|land|end|finish|stop|rest)\b/;
// "start the push on the reveal": the verb takes the move as its object, then the beat it lands on.
const TIMED = /\b(?:start|begin|kick off|trigger|time|align|sync|cue|settle|land|end|finish|stop|rest)\s+(?:the|this|that|my|our|his|her|its)\s+(?:camera\s+)?(?:push in|push|pull out|pull back|pull|pan|tilt|zoom|dolly|crane|track|tracking|arc|orbit|move|camera)\b/;
const ANCHOR = /\b(?:on|at|to|with|for)\s+(?:the\s+|her\s+|his\s+|their\s+|frame\s+)?(f?\d{1,5}|[a-z][a-z0-9 ]{1,40}?)\s*$/;
const KIND_WORDS = { disclosure: /\b(disclosure|confession|confesses|admission|admits|secret|truth|tells)\b/, reveal: /\b(reveal|reveals|revealed|discovery|discovers|finds)\b/,
	threat: /\b(threat|threatens|danger|gun|knife|attack)\b/, decision: /\b(decision|decides|chooses|choice)\b/, input: /\b(input|button|press|presses|player)\b/ };

const wordsOf = (phrase, pattern) => [...phrase.matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);
const frameIn = (phrase) => { const hit = phrase.match(/\b(?:at|to|on)\s+(?:frame\s+|f)?(\d{1,5})\b/); return hit ? Number(hit[1]) : null; };

/** The label a request names: quoted words first, then "called/named X", else the words left after the verbs. */
function labelOf(text, phrase) {
	const quoted = String(text).match(/["“'‘]([^"”'’]{1,80})["”'’]/)?.[1];
	if (quoted?.trim()) return quoted.trim();
	const named = phrase.match(/\b(?:called|named|labelled|labeled)\s+(.+?)(?:\s+(?:at|on|to)\s+(?:frame\s+|f)?\d+.*)?$/)?.[1];
	if (named) return named.trim();
	const rest = phrase.replace(/\b(?:at|to|on)\s+(?:frame\s+|f)?\d{1,5}\b.*$/, "").replace(/^.*\b(?:story beats?|beats?)\b\s*(?:for|of)?\s*/, "").trim();
	const before = phrase.match(/\b(?:add|mark|put|place|insert|set)\s+(?:a|an|the)?\s*([a-z][a-z ]{0,40}?)\s+(?:story\s+)?(?:beat|mark)s?\b/)?.[1];
	return rest || before || null;
}
/** The kind a beat's words imply (a kind word, or its everyday sense), defaulting to event. */
function kindOf(phrase) {
	const named = STORY_BEAT_KINDS.find((kind) => new RegExp(`\\b${kind}\\b`).test(phrase));
	return named ?? Object.entries(KIND_WORDS).find(([, pattern]) => pattern.test(phrase))?.[0] ?? "event";
}

/** @returns {{ action, args, via, matched, confidence } | null} */
export function resolveMotivationRequest(text) {
	const phrase = normalizePhrase(text);
	if (!phrase) return null;
	if (QUESTION.test(phrase)) return { action: "camera.checkMotivation", args: {}, via: "motivation words", matched: wordsOf(phrase, QUESTION), confidence: "high" };
	const beatWord = BEAT.test(phrase), frame = frameIn(phrase);
	if (beatWord && REMOVE.test(phrase) && !ADD.test(phrase.replace(REMOVE, ""))) {
		const label = labelOf(text, phrase);
		return { action: "story.removeBeat", args: { beat: Number.isInteger(frame) && !label ? frame : label }, via: "story beat words", matched: [...wordsOf(phrase, REMOVE).slice(0, 1), ...wordsOf(phrase, BEAT).slice(0, 1)], confidence: label ? "high" : "medium" };
	}
	if (beatWord && MOVE.test(phrase) && Number.isInteger(frame) && !MOVE_WORDS.test(phrase.replace(MOVE, " ").replace(BEAT, " "))) {
		const label = labelOf(text, phrase.replace(/\b(?:to|at)\s+(?:frame\s+|f)?\d{1,5}\b/, "").trim());
		return { action: "story.moveBeat", args: { beat: label, frame }, via: "story beat words", matched: [...wordsOf(phrase, MOVE).slice(0, 1), ...wordsOf(phrase, BEAT).slice(0, 1)], confidence: label ? "high" : "medium" };
	}
	if (beatWord && ADD.test(phrase) && Number.isInteger(frame)) {
		const label = labelOf(text, phrase) ?? `beat at ${frame}`;
		return { action: "story.addBeat", args: { frame, label, kind: kindOf(normalizePhrase(label) + " " + phrase) }, via: "story beat words", matched: [...wordsOf(phrase, ADD).slice(0, 1), ...wordsOf(phrase, BEAT).slice(0, 1)], confidence: "high" };
	}
	const timed = phrase.match(TIMED), anchor = timed ? phrase.slice(timed.index + timed[0].length).match(ANCHOR) : null;
	if (timed && anchor) {
		const start = START.test(timed[0]), settle = SETTLE.test(timed[0]);
		const ref = /^f?\d+$/.test(anchor[1]) ? Number(anchor[1].replace("f", "")) : anchor[1].trim();
		const edge = settle && (!start || phrase.search(SETTLE) < phrase.search(START)) ? "settle" : "start";
		return { action: "camera.alignMove", args: { beat: ref, edge }, via: "beat timing words", matched: [...wordsOf(phrase, edge === "settle" ? SETTLE : START).slice(0, 1), ...wordsOf(phrase, MOVE_WORDS).slice(0, 1)],
			confidence: typeof ref === "number" || anchor[1].split(" ").length <= 3 ? "high" : "medium" };
	}
	return null;
}
