// One shot.setLook edit as a pure function (colour-script A1, A4), shared by
// the Studio action (commands/shot-look.js) and the MCP tool's in-memory plan
// (mcp/shot-look-tool.mjs): clear, copy another shot's look, a recipe, a
// partial (null clears a field), an intended palette, then a nudge, applied in
// that order over the shot's current look and repaired. Pure.
import { repairShotLook, shotLookWords } from "../stage-shot-look.js";
import { adjustLook, lookRecipe } from "./recipes.js";

/** The edit keys a request or call may carry. */
export const LOOK_EDIT_KEYS = Object.freeze(["recipe", "look", "palette", "adjust", "sameAs", "clear"]);

/**
 * @param {object|null} current  the shot's look now
 * @param {{ clear?, sameAs?, recipe?, look?, palette?, adjust? }} want
 * @param {{ stage?: object, source?: object|null }} [context]  stage: what the look merges over (for a nudge); source: the shot sameAs names
 * @returns {object|null} the repaired look, or null for none
 */
export function editShotLook(current, want, { stage = {}, source = null } = {}) {
	let look = want.clear ? null : current ?? null;
	if (want.sameAs !== undefined) {
		if (!source?.look) throw Object.assign(new Error(`${source?.name ?? "That shot"} has no look of its own to copy; it plays the stage look.`), { code: "TARGET_NOT_READY" });
		look = structuredClone(source.look);
	}
	if (want.recipe) {
		const recipe = lookRecipe(want.recipe);
		if (!recipe) throw Object.assign(new Error(`No look recipe ${want.recipe}.`), { code: "INVALID_ARGUMENT" });
		look = structuredClone(recipe.look);
	}
	if (want.look) {
		look = { ...(look ?? {}) };
		for (const [field, value] of Object.entries(want.look)) if (value === null) delete look[field]; else look[field] = value;
	}
	if (want.palette) look = { ...(look ?? {}), palette: want.palette };
	if (want.adjust) look = adjustLook(look, want.adjust, stage);
	return repairShotLook(look);
}

/** A look in words, its recipe named by its label ("cold isolation: overcast preset, ..."), or "the stage look". */
export const lookText = (look) => (look ? shotLookWords(look, { label: look.recipe ? lookRecipe(look.recipe)?.label ?? null : null }) : "the stage look");

/**
 * The intended palette with swatch `index` set to `hex` (the Look panel's swatch inputs): dense, at
 * least three swatches and at most five, the unset ones grey, so editing the fourth swatch of a shot
 * with no palette yet keeps the edit.
 */
export function paletteWithSwatch(palette, index, hex, fill = "#808080") {
	const swatches = palette?.swatches ?? [], dense = Array.from({ length: Math.min(5, Math.max(3, swatches.length, index + 1)) }, (_, k) => swatches[k] ?? fill);
	dense[index] = hex;
	return { swatches: dense, word: palette?.word ?? "" };
}
