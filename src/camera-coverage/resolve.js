// Coverage, composition and cut-check requests in a director's words:
// "cover this conversation", "master and coverage", "walk and talk", "reverse
// on Joon" -> camera.cover; "rule of thirds left", "more lead room" -> a
// composition on camera.applyTechnique; "check my cuts", "is the cut at 96
// crossing the line?" -> camera.checkCuts; "cover this three-way argument",
// "branching dialogue, three branches" -> a group pattern on camera.cover;
// "is my coverage enough to edit?" -> camera.checkCoverage; "keep the line
// between Mara and Joon" -> camera.setLine. Anything else is left to the
// technique resolver (camera-techniques/resolve.js). Pure.
import { normalizePhrase } from "../camera-techniques/resolve.js";
import { ALL_COVERAGE_PATTERNS } from "./patterns.js";

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
		out.leadRoom = /\b(more|extra|lots of|plenty of|bigger)\b/.test(phrase) ? "more" : /\b(travel|travels|travelling|traveling|walk|walks|walking|run|runs|running|moving|moves|motion|drives|driving)\b/.test(phrase) ? "travel" : "facing";
		out.place ??= "auto";
	}
	return Object.keys(out).length ? out : null;
}

/** Cast members named in the words, in the order they are named. */
function namedCast(text, cast = []) {
	const phrase = ` ${normalizePhrase(text)} `;
	return cast.map((member) => ({ id: member.id, at: member.name ? phrase.indexOf(` ${normalizePhrase(member.name).split(" ")[0]} `) : -1 }))
		.filter((row) => row.at >= 0).sort((a, b) => a.at - b.at).map((row) => row.id);
}

const ALIASES = ALL_COVERAGE_PATTERNS.flatMap((pattern) => [pattern.name, pattern.id, ...pattern.aliases].map((alias) => ({ id: pattern.id, key: normalizePhrase(alias) })))
	.sort((a, b) => b.key.length - a.key.length);

/** The coverage pattern a phrase asks for and the words that named it, or null. */
function resolveCoveragePattern(text) {
	const phrase = normalizePhrase(text);
	return ALIASES.find((row) => has(phrase, row.key)) ?? null;
}
/** The words of a phrase a pattern matched, in order. */
const wordsOf = (phrase, pattern) => [...phrase.matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);

const NUMBERS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const BRANCHES = /\b(two|three|four|five|six|seven|eight|[2-8]) (?:branches|branch|ways|endings|options)\b/;
const COVERAGE_ASK = /\b(coverage|covered|setups)\b/, ENOUGH = /\b(enough|complete|completeness|missing|gaps?|holes|editable|cuttable)\b/;
const KEEP_LINE = /\b(keep|keeps|hold|holds|set|use|lock|maintain|respect|stay on|stick to)\b/, LINE_OF = /\b(line|axis|180)\b/;
const CROSS = /\b(cross|crosses|crossing|crossed|break|breaks|breaking|broke)\b/, LINE = /\b(line|180|axis)\b/;
const CUT = /\b(jump cuts?|cuts?|edit|eyelines?|screen direction|continuity)\b/, ASK = /\b(check|checks|ok|okay|clean|flag|flags|any|problem|problems|is|are|crossing)\b/;
const COMPOSE = /\b(rule of thirds|thirds?|centre|center|centred|centered|central|symmetrical|symmetric|(?:(?:tight|less|little|no|loose|more|lots of|plenty of|extra|normal|bigger) )?(?:head ?room|lead ?room|leadroom|looking ?room|nose ?room|leading ?room)|left|right)\b/;

/**
 * One request -> the action that answers it: { action, args, via, matched, confidence } or null.
 * matched lists the words that decided it; confidence is high (named outright) or medium (a cut word without a question).
 * @param {{cast?: Array<{id:string,name?:string}>}} [options]
 */
export function resolveCameraRequest(text, { cast = [] } = {}) {
	const phrase = normalizePhrase(text), named = namedCast(text, cast);
	const crossing = CROSS.test(phrase) && LINE.test(phrase), cutWords = CUT.test(phrase), asked = ASK.test(phrase);
	// "is my coverage enough to edit?": the completeness check, read only.
	if (COVERAGE_ASK.test(phrase) && (ENOUGH.test(phrase) || /\bcheck\b/.test(phrase)) && !crossing) {
		return { action: "camera.checkCoverage", args: named.length ? { cast: named.slice(0, 6) } : {}, via: "coverage check words", matched: [...wordsOf(phrase, COVERAGE_ASK), ...wordsOf(phrase, ENOUGH)], confidence: ENOUGH.test(phrase) ? "high" : "medium" };
	}
	// "keep the line between Mara and Joon": an authored line of action.
	if (!crossing && KEEP_LINE.test(phrase) && LINE_OF.test(phrase) && named.length >= 2) {
		return { action: "camera.setLine", args: { between: named.slice(0, 2) }, via: "line words", matched: [...wordsOf(phrase, KEEP_LINE), ...wordsOf(phrase, LINE_OF)], confidence: "high" };
	}
	if ((crossing || (cutWords && asked)) && !/\b(cover|coverage|lay|give me)\b/.test(phrase)) {
		const frame = phrase.match(/\b(?:at|frame|on)\s+(\d{1,5})\b/)?.[1];
		const matched = crossing ? [...wordsOf(phrase, CROSS), ...wordsOf(phrase, LINE)] : wordsOf(phrase, CUT);
		return { action: "camera.checkCuts", args: frame ? { frame: Number(frame) } : {}, via: "cut words", matched, confidence: crossing || /\bcheck/.test(phrase) ? "high" : "medium" };
	}
	const pattern = resolveCoveragePattern(phrase);
	if (pattern) {
		// "reverse on Joon": the reverse pattern, with Joon's side first.
		const group = ALL_COVERAGE_PATTERNS.find((row) => row.id === pattern.id), count = group.branching && phrase.match(BRANCHES)?.[1];
		return { action: "camera.cover", args: { pattern: pattern.id, ...(named.length ? { cast: named.slice(0, group.castMax ?? 2) } : {}), ...(count ? { branches: NUMBERS[count] ?? Number(count) } : {}) },
			via: "coverage words", matched: [pattern.key, ...(count ? [phrase.match(BRANCHES)[0]] : [])], confidence: "high" };
	}
	const composition = parseComposition(phrase);
	if (composition) return { action: "camera.applyTechnique", args: { composition, ...(named.length ? { subjectId: named[0] } : {}) }, via: "composition words", matched: wordsOf(phrase, COMPOSE), confidence: "high" };
	return null;
}
