// Structure requests in a director's words (camera-coverage/route.js asks
// here after the motivation resolver): "where does this sequence go flat?",
// "show me the intensity", "does the scene peak on the reveal?" and "build to
// the reveal" -> camera.checkStructure (read only; a build names the beat it
// must rise into). Answers { action, args, via, matched, confidence } like the
// other resolvers, or null. Pure.
import { normalizePhrase } from "../camera-techniques/resolve.js";

const FLAT = /\b(go(?:es)? flat|goes? dead|falls? flat|flat(?:ten(?:s|ed)?)? (?:stretch|stretches|spot|spots|patch|patches|part|section)|is (?:it|this|the (?:sequence|scene|cut|edit)) flat|monotonous|no contrast|lacks? contrast|same intensity)\b/;
const CURVE = /\b(intensity(?: curve| strip| graph)?|visual structure|structure of (?:the|this|my) (?:sequence|scene|cut|edit)|tension curve|dramatic curve|check (?:the |my )?structure)\b/;
const BUILD = /\b(?:build|builds|building|escalate|escalates|ramp|ramps|climb|climbs)(?: (?:it|this|the (?:sequence|scene|tension|intensity)))?(?: up)? (?:to|into|toward|towards) (?:the |a |her |his |their )?([a-z][a-z0-9 ]{1,40}?)\s*$/;
const PEAK = /\b(?:does|do|did|will|where|when) (?:the |this |my )?(?:sequence|scene|cut|edit|it) (?:peak|climax)(?: on| at)?(?: the| a)?\s*([a-z][a-z0-9 ]{0,40}?)?\s*\??$|\bwhere(?:'s| is) the (?:peak|climax)\b/;

const wordsOf = (phrase, pattern) => [phrase.match(pattern)?.[0]].filter(Boolean);

/** @returns {{ action, args, via, matched, confidence } | null} */
export function resolveStructureRequest(text) {
	const phrase = normalizePhrase(text);
	if (!phrase) return null;
	const build = phrase.match(BUILD);
	if (build) {
		const beat = build[1].trim();
		return { action: "camera.checkStructure", args: { beat }, via: "build words", matched: [build[0].slice(0, build[0].length - build[1].length).trim()], confidence: beat.split(" ").length <= 3 ? "high" : "medium" };
	}
	if (FLAT.test(phrase)) return { action: "camera.checkStructure", args: {}, via: "flat words", matched: wordsOf(phrase, FLAT), confidence: "high" };
	if (CURVE.test(phrase)) return { action: "camera.checkStructure", args: {}, via: "intensity words", matched: wordsOf(phrase, CURVE), confidence: "high" };
	const peak = phrase.match(PEAK);
	if (peak) return { action: "camera.checkStructure", args: peak[1]?.trim() ? { beat: peak[1].trim() } : {}, via: "peak words", matched: [/\b(peak|climax)\b/.exec(phrase)[0]], confidence: "medium" };
	return null;
}
