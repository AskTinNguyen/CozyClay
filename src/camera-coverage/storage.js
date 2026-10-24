// The optional fields a shot carries from the camera library, repaired for
// the shot document (shot-authoring.js): the technique stack it was framed
// with, the coverage pattern that laid it, and the transition into it. Each is
// absent unless set, so older bodies stay byte-identical. Dependency-light on
// purpose: the shot document repair imports it.
import { repairShotTechnique } from "../camera-techniques/storage.js";
import { repairTransition } from "./transitions.js";

const text = (value, max) => (typeof value === "string" ? Array.from(value.trim()).slice(0, max).join("") : "");

/** Persisted coverage: { pattern, index, role, subjectId }; null when unreadable. */
export function repairCoverage(value) {
	if (!value || typeof value !== "object" || typeof value.pattern !== "string" || !/^[a-z0-9-]{1,40}$/.test(value.pattern)) return null;
	return {
		pattern: value.pattern,
		index: Number.isInteger(value.index) ? Math.max(0, Math.min(63, value.index)) : 0,
		role: text(value.role, 24),
		...(typeof value.subjectId === "string" && value.subjectId.length <= 80 ? { subjectId: value.subjectId } : {}),
	};
}

/** The technique, coverage and transition fields of one stored shot, each only when present. */
export function repairShotExtras(entry) {
	const technique = repairShotTechnique(entry?.technique), coverage = repairCoverage(entry?.coverage), transition = repairTransition(entry?.transition);
	return { ...(technique ? { technique } : {}), ...(coverage ? { coverage } : {}), ...(transition ? { transition } : {}) };
}
