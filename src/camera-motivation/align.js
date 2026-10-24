// Retiming one move so it starts or settles on a beat (camera.alignMove): the
// camera keys and rig keys that make the segment are mapped from its old
// window onto the new one, keeping its length unless a shot edge squeezes it.
// Hold keys anywhere in the swept interval (old window to new window) are
// dropped, so the surrounding holds carry the poses; another move in the way
// refuses. A stored technique stack that described the camera still does
// after the retime. Pure.
import { techniqueSignature } from "../camera-techniques/storage.js";

const refuse = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** The window [startFrame, endFrame] a segment takes when its start (edge "start") or its rest (edge "settle") lands on frame. */
function alignedWindow(shot, segment, frame, edge = "start") {
	const length = segment.endFrame - segment.startFrame;
	let startFrame = edge === "settle" ? frame - length : frame, endFrame = edge === "settle" ? frame : frame + length;
	if (startFrame < shot.startFrame) startFrame = shot.startFrame;
	if (endFrame > shot.endFrame) endFrame = shot.endFrame;
	if (edge === "start" && frame > shot.endFrame - 2) refuse("INVALID_RANGE", `f${frame} is too late in ${shot.name} (${shot.startFrame}-${shot.endFrame}) for the move to start there.`);
	if (edge === "settle" && frame < shot.startFrame + 2) refuse("INVALID_RANGE", `f${frame} is too early in ${shot.name} (${shot.startFrame}-${shot.endFrame}) for the move to settle there.`);
	if (endFrame - startFrame < 2) refuse("INVALID_RANGE", `The move would have ${endFrame - startFrame} frames left inside ${shot.name}.`);
	return { startFrame, endFrame };
}

/**
 * @param {object} shot      the shot document row (keys camera, or keys with rig keys)
 * @param {object} segment   a segment from segments.js (startFrame, endFrame)
 * @param {Array} others     the shot's other segments (they must stay clear of the new window)
 * @returns {{ shot, from: [s, e], to: [s, e], keys: number, rigKeys: number }}
 */
export function alignSegment(shot, segment, others, frame, edge = "start") {
	const mode = shot.camera?.mode ?? "keys";
	if (mode === "follow") refuse("TARGET_NOT_READY", `${shot.name} is a follow camera: it moves with its subject, so retime the subject's motion instead.`);
	if (mode === "rail") refuse("TARGET_NOT_READY", `${shot.name} rides a rail that travels with its subject; retime the subject, or put the shot back on keys (shot.frame).`);
	const to = alignedWindow(shot, segment, frame, edge), from = { startFrame: segment.startFrame, endFrame: segment.endFrame };
	// The swept interval runs from the old window to the new one; the hold keys in it go, and no other move may sit in it.
	const sweptStart = Math.min(from.startFrame, to.startFrame), sweptEnd = Math.max(from.endFrame, to.endFrame);
	const blocking = others.find((row) => row.index !== segment.index && row.startFrame < sweptEnd && row.endFrame > sweptStart);
	if (blocking) refuse("INVALID_RANGE", `The move would run into the other move at f${blocking.startFrame}-${blocking.endFrame}.`);
	const scale = (to.endFrame - to.startFrame) / Math.max(1, from.endFrame - from.startFrame);
	const inMove = (at) => at >= from.startFrame - 1 && at <= from.endFrame + 1;
	const map = (at) => Math.round(to.startFrame + (Math.max(from.startFrame, Math.min(from.endFrame, at)) - from.startFrame) * scale);
	const overrun = (at) => at >= sweptStart && at <= sweptEnd;
	let keys = 0, rigKeys = 0;
	const cameraKeys = (shot.cameraKeys ?? []).flatMap((key) => {
		if (inMove(key.frame)) { keys += 1; return [{ ...key, frame: map(key.frame) }]; }
		return overrun(key.frame) ? [] : [key];
	}).sort((a, b) => a.frame - b.frame);
	const rig = (shot.camera?.rigKeys ?? []).flatMap((key) => {
		const at = shot.startFrame + key.offset;
		if (inMove(at)) { rigKeys += 1; return [{ ...key, offset: map(at) - shot.startFrame }]; }
		return overrun(at) ? [] : [key];
	}).sort((a, b) => a.offset - b.offset);
	if (!keys && !rigKeys) refuse("TARGET_NOT_READY", `No camera key or rig key makes the move at f${from.startFrame}-${from.endFrame} in ${shot.name}; it cannot be retimed.`);
	if (new Set(cameraKeys.map((key) => key.frame)).size !== cameraKeys.length || new Set(rig.map((key) => key.offset)).size !== rig.length) refuse("INVALID_RANGE", "Two keys would land on one frame; give the move more room.");
	const next = { ...shot, cameraKeys, ...(shot.camera?.rigKeys ? { camera: { ...shot.camera, rigKeys: rig } } : {}) };
	// The stack still describes the camera: same keys, new times.
	if (shot.technique && shot.technique.signature === techniqueSignature(shot)) next.technique = { ...shot.technique, signature: techniqueSignature(next) };
	return { shot: next, from: [from.startFrame, from.endFrame], to: [to.startFrame, to.endFrame], keys, rigKeys };
}
