// The camera technique library: one catalog, its lookups, and the compact
// views agents read (camera.techniques, camera.describeTechnique).
import { ANGLE_TECHNIQUES, SIZE_TECHNIQUES } from "./catalog-framing.js";
import { MOVE_TECHNIQUES } from "./catalog-moves.js";
import { COVERAGE_TECHNIQUES, MODIFIER_TECHNIQUES, RIG_TECHNIQUES } from "./catalog-rigs.js";
import { PLANNED_CAPABILITIES, TECHNIQUE_KINDS } from "./entry.js";
import { referencesFor } from "../camera-references/index.js";

export const TECHNIQUES = Object.freeze([...SIZE_TECHNIQUES, ...ANGLE_TECHNIQUES, ...MOVE_TECHNIQUES, ...RIG_TECHNIQUES, ...COVERAGE_TECHNIQUES, ...MODIFIER_TECHNIQUES]);
const BY_ID = new Map(TECHNIQUES.map((entry) => [entry.id, entry]));

export const techniqueById = (id) => BY_ID.get(id) ?? null;

/** True when an entry changes the camera; false when it is words only. */
export function hasGeometry(entry) {
	const recipe = entry.recipe;
	return Boolean(recipe.move || recipe.size || recipe.level || recipe.view || recipe.group || recipe.ots || recipe.pov || recipe.reverse);
}

// The camera capability field each capability recipe writes through camera.set.
const SETS = { roll: "rollDeg", rack: "lens+focus keys", shake: "shake", mount: "mount", speed: "speed", shutter: "shutterDeg" };

/** The camera fields a technique sets (camera-capabilities); [] for framing and move only. */
export const capabilityFields = (entry) => Object.entries(SETS).filter(([flag]) => entry.recipe[flag]).map(([, field]) => field);

const STACKING_RULE = "Stack at most one of each: a size, an angle, a roll (Dutch/canted), one move (move/lens kinds with a recipe), one coverage framing, plus any modifiers. "
	+ "Order does not matter; params go per technique ({ id, params }) or once for the stack (speed, focalMm, subjectId). "
	+ "sets: names the camera fields a technique writes (roll, focus, shake, mount, speed, shutter: real, in the preview, captures and exports). "
	+ "Techniques with needs apply as prompt words only until that camera capability exists.";

/** The read-only index an agent reads first: small enough for one 8 KiB receipt. */
export function techniqueIndex({ kind = null, mood = null } = {}) {
	const rows = TECHNIQUES.filter((entry) => (!kind || entry.kind === kind) && (!mood || entry.moods.includes(mood)));
	return {
		count: rows.length,
		kinds: TECHNIQUE_KINDS,
		techniques: rows.map((entry) => [entry.id, entry.kind, entry.moods.slice(0, 2).join(","), ...(entry.requires.length ? [`needs:${entry.requires.join("+")}`] : []),
			...(capabilityFields(entry).length ? [`sets:${capabilityFields(entry).join("+")}`] : [])]),
		row: "[id, kind, moods, needs? or sets?]",
		stacking: STACKING_RULE,
		next: "camera.describeTechnique { id } for params; camera.applyTechnique { shotId, subjectId, stack: [{ id, params }] } or { request: \"low-angle slow push-in\" }.",
	};
}

/** One technique in full, for the agent's second read. */
export function describeTechnique(id) {
	const entry = techniqueById(id);
	if (!entry) return null;
	return {
		id: entry.id, name: entry.name, kind: entry.kind, tag: entry.tag, aliases: entry.aliases, moods: entry.moods,
		description: entry.description, params: entry.params, prompt: entry.prompt,
		...(entry.expect ? { expectedMove: entry.expect } : {}),
		...(capabilityFields(entry).length ? { sets: capabilityFields(entry) } : {}),
		...(entry.requires.length ? { requires: entry.requires, promptOnly: hasGeometry(entry) ? "partly" : "entirely",
			missing: entry.requires.map((capability) => PLANNED_CAPABILITIES[capability]) } : {}),
		// Citations only (book, pages), from the owner's cinematic-atlas; [] when the atlas has no page for it.
		references: referencesFor("techniques", entry.id).map(({ book, pages, cite }) => ({ book, pages, cite })),
		furtherReading: "https://grokfilm.app",
	};
}

