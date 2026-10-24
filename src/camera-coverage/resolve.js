// Coverage, composition and cut-check requests in a director's words:
// "cover this conversation", "master and coverage", "walk and talk", "reverse
// on Joon" -> camera.cover; "rule of thirds left", "more lead room" -> a
// composition on camera.applyTechnique; "check my cuts", "is the cut at 96
// crossing the line?" -> camera.checkCuts. Anything else is left to the
// technique resolver (camera-techniques/resolve.js). Pure.
import { normalizePhrase } from "../camera-techniques/resolve.js";
import { COVERAGE_PATTERNS } from "./patterns.js";

const has = (phrase, word) => ` ${phrase} `.includes(` ${word} `);

/** Composition words -> { place?, headroom?, leadRoom? }, or null when the words name none. */
export function parseComposition(text) {
	const phrase = normalizePhrase(text), out = {};
	const thirds = /\b(rule of thirds|thirds|third)\b/.test(phrase);
	if (thirds || /\b(frame|framed|place|put|keep)\b.*\b(left|right)\b/.test(phrase)) {
		if (has(phrase, "left")) out.place = "left-third";
		else if (has(phrase, "right")) out.place = "right-third";
		else if (thirds) out.place = "auto";
	}
	if (/\b(centre|center|centred|centered|central|symmetrical|symmetric|dead centre|dead center)\b/.test(phrase)) out.place = "centre";
	if (/\b(tight|less|little|no) head ?room\b/.test(phrase)) out.headroom = "tight";
	else if (/\b(loose|more|lots of|plenty of|extra) head ?room\b/.test(phrase)) out.headroom = "loose";
	else if (/\bnormal head ?room\b/.test(phrase)) out.headroom = "normal";
	if (/\b(lead|looking|nose|leading) ?room\b|\bleadroom\b/.test(phrase)) {
		out.leadRoom = /\b(more|extra|lots of|plenty of|bigger)\b/.test(phrase) ? "more" : /\b(travel|travelling|traveling|walking|moving|motion)\b/.test(phrase) ? "travel" : "facing";
		out.place ??= "auto";
	}
	return Object.keys(out).length ? out : null;
}

/** Cast members named in the words, in the order they are named. */
export function namedCast(text, cast = []) {
	const phrase = ` ${normalizePhrase(text)} `;
	return cast.map((member) => ({ id: member.id, at: member.name ? phrase.indexOf(` ${normalizePhrase(member.name).split(" ")[0]} `) : -1 }))
		.filter((row) => row.at >= 0).sort((a, b) => a.at - b.at).map((row) => row.id);
}

const ALIASES = COVERAGE_PATTERNS.flatMap((pattern) => [pattern.name, pattern.id, ...pattern.aliases].map((alias) => ({ id: pattern.id, key: normalizePhrase(alias) })))
	.sort((a, b) => b.key.length - a.key.length);

/** The coverage pattern a phrase asks for, or null. */
export function resolveCoveragePattern(text) {
	const phrase = normalizePhrase(text);
	return ALIASES.find((row) => has(phrase, row.key))?.id ?? null;
}

/**
 * One request -> the action that answers it: { action, args, via } or null.
 * @param {{cast?: Array<{id:string,name?:string}>}} [options]
 */
export function resolveCameraRequest(text, { cast = [] } = {}) {
	const phrase = normalizePhrase(text), named = namedCast(text, cast);
	const crossing = /\b(cross|crosses|crossing|crossed|break|breaks|breaking|broke)\b/.test(phrase) && /\b(line|180|axis)\b/.test(phrase);
	const cutWords = /\b(cut|cuts|edit|jump cut|jump cuts|eyeline|eyelines|screen direction|continuity)\b/.test(phrase);
	if ((crossing || (cutWords && /\b(check|checks|ok|okay|clean|flag|flags|any|problem|problems|is|are|crossing)\b/.test(phrase))) && !/\b(cover|coverage|lay|give me)\b/.test(phrase)) {
		const frame = phrase.match(/\b(?:at|frame|on)\s+(\d{1,5})\b/)?.[1];
		return { action: "camera.checkCuts", args: frame ? { frame: Number(frame) } : {}, via: "cut words" };
	}
	const pattern = resolveCoveragePattern(phrase);
	if (pattern) {
		// "reverse on Joon": the reverse pattern, with Joon's side first.
		return { action: "camera.cover", args: { pattern, ...(named.length ? { cast: named.slice(0, 2) } : {}) }, via: "coverage words" };
	}
	const composition = parseComposition(phrase);
	if (composition) return { action: "camera.applyTechnique", args: { composition, ...(named.length ? { subjectId: named[0] } : {}) }, via: "composition words" };
	return null;
}
