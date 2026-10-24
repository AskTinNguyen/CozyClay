// What a shot camera's capabilities achieve, read back from the stored shot
// and the camera sampleAt makes of it: the receipt checks of camera.set,
// camera.setKey and camera.applyTechnique (roll degrees, focus subjects and
// distances, shake amplitude, mount bone, speed, shutter) and their summary.
import { sampleAt } from "../sample-at.js";
import { cameraCapabilities } from "./fields.js";

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** The runtime envelope sampleAt needs to resolve focus targets and mounts, built from the editor's view. */
export function capabilityScene(view, frameCount, fps = 24) {
	const cast = (view?.characters ?? []).map((row) => ({ ...row, ...(row.subject ? {} : { subject: row.name }) }));
	const subject = cast.find((row) => row.id === view?.activeCharacterId) ?? cast[0] ?? null;
	return { frameCount, fps, subject, cameraAnchor: subject, cast, filmback: view?.filmback, fovDeg: view?.camera?.fovDeg };
}

/**
 * @returns {{checks:object, words:string[]}} checks: rollDeg, fStop, focus ("Mara → Joon"),
 *   focusDistances [first, last], shakeAmplitude, mountBone, speed, shutterDeg (each when set);
 *   words: one short phrase per capability for a receipt summary.
 */
export function capabilityReadback(shot, scene, castName = (id) => id) {
	const caps = cameraCapabilities(shot?.camera), checks = {}, words = [];
	if (!shot || !Object.keys(caps).length) return { checks, words };
	const keys = caps.rigKeys ?? [], at = (frame) => sampleAt(scene, shot, frame).camera;
	const middle = Math.round((shot.startFrame + shot.endFrame) / 2);
	const rollKeys = keys.filter((key) => Number.isFinite(key.rollDeg));
	if (caps.rollDeg || rollKeys.length) {
		const ends = rollKeys.length ? [rollKeys[0], rollKeys.at(-1)].map((key) => at(shot.startFrame + key.offset)?.rollDeg ?? 0) : [at(middle)?.rollDeg ?? caps.rollDeg];
		checks.rollDeg = round(ends.at(-1));
		words.push(ends.length > 1 && ends[0] !== ends[1] ? `roll ${round(ends[0], 1)}° → ${round(ends[1], 1)}°` : `roll ${round(ends[0], 1)}°`);
	}
	const focusKeys = keys.filter((key) => key.focus);
	if (caps.lens || focusKeys.length) {
		if (caps.lens?.fStop) checks.fStop = caps.lens.fStop;
		const marks = focusKeys.length ? [focusKeys[0], focusKeys.at(-1)] : [];
		// Two cast members can share a description; then the ids tell them apart.
		const named = marks.map((key) => key.focus.targetId).filter(Boolean), label = new Set(named.map(castName)).size < new Set(named).size ? (castId) => castId : castName;
		const subjects = marks.length ? marks.map((key) => (key.focus.targetId ? label(key.focus.targetId) : `${key.focus.distance} m`))
			: [caps.lens?.focusTarget ? castName(caps.lens.focusTarget) : caps.lens?.focusDistance ? `${caps.lens.focusDistance} m` : caps.lens?.fStop && scene?.subject ? castName(scene.subject.id) : null].filter(Boolean);
		const distances = (marks.length ? marks.map((key) => at(shot.startFrame + key.offset)) : [at(shot.startFrame)]).map((camera) => camera?.focusDistance).filter(Number.isFinite).map((d) => round(d));
		if (subjects.length) checks.focus = [...new Set(subjects)].join(" → ");
		if (distances.length) checks.focusDistances = distances;
		words.push([caps.lens?.fStop ? `f/${caps.lens.fStop}` : null, checks.focus ? `focus ${checks.focus}${distances.length ? ` (${distances.join(" → ")} m)` : ""}` : null].filter(Boolean).join(" "));
	}
	if (caps.shake) {
		checks.shakeAmplitude = caps.shake.amplitude;
		words.push(`${caps.shake.style} shake ${caps.shake.amplitude}`);
	}
	if (caps.mount) {
		checks.mountBone = caps.mount.bone;
		words.push(`mounted on ${castName(caps.mount.characterId)}'s ${caps.mount.bone}`);
	}
	if (caps.speed) {
		checks.speed = caps.speed;
		words.push(`speed ${caps.speed}×`);
	}
	if (caps.shutterDeg) {
		checks.shutterDeg = caps.shutterDeg;
		words.push(`${caps.shutterDeg}° shutter`);
	}
	return { checks, words };
}
