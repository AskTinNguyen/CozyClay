// Look and colour requests in a director's words (colour-script A4;
// camera-coverage/route.js asks here after the structure resolver):
//   "colour script for this scene", "show me the palette of the sequence" -> shot.colourScript (read only)
//   "make the confession shot colder", "darker on shot 3"               -> shot.setLook { shot?, adjust }
//   "the same look as shot 2", "match the colour of the opening"        -> shot.setLook { sameAs }
//   "a cold isolation look on the kitchen shot", "danger accent here"   -> shot.setLook { recipe, shot? }
// Answers { action, args, via, matched, confidence } like the other resolvers, or null. Pure.
import { normalizePhrase } from "../camera-techniques/resolve.js";
import { LOOK_RECIPES } from "./recipes.js";

const COLOUR = "(?:colou?r|palette|grade|tone|look|lighting)";
const SCRIPT = new RegExp(`\\b(?:colou?r script|colou?r (?:strip|board|keys)|(?:palette|colou?rs) (?:of|for|across) (?:the |this |my )?(?:scene|sequence|cut|edit|film)|how does the ${COLOUR} (?:change|shift|move|flow))\\b`);
const NUDGES = { colder: "colder", cooler: "colder", warmer: "warmer", darker: "darker", dimmer: "darker", brighter: "brighter", hazier: "hazier", foggier: "hazier", mistier: "hazier", clearer: "clearer" };
const NUDGE = new RegExp(`\\b(${Object.keys(NUDGES).join("|")})\\b`);
const VERB = /\b(?:make|makes|turn|push|pushes|grade|light|go|take|bring|cool|warm)\b/;
const SAME = /\b(?:(?:the )?same (?:look|colou?rs?|palette|lighting|grade) as|match(?:es|ing)? (?:the )?(?:look|colou?rs?|palette|lighting|grade) (?:of|to|from)|(?:look|colou?r|palette|lighting) (?:of|from) (?:shot )?\d+ (?:on|for) (?:this|here))\s*(.*)$/;
const LOOK_WORD = new RegExp(`\\b${COLOUR}s?\\b|\\bfeel(?:s|ing)?\\b|\\bmood\\b`);
const HERE = /^(?:it|this|that|here|this one|the shot|this shot|that shot|the current shot|now)$/;

/** The shot a phrase names: an integer for "shot 3", a word for "the confession shot", or null for "this shot" / none. */
function shotRef(words) {
	const said = String(words ?? "").trim().replace(/^(?:the|this|that|our|my)\s+/, "").replace(/\s+(?:shot|one|scene|moment)$/, "").trim();
	const number = said.match(/^(?:shot )?(\d{1,3})$/);
	if (number) return Number(number[1]);
	if (!said || HERE.test(said) || HERE.test(`the ${said}`) || said.split(" ").length > 4) return null;
	return said;
}

/** "the confession shot" / "shot 3" in a nudge or recipe request, wherever it sits. */
function namedShot(phrase) {
	const numbered = phrase.match(/\bshot (\d{1,3})\b/);
	if (numbered) return Number(numbered[1]);
	const named = phrase.match(/\b(?:the|this|that) ([a-z][a-z0-9]*(?: [a-z][a-z0-9]*){0,2}) (?:shot|moment|scene)\b/);
	return named ? shotRef(named[1]) : null;
}

const matchedWords = (phrase, ...patterns) => patterns.map((pattern) => phrase.match(pattern)?.[0]).filter(Boolean);
const withShot = (args, shot) => (shot === null || shot === undefined ? args : { ...args, shot });

/** @returns {{ action, args, via, matched, confidence } | null} */
export function resolveLookRequest(text) {
	const phrase = normalizePhrase(text);
	if (!phrase) return null;
	if (SCRIPT.test(phrase)) return { action: "shot.colourScript", args: {}, via: "colour script words", matched: matchedWords(phrase, SCRIPT), confidence: "high" };
	const same = phrase.match(SAME);
	if (same) {
		const ref = shotRef(same[1].replace(/\s+(?:on|for) (?:this|here|it).*$/, "")) ?? shotRef(phrase.match(/\bshot (\d{1,3})\b/)?.[1]);
		if (ref !== null) return { action: "shot.setLook", args: { sameAs: ref }, via: "same look words", matched: [same[0].slice(0, same[0].length - same[1].length).trim()], confidence: typeof ref === "number" ? "high" : "medium" };
	}
	const nudge = phrase.match(NUDGE);
	if (nudge && (VERB.test(phrase) || LOOK_WORD.test(phrase))) {
		const adjust = NUDGES[nudge[1]], shot = namedShot(phrase);
		return { action: "shot.setLook", args: withShot({ adjust }, shot), via: "look nudge words", matched: [nudge[0]], confidence: "high" };
	}
	for (const recipe of LOOK_RECIPES) {
		const label = new RegExp(`\\b${recipe.label}\\b`);
		if (label.test(phrase)) return { action: "shot.setLook", args: withShot({ recipe: recipe.id }, namedShot(phrase)), via: "look recipe", matched: matchedWords(phrase, label), confidence: "high" };
	}
	if (LOOK_WORD.test(phrase) && /\b(?:look|lighting|colou?r|palette|grade)\b/.test(phrase)) {
		for (const recipe of LOOK_RECIPES) {
			const word = recipe.words.slice(1).find((entry) => new RegExp(`\\b${entry}\\b`).test(phrase));
			if (word) return { action: "shot.setLook", args: withShot({ recipe: recipe.id }, namedShot(phrase)), via: "look recipe words", matched: [word, ...matchedWords(phrase, /\b(?:look|lighting|colou?r|palette|grade)\b/)], confidence: "medium" };
		}
	}
	return null;
}
