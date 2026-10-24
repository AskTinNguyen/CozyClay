// One director's request -> the one camera action that answers it, with the
// words that decided it and how sure the resolver is. Coverage, composition and
// cut questions first (resolve.js), then the technique stack (camera-techniques
// /resolve.js). A "shot" that is not a camera shot (a drink, a gunshot, a
// basketball shot, a jab) names no camera action unless a camera word sits
// beside it. camera.applyTechnique, the MCP tools and the director evals
// (test/verify-director-evals.mjs) all route through here. Pure.
import { normalizePhrase, parseRequest } from "../camera-techniques/resolve.js";
import { resolveCameraRequest } from "./resolve.js";
import { resolveMotivationRequest } from "../camera-motivation/resolve.js";

// Everyday senses of "shot", in CozyClay's own grouping (after the cinematic-atlas generator's false-positive idea).
const DRINKS = "whiskey|whisky|tequila|vodka|rum|gin|bourbon|espresso|jello|jelly|sake|soju|schnapps|absinthe";
const NOT_CAMERA = [
	["a drink", new RegExp(`\\b(?:(?:${DRINKS}) shots?|shots? of (?:${DRINKS})|shot glass(?:es)?|(?:doing|do|does|did|pour|pours|poured|pouring|round of|another round of) shots)\\b`)],
	["a gunshot", /\b(?:gunshots?|gun shots?|rifle shots?|pistol shots?|bullet shots?|warning shots?|shots? (?:rang|rings|ring) out|shots fired|(?:fires|fired|firing|fire) (?:a |the |two |three )?shots?|(?:was|were|got|gets|been|is|get) shot|shot (?:him|her|them|dead|down))\b/],
	["a medical shot", /\b(?:flu|vaccine|booster|tetanus|allergy|insulin|covid|rabies) shots?\b/],
	["a sports shot", /\b(?:basketball|hockey|golf|tennis|jump|slap|penalty|trick|tee|bank|putt|snooker|pool|free throw) shots?\b|\bshot put\b/],
	["a turn of phrase", /\b(?:mugshots?|mug shots?|screenshots?|screen shots?|big shots?|cheap shots?|parting shots?|best shot|give it a shot|worth a shot|(?:take|takes|took) a shot at|shot in the dark|calls? the shots)\b/],
];

/** The everyday "shot" in the words ({ sense, phrase }), or null. */
function notCameraShot(phrase) {
	for (const [sense, pattern] of NOT_CAMERA) {
		const hit = phrase.match(pattern);
		if (hit) return { sense, phrase: hit[0] };
	}
	return null;
}

// Composition words are not technique words: "tight headroom" is not a tight shot.
const COMPOSITION_WORDS = /\b(?:(?:tight|less|little|no|loose|more|lots of|plenty of|extra|normal|bigger) )?(?:head ?room|lead ?room|leadroom|looking ?room|nose ?room|leading ?room)\b|\brule of thirds\b|\bthirds?\b/g;
const RANK = { high: 3, medium: 2, low: 1 };
const lowest = (...levels) => levels.filter(Boolean).sort((a, b) => RANK[a] - RANK[b])[0];
/** How sure a technique match is: names and aliases are high, a spelling slip medium, a mood low. */
const techniqueConfidence = (matched) => (matched.some((row) => row.via === "mood") ? "low" : matched.some((row) => row.via === "fuzzy") ? "medium" : "high");

/**
 * A request -> { action, args, via, matched, confidence, resolved?, dropped?, reason? }.
 * action is camera.applyTechnique, camera.cover, camera.checkCuts, a motivation action (camera-motivation/resolve.js), or "none" (no camera action; reason says why).
 * @param {string} text
 * @param {{cast?: Array<{id:string,name?:string}>}} [options]
 */
export function routeCameraRequest(text, { cast = [] } = {}) {
	const motivated = resolveMotivationRequest(text);
	if (motivated) return motivated;
	const phrase = normalizePhrase(text), everyday = notCameraShot(phrase);
	const rest = everyday ? phrase.replace(everyday.phrase, " ") : phrase;
	const routed = resolveCameraRequest(rest, { cast });
	if (routed && routed.action !== "camera.applyTechnique") return routed;
	const parsed = parseRequest(rest.replace(COMPOSITION_WORDS, " "), { cast }), named = parsed.matched.filter((row) => row.via !== "mood");
	// Beside an everyday shot, or beside composition words, a mood alone does not ask for a technique.
	const matched = everyday || routed ? named : parsed.matched;
	const stack = matched.length === parsed.matched.length ? parsed.stack : parsed.stack.filter((row) => named.some((hit) => hit.id === row.id));
	const subjectId = routed?.args.subjectId ?? parsed.subjectId;
	if (!routed && !stack.length) {
		return everyday ? { action: "none", args: {}, via: "not a camera shot", matched: [everyday.phrase], confidence: "high", reason: `"${everyday.phrase}" is ${everyday.sense}, not a camera shot` }
			: { action: "none", args: {}, via: "no camera words", matched: [], confidence: "medium", reason: "no technique, coverage, composition or cut words" };
	}
	return { action: "camera.applyTechnique", args: { ...(stack.length ? { stack } : {}), ...(routed ? { composition: routed.args.composition } : {}), ...(subjectId ? { subjectId } : {}) },
		via: routed ? (stack.length ? "composition and technique words" : routed.via) : matched.every((row) => row.via === "mood") ? "mood words" : "technique words",
		matched: [...(routed?.matched ?? []), ...matched.map((row) => row.phrase)], confidence: lowest(routed?.confidence, stack.length ? techniqueConfidence(matched) : null),
		resolved: matched, dropped: parsed.dropped };
}
