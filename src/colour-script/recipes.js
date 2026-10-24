// Look recipes in story words (colour-script A4): each is a shot look
// (stage-shot-look.js) and the palette it is meant to read as, keyed to what
// the colour says in the story, not to a time of day. Written for CozyClay;
// the values are tuned by eye on the clay figure, starting points to tweak.
// Also the relative nudges a director asks for ("colder", "darker"). Pure data.
import { keyHex, mergeShotLook, mixHex, repairShotLook } from "../stage-shot-look.js";

const recipe = (id, label, mood, look, swatches, word, words = []) => Object.freeze({ id, label, mood, words: Object.freeze([label, ...words]),
	look: Object.freeze({ recipe: id, ...look, palette: Object.freeze({ swatches: Object.freeze(swatches), word }) }) });

export const LOOK_RECIPES = Object.freeze([
	recipe("warm-safety", "warm safety", "A lamp-lit room the characters trust: amber key, soft fill, nothing in the dark corners.",
		{ preset: "interior", exposure: 1.05, fill: 0.75 }, ["#f2c38b", "#c9814a", "#6e4529", "#2b2621"], "amber hearth", ["safety", "safe", "cosy", "cozy", "homely", "comfort"]),
	recipe("cold-isolation", "cold isolation", "Someone alone and shut out: a pale blue key, low fill, haze that swallows the room.",
		{ preset: "overcast", keyColor: "#a9c4f0", exposure: 0.85, fill: 0.5, fog: 0.45, sky: "#6f7f94" }, ["#2c3e50", "#5d7a99", "#a9c4f0", "#d9e2ec"], "steel blue", ["isolation", "isolated", "lonely", "alone", "estranged"]),
	recipe("danger-accent", "danger accent", "A black room with one red key: the colour is the threat.",
		{ preset: "stage", keyColor: "#ff4a3a", exposure: 1, fog: 0.5 }, ["#120a0a", "#5a1010", "#d8332a", "#f2e6d8"], "red alarm", ["danger", "dangerous", "alarm", "warning"]),
	recipe("open-day", "open day", "Plain daylight with nothing to hide: a high sun under a blue sky.",
		{ preset: "day" }, ["#bcd2e8", "#4f86c6", "#d9d2c3", "#6b6253"], "open daylight", ["neutral", "everyday", "ordinary"]),
	recipe("fading-hope", "fading hope", "The last warm light going out of the sky: a low glow under deepening blue.",
		{ preset: "dusk", exposure: 0.9 }, ["#18223f", "#5b6c9c", "#8a6f8c", "#ff9466"], "last light", ["fading", "loss", "regret", "melancholy"]),
	recipe("night-menace", "night menace", "Something waits in the dark: a cool moon key, thick haze, deep shadow.",
		{ preset: "night", fog: 0.55, exposure: 0.85 }, ["#020408", "#0b1426", "#34507f", "#9db6e6"], "moonlit threat", ["menace", "menacing", "dread", "threat", "sinister"]),
	recipe("tender-memory", "tender memory", "A remembered afternoon: low gold sun, soft haze, lifted fill.",
		{ preset: "golden", fog: 0.45, fill: 0.7, exposure: 1.1 }, ["#f0a868", "#ffd9a8", "#9fb3d6", "#6e5136"], "soft gold", ["memory", "nostalgia", "nostalgic", "tender", "flashback"]),
	recipe("sickly-unease", "sickly unease", "A room that feels wrong: a sallow green key on dull walls.",
		{ preset: "interior", keyColor: "#c8d86a", sky: "#2a2f1f", exposure: 0.9 }, ["#2a2f1f", "#6b7a3a", "#c8d86a", "#e8e2c0"], "sallow green", ["unease", "uneasy", "sickly", "wrong", "queasy"]),
]);

export const LOOK_RECIPE_IDS = Object.freeze(LOOK_RECIPES.map((row) => row.id));

/** A recipe by id, label or one of its words ("cold isolation", "lonely"); null when none. */
export function lookRecipe(name) {
	const said = String(name ?? "").trim().toLowerCase().replaceAll("_", "-");
	if (!said) return null;
	return LOOK_RECIPES.find((row) => row.id === said || row.label === said.replaceAll("-", " ")) ?? LOOK_RECIPES.find((row) => row.words.includes(said)) ?? null;
}

const COLD = "#8fb0ff", WARM = "#ffb067";
/** The nudges a look takes, in a director's words. */
export const LOOK_ADJUSTMENTS = Object.freeze(["colder", "warmer", "darker", "brighter", "hazier", "clearer"]);

/**
 * A look nudged one step: colder / warmer move the key colour (and an own sky)
 * 35 % toward a cold or warm tint from what the shot shows now; darker /
 * brighter scale exposure by 0.8 / 1.25; hazier / clearer move haze 0.2. The
 * intended palette and recipe name stay. `stage` is the stage the look sits on.
 */
export function adjustLook(look, adjustment, stage) {
	const now = mergeShotLook(stage, look ?? {}), current = look ?? {};
	const exposure = now.lighting?.exposure ?? 1, fog = now.lighting?.fog ?? 0;
	switch (adjustment) {
		case "colder": case "warmer": {
			const tint = adjustment === "colder" ? COLD : WARM, sky = current.sky ? { sky: mixHex(current.sky, tint, 0.35) } : {};
			const rest = Object.fromEntries(Object.entries(current).filter(([field]) => field !== "warmth"));
			return repairShotLook({ ...rest, keyColor: mixHex(keyHex(now.keyLight), tint, 0.35), ...sky });
		}
		case "darker": return repairShotLook({ ...current, exposure: exposure * 0.8 });
		case "brighter": return repairShotLook({ ...current, exposure: exposure * 1.25 });
		case "hazier": return repairShotLook({ ...current, fog: fog + 0.2 });
		case "clearer": return repairShotLook({ ...current, fog: fog - 0.2 });
		default: throw new Error(`Unknown look adjustment: ${adjustment}`);
	}
}
