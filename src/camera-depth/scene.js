// The set as the depth checks read it (depth-staging): every visible prop and
// cast member as a world box at a frame. Props measure through
// entityWorldBounds, the same box the agent's geometry facts and frame_shot
// read (a prop with a renderer from its footprint and height, an attached or
// routed one through the editor's bounds port); cast members are a column at
// their stature where they stand then. Also resolves a foreground named in
// words ("the lamp", "Joon") to one of them. Pure.
import { entityWorldBounds } from "../studio-agent-commands.js";
import { isEffectivelyHidden, isEmptyObject } from "../scene-objects.js";
import { figureBox } from "../camera-techniques/foreground.js";
import { normalizePhrase } from "../camera-techniques/resolve.js";
import { castAt } from "../camera-coverage/cut-geometry.js";

export const castName = (row) => String(row.subject ?? row.name ?? row.id).split(",")[0].trim();
const propName = (row) => String(row.name || row.kind || row.renderer || row.id);

/**
 * Visible props as { id, name, kind: "prop", box, attachedTo } at a frame.
 * @param {object[]} objects  scene object rows   @param {object[]} characters  character rows
 * @param {{ frame?: number, bounds?: Function }} [options]  bounds: the editor's bounds port ({ entity, frame, state }) for attached or routed props
 */
export function propBoxes(objects = [], characters = [], { frame = 0, bounds } = {}) {
	const state = { objects, characters, frame };
	return objects.filter((row) => !isEmptyObject(row) && !isEffectivelyHidden(row, objects, characters)).flatMap((row) => {
		const box = entityWorldBounds(row, state, { bounds });
		return box ? [{ id: row.id, name: propName(row), kind: "prop", box, attachedTo: row.attach?.characterId ?? null }] : [];
	});
}

/** Visible cast as { id, name, kind: "cast", box, row } where each stands at a frame of a shot (placeAt defaults to cut-geometry castAt). */
export function castBoxes(characters = [], shot = null, frame = 0, placeAt = castAt) {
	return characters.filter((row) => !row.hidden).map((row) => {
		const placed = placeAt(row, shot, frame);
		return { id: row.id, name: castName(row), kind: "cast", box: figureBox(placed), row: placed };
	});
}

/** The prop or cast member a foreground names: an id, a first name, a whole name, then a word of a prop's name ("lamp" finds "Floor lamp"). */
export function resolveNear(ref, { props = [], cast = [] }) {
	if (typeof ref !== "string" || !ref.trim()) return null;
	const exact = [...props, ...cast].find((row) => row.id === ref);
	if (exact) return exact;
	const key = normalizePhrase(ref).replace(/^(the|a|an|that|this) /, ""), name = (row) => normalizePhrase(row.name);
	return cast.find((row) => name(row) === key || name(row).split(" ")[0] === key) ?? props.find((row) => name(row) === key)
		?? props.find((row) => ` ${name(row)} `.includes(` ${key} `)) ?? props.find((row) => name(row).includes(key)) ?? null;
}
