// Depth-staging requests in a director's words: "is anything blocking her
// face?" -> camera.checkShots { rule: occluded }; "is the camera inside the
// wall?" -> { rule: inside }; "does the frame cut her at the knees?" ->
// { rule: crop }; "check my shots for problems" -> every rule; and "put the
// lamp in the foreground" -> a composition foreground on
// camera.applyTechnique (parseForeground). route.js asks here first. Pure.
import { normalizePhrase } from "../camera-techniques/resolve.js";

const wordsOf = (phrase, pattern) => [...phrase.matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);
const BLOCK = /\b(blocking|blocks|blocked|block out|hidden|hiding|hides|hide|obscured|obscuring|obscures|obstructed|obstructing|obstructs|occluded|occluding|occludes|in the way|covering|covers)\b/;
const SIGHT = /\b(face|faces|eyes|eyeline|view|sight|line of sight|her|him|them|his|their|subject|lens|camera|shot|shots)\b/;
const INSIDE = /\b(inside|in|into|through|clipping|clips|clip|intersecting|intersects|buried|stuck|too close to|touching)\b/;
const SOLID = /\b(wall|walls|prop|props|set|geometry|pillar|column|furniture|object|objects|table|door|floor|ceiling|mesh|scenery)\b/;
const CAMERA = /\b(camera|cameras|lens)\b/;
const CROP = /\b(cut|cuts|cutting|crop|crops|cropped|cropping|chop|chops|chopped|chopping|frame edge|edge of (?:the )?frame)\b/;
const JOINT = /\b(knee|knees|ankle|ankles|waist|neck|joint|joints|feet at the ankle|shins?)\b/;
const CHECK = /\b(check|checks|any|problem|problems|issues|safe|ok|okay)\b/, SHOTS = /\b(shots|shot|framing|framings|frames)\b/;
const ASK = /\b(is|are|does|do|did|anything|something|any|check|what|who|whether)\b/;

/** A shot-check question -> { action: "camera.checkShots", args: { rule? }, via, matched, confidence }, or null. */
export function resolveShotCheck(text) {
	const phrase = normalizePhrase(text), asked = ASK.test(phrase);
	if (asked && BLOCK.test(phrase) && SIGHT.test(phrase)) return { action: "camera.checkShots", args: { rule: "occluded" }, via: "shot check words", matched: [...wordsOf(phrase, BLOCK), ...wordsOf(phrase, SIGHT).slice(0, 1)], confidence: "high" };
	if (asked && CAMERA.test(phrase) && INSIDE.test(phrase) && SOLID.test(phrase)) return { action: "camera.checkShots", args: { rule: "inside" }, via: "shot check words", matched: [...wordsOf(phrase, CAMERA).slice(0, 1), ...wordsOf(phrase, INSIDE).slice(0, 1), ...wordsOf(phrase, SOLID).slice(0, 1)], confidence: "high" };
	if (asked && CROP.test(phrase) && JOINT.test(phrase)) return { action: "camera.checkShots", args: { rule: "crop" }, via: "shot check words", matched: [...wordsOf(phrase, CROP).slice(0, 1), ...wordsOf(phrase, JOINT).slice(0, 1)], confidence: "high" };
	if (/\bcheck\b/.test(phrase) && /\b(shots|framing|framings)\b/.test(phrase) && !/\b(cuts?|coverage|motivat\w*|move|moves)\b/.test(phrase)) return { action: "camera.checkShots", args: {}, via: "shot check words", matched: [...wordsOf(phrase, CHECK).slice(0, 1), ...wordsOf(phrase, SHOTS).slice(0, 1)], confidence: "high" };
	return null;
}

const FOREGROUND = /\b(?:in|into|to|for) (?:the )?(?:near )?foreground\b|\bforeground(?:ed)?\b/;
const DESCRIBE = new Set(["soft", "blurred", "dark", "focus", "out", "of", "shoulder", "shoulders", "back", "head", "s", "edge", "sliver", "bit", "touch", "hint", "piece", "corner", "little", "lot", "lots", "big", "large"]);
const STOP = new Set(["the", "a", "an", "that", "this", "his", "her", "their", "put", "place", "keep", "have", "with", "get", "bring", "use", "leave", "set", "past", "behind", "through", "and", "frame", "on", "of", "in", "is", "while", "shot", "up", "close", "wide", "medium"]);
const SHARE = [[/\b(sliver|slither|edge|little|touch|hint|bit)\b/, 0.2], [/\b(lots|lot|big|large|half|much|filling|heavy)\b/, 0.45]];

/** The noun a foreground names: the words just before "in the foreground" (descriptors such as "'s shoulder soft" left off), else just after "foreground". */
function nearNoun(phrase, hit) {
	const before = phrase.slice(0, hit.index).trim().split(" ").filter(Boolean);
	while (before.length && DESCRIBE.has(before.at(-1))) before.pop();
	const words = [];
	while (before.length && !STOP.has(before.at(-1)) && words.length < 3) words.unshift(before.pop());
	// "a sliver of the doorframe": the share words before the noun go with it.
	while (words.length && before.length && (DESCRIBE.has(before.at(-1)) || ["the", "a", "an", "of"].includes(before.at(-1)))) before.pop();
	if (words.length) return { noun: words.join(" "), from: before.join(" ").length };
	const after = phrase.slice(hit.index + hit[0].length).trim().split(" ").filter((word) => !["the", "a", "an"].includes(word));
	const tail = [];
	for (const word of after) { if (STOP.has(word) || tail.length >= 3) break; tail.push(word); }
	return tail.length ? { noun: tail.join(" "), from: hit.index } : null;
}

/**
 * Foreground words -> { foreground: { id, share? }, matched, phrase (the words to leave out of the technique parse) }, or null.
 * The id is the cast member or prop the words name (an id from `cast` / `props` when one answers to them, a possessive
 * "joon's" included, else the noun itself for the command to resolve against the scene).
 * @param {{ cast?: Array<{id,name?}>, props?: Array<{id,name?}> }} [options]
 */
export function parseForeground(text, { cast = [], props = [] } = {}) {
	const phrase = normalizePhrase(text), hit = FOREGROUND.exec(phrase), found = hit && nearNoun(phrase, hit);
	if (!found) return null;
	const { noun } = found, key = (row) => normalizePhrase(row.name ?? "");
	const named = [...cast, ...props].find((row) => row.name && [noun, noun.replace(/s$/, "")].some((word) => key(row) === word || key(row).split(" ")[0] === word));
	const share = SHARE.find(([pattern]) => pattern.test(phrase))?.[1];
	const end = Math.max(hit.index + hit[0].length, phrase.indexOf(noun, hit.index) >= 0 ? phrase.indexOf(noun, hit.index) + noun.length : 0);
	return { foreground: { id: named?.id ?? noun, ...(share ? { share } : {}) }, matched: [noun, hit[0]], phrase: phrase.slice(found.from, end) };
}
