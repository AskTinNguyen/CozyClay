// The shape of one camera technique, and the parameter vocabulary every
// catalog file shares. Pure data helpers: no three.js, no React.
//
// A technique is general film vocabulary (the name) plus CozyClay's own
// reading of it: a fresh description, the moods it is reached for, the
// parameters a director turns, and a recipe the compiler (compile.js) turns
// into the camera primitives the studio already has. `requires` names a
// camera capability this build does not have yet; such a technique applies
// as words in the prompt only, and every receipt says so. Roll, focus, shake,
// body mount, shot speed and motion blur are camera capabilities now
// (src/camera-capabilities/); their techniques compile to camera.set fields.

export const TECHNIQUE_KINDS = Object.freeze(["size", "angle", "move", "lens", "coverage", "modifier"]);

/** Shot sizes a move can start or end on, tight to wide (compile.js SIZE_SPECS). */
export const SIZE_LADDER = Object.freeze(["extreme close-up", "close-up", "medium close-up", "medium shot", "medium-wide shot", "wide shot", "extreme wide shot"]);

/** Capabilities still planned: a technique that needs one applies as prompt words only. None are left:
 * the coverage generator is camera.cover (src/camera-coverage/). */
export const PLANNED_CAPABILITIES = Object.freeze({});

export const speed = (value = "medium") => ({ type: "enum", options: ["slow", "medium", "fast"], default: value });
export const degrees = (value, min = 5, max = 360) => ({ type: "number", min, max, default: value, unit: "deg" });
export const metres = (value, min = 0.2, max = 30) => ({ type: "number", min, max, default: value, unit: "m" });
export const choice = (options, value = options[0]) => ({ type: "enum", options, default: value });
export const size = (value = null) => ({ type: "size", options: SIZE_LADDER, default: value });
export const steps = (value = 2) => ({ type: "number", min: 1, max: 4, default: value, unit: "size steps" });
export const cast = () => ({ type: "cast", default: null });
export const lens = (value) => ({ type: "number", min: 12, max: 135, default: value, unit: "mm" });
export const side = (value = "right") => choice(["right", "left"], value);

/**
 * One catalog entry. `tag` is the short slate word ("LOW", "PUSH-IN") the
 * timeline block and the stack label show; `prompt` is the wording a
 * generation prompt uses when the geometry alone cannot say it.
 */
export function technique(id, name, kind, tag, spec) {
	const { aliases = [], moods = [], description, params = {}, recipe = {}, prompt, requires = [], expect = null } = spec;
	return Object.freeze({ id, name, kind, tag, aliases: Object.freeze(aliases), moods: Object.freeze(moods), description,
		params: Object.freeze(params), recipe: Object.freeze(recipe), prompt, requires: Object.freeze(requires), expect });
}

/** Defaults filled, values clamped to the declared range or option list. */
export function resolveParams(entry, given = {}) {
	const out = {};
	for (const [key, schema] of Object.entries(entry.params)) {
		const value = given?.[key];
		if (schema.type === "number") out[key] = Number.isFinite(value) ? Math.max(schema.min, Math.min(schema.max, value)) : schema.default;
		else if (schema.type === "enum" || schema.type === "size") out[key] = schema.options.includes(value) ? value : schema.default;
		else out[key] = typeof value === "string" && value ? value : schema.default;
	}
	return out;
}
