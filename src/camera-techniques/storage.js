// The technique stack a shot carries (shot.technique): its persisted shape
// and the signature that says whether it still describes the shot's camera.
// Imports only the dependency-free capability fields, because the shot document repair imports it.
import { cameraCapabilities } from "../camera-capabilities/fields.js";

// A short, stable fingerprint of the camera a stack was applied to: when the
// keys or the rail change by hand, the stored stack no longer describes them.
export function techniqueSignature(shot) {
	const round = (value) => Math.round(value * 1000) / 1000;
	const keys = (shot?.cameraKeys ?? []).map((key) => [key.frame, round(key.framing.pos.x), round(key.framing.pos.y), round(key.framing.pos.z), round(key.framing.yaw), round(key.framing.pitch), round(key.framing.fovDeg)]);
	// Roll, lens, shake, mount, speed and shutter count too, only when the camera carries any (older signatures hold).
	const capabilities = cameraCapabilities(shot?.camera), extra = Object.keys(capabilities).length ? [capabilities] : [];
	const text = JSON.stringify([shot?.camera?.mode ?? "keys", keys, (shot?.camera?.cameraRail ?? []).map((point) => [round(point.x), round(point.z)]), ...extra]);
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
	return hash.toString(36);
}

/** The applied stack, if it still describes the shot's camera; null once the camera was edited by hand. */
export const currentTechnique = (shot) => (shot?.technique && shot.technique.signature === techniqueSignature(shot) ? shot.technique : null);

const text = (value, max) => (typeof value === "string" ? Array.from(value.trim()).slice(0, max).join("") : "");
const primitive = (value) => ["string", "number", "boolean"].includes(typeof value) && (typeof value !== "number" || Number.isFinite(value));

/** Persisted shape (shot-authoring.js): bounded strings, primitive params, at most 8 techniques. */
export function repairShotTechnique(value) {
	if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.stack)) return null;
	const stack = value.stack.filter((row) => row && typeof row.id === "string" && /^[a-z0-9-]{1,40}$/.test(row.id)).slice(0, 8)
		.map((row) => ({ id: row.id, params: Object.fromEntries(Object.entries(row.params && typeof row.params === "object" ? row.params : {}).filter(([key, param]) => key.length <= 24 && primitive(param)).slice(0, 8)) }));
	if (!stack.length) return null;
	// capabilities: the camera fields this stack set (camera.set), so a re-applied stack can clear the ones it no longer sets.
	const capabilities = (Array.isArray(value.capabilities) ? value.capabilities : []).filter((field) => typeof field === "string" && /^[a-zA-Z]{1,16}$/.test(field)).slice(0, 8);
	return { stack, label: text(value.label, 80), phrase: text(value.phrase, 600), move: text(value.move, 24), promptOnly: (Array.isArray(value.promptOnly) ? value.promptOnly : []).filter((id) => typeof id === "string").slice(0, 8),
		signature: text(value.signature, 16), ...(capabilities.length ? { capabilities } : {}) };
}
