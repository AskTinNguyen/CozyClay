/**
 * The memory-only camera inside a saved project (#861).
 *
 * Without an editor the shot camera lives only in the MCP state, which the
 * scene document does not carry. It rides the active scene's stage as one
 * extra key: createSceneStage keeps unknown stage keys losslessly, so the
 * studio passes it through untouched and `open_project` reads it back here.
 */
const STAGE_KEY = "authoringCamera";
const FIELDS = ["x", "y", "z", "focalMm"];

/** A copy of `document` whose active scene's stage records `camera`. */
export function documentWithCamera(document, camera) {
	const record = Object.fromEntries(FIELDS.map((key) => [key, camera[key]]));
	if (!FIELDS.every((key) => Number.isFinite(record[key]))) return document;
	return {
		...document,
		scenes: document.scenes.map((scene) => scene.id === document.activeSceneId
			? { ...scene, stage: { ...scene.stage, [STAGE_KEY]: record } }
			: scene),
	};
}

/** The camera saved with the active scene, or null when the project has none. */
export function savedCamera(document) {
	const scene = document.scenes.find((entry) => entry.id === document.activeSceneId) ?? document.scenes[0];
	const record = scene?.stage?.[STAGE_KEY];
	if (!record || typeof record !== "object") return null;
	if (!FIELDS.every((key) => Number.isFinite(record[key]))) return null;
	if (record.focalMm <= 0) return null;
	return Object.fromEntries(FIELDS.map((key) => [key, record[key]]));
}
