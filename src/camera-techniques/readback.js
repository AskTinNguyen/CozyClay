// What an applied technique actually did, in words the move classifier
// proves: classify the keys (or the rail's camera track), phrase the stack
// for a prompt, and keep the stored stack honest (persisted shape and a
// signature of the camera it was applied to, in storage.js).
import { classifyMove } from "../camera-move.js";
import { buildRail, buildRailFollowTrack } from "../camera-follow.js";
import { focalMmToFov } from "../shot.js";

const DEG = 180 / Math.PI;
const toFraming = (exact, filmback = {}) => {
	const d = { x: exact.lookAt.x - exact.position.x, y: exact.lookAt.y - exact.position.y, z: exact.lookAt.z - exact.position.z };
	return { pos: { ...exact.position }, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fovDeg: focalMmToFov(exact.focalMm, filmback.sensorId, filmback.aspectRatio) * DEG };
};

/** Name a keyed move from stored camera keys ({ frame, framing }) or exact plan keys. */
export function classifyKeys(keys, subject, { fps = 24, height, filmback = {} } = {}) {
	const framings = keys.map((key) => key.framing.pos ? key.framing : toFraming(key.framing, filmback));
	const opts = (a, b) => ({ durationS: Math.max(1, b.frame - a.frame) / fps, height, sensorId: filmback.sensorId, aspectRatio: filmback.aspectRatio });
	if (framings.length < 2) return { ...classifyMove(framings[0], framings[0], subject, opts(keys[0], keys[0])), segments: [] };
	const segments = keys.slice(1).map((key, i) => classifyMove(framings[i], framings[i + 1], subject, opts(keys[i], key)));
	const moving = segments.filter((segment) => segment.id !== "static");
	if (moving.length > 1 && moving.every((segment) => segment.id === "orbit")) {
		const degrees = Math.round(Math.abs(moving.reduce((sum, segment) => sum + segment.deltas.dAzDeg, 0)));
		return { ...moving[0], to: moving.at(-1).to, phrase: `a ${moving[0].tempo ? `${moving[0].tempo} ` : ""}orbit around the subject, circling ${degrees} degrees`, segments, degrees };
	}
	if (moving.length === 1) return { ...moving[0], segments };
	return { ...classifyMove(framings[0], framings.at(-1), subject, opts(keys[0], keys.at(-1))), segments };
}

/** The camera a rail plan drives, integrated exactly as the editor's rail follow does (camera-follow.js). */
export function railTrack(rail, subject, frames, fps = 24) {
	const curve = buildRail(rail.points), still = Array.from({ length: Math.max(2, frames) }, () => ({ x: subject.x, z: subject.z }));
	return buildRailFollowTrack(still, fps, curve, { height: rail.height, aimHeight: rail.aimHeight, ...(rail.response ? { response: rail.response } : {}) });
}

/** Name a rail move from its first and last integrated camera. */
export function classifyRail(rail, subject, frames, { fps = 24, height, filmback = {} } = {}) {
	const track = railTrack(rail, subject, frames, fps), fovDeg = focalMmToFov(rail.focalMm, filmback.sensorId, filmback.aspectRatio) * DEG;
	const at = (row) => ({ pos: row.pos, yaw: row.yaw, pitch: row.pitch, fovDeg });
	return classifyMove(at(track[0]), at(track.at(-1)), subject, { durationS: frames / fps, height, sensorId: filmback.sensorId, aspectRatio: filmback.aspectRatio });
}

/** One prompt sentence for an applied stack: the proven move, the framing words, the lens, then the words only a prompt can carry. */
export function techniquePhrase(plan, move) {
	const parts = [...plan.words, move && move.id !== "static" ? move.phrase : plan.moveWords];
	const lens = plan.label.match(/(\d+(?:→\d+)?)mm$/)?.[1];
	return [...parts, ...(lens ? [`${lens.replace("→", " to ")}mm lens`] : []), ...plan.promptOnly.map((part) => part.words)].filter(Boolean).join("; ");
}
