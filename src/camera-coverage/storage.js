// The optional fields a shot carries from the camera library, repaired for
// the shot document (shot-authoring.js): the technique stack it was framed
// with, the coverage pattern that laid it (and, for a group or branching
// pattern, its setup and branch), the line of action authored on it
// (camera.setLine), and the transition into it. Each is
// absent unless set, so older bodies stay byte-identical. Dependency-light on
// purpose: the shot document repair imports it.
import { repairShotTechnique } from "../camera-techniques/storage.js";
import { repairTransition, repairTransitionOut } from "./transitions.js";

const text = (value, max) => (typeof value === "string" ? Array.from(value.trim()).slice(0, max).join("") : "");

/** Persisted coverage: { pattern, index, role, subjectId }; null when unreadable. */
function repairCoverage(value) {
	if (!value || typeof value !== "object" || typeof value.pattern !== "string" || !/^[a-z0-9-]{1,40}$/.test(value.pattern)) return null;
	return {
		pattern: value.pattern,
		index: Number.isInteger(value.index) ? Math.max(0, Math.min(63, value.index)) : 0,
		role: text(value.role, 24),
		...(typeof value.subjectId === "string" && value.subjectId.length <= 80 ? { subjectId: value.subjectId } : {}),
		...(typeof value.setup === "string" && /^[a-z0-9-]{1,40}$/.test(value.setup) ? { setup: value.setup } : {}),
		...(Number.isInteger(value.branch) && value.branch >= 0 && value.branch < 16 ? { branch: value.branch } : {}),
	};
}

/** The authored line of action: { between: [idA, idB] } (two different cast ids); null when unreadable. */
export function repairLine(value) {
	const ids = Array.isArray(value?.between) ? value.between.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 80) : [];
	return ids.length === 2 && ids[0] !== ids[1] ? { between: [ids[0], ids[1]] } : null;
}

/** The technique, coverage and transition fields of one stored shot, each only when present. */
export function repairShotExtras(entry) {
	const technique = repairShotTechnique(entry?.technique), coverage = repairCoverage(entry?.coverage), transition = repairTransition(entry?.transition), transitionOut = repairTransitionOut(entry?.transitionOut);
	const line = repairLine(entry?.line);
	return { ...(technique ? { technique } : {}), ...(coverage ? { coverage } : {}), ...(line ? { line } : {}), ...(transition ? { transition } : {}), ...(transitionOut ? { transitionOut } : {}) };
}
