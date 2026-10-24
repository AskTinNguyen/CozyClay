// The camera of a shot as numbers: sampled every frame through sampleAt (the
// same camera playback and export show), then summed: how far it travels and
// how fast, how far it pans and tilts and at how many degrees a second, the
// focal change, the roll, and the focus pull. A rail shot without a baked
// track reads its integrated rail (cut-geometry shotCameraAt). Shake is left
// out of the sums (it is stated as a capability), so a handheld push-in
// travels what the dolly travels. Pure.
import { sampleAt } from "../sample-at.js";
import { shotCameraAt } from "../camera-coverage/cut-geometry.js";
import { shortestArc } from "../camera-move.js";
import { fovToFocalMm } from "../shot.js";

const DEG = 180 / Math.PI;
const STEP_M = 1e-4, STEP_RAD = 1e-4, STEP_MM = 1e-3;
const r = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** The sampleAt envelope for a document: the cast resolves focus targets and mounts; the anchor is the active character. */
export function engineScene(document) {
	const cast = (document.cast ?? []).filter((row) => !row.hidden).map((row) => ({ ...row, ...(row.subject ? {} : { subject: row.name }) }));
	const subject = cast.find((row) => row.id === document.activeCharacterId) ?? cast[0] ?? null;
	return { frameCount: document.frameCount ?? 1 + Math.max(0, ...(document.shots ?? []).map((shot) => shot.endFrame)), fps: document.fps ?? 24, subject, cameraAnchor: subject, cast, filmback: document.filmback, fovDeg: document.fovDeg };
}

/** The shot camera at a frame: sampleAt's camera, or the integrated rail when no track was baked. */
function cameraAt(scene, shot, frame) {
	const sampled = sampleAt(scene, shot, frame).camera;
	if (sampled?.pos) return sampled;
	const pose = shotCameraAt(shot, frame, { cast: scene.cast, filmback: scene.filmback ?? {}, fovDeg: scene.fovDeg ?? 40 });
	if (!pose) return null;
	return { ...pose, focalMm: fovToFocalMm((pose.fovDeg / DEG), scene.filmback?.sensorId, scene.filmback?.aspectRatio) };
}

const steady = (shot) => {
	if (!shot?.camera?.shake) return shot;
	const { shake, ...camera } = shot.camera;
	return { ...shot, camera };
};

/**
 * @returns {{ frames, seconds, held, window: [first, last] | null, moveSeconds, distanceM, speedMps, panDeg, panDps, tiltDeg, tiltDps,
 *   focalMm: [start, end], rollDeg: [start, end], focusM: [start, end] | null, start, end }}  start/end: the sampled cameras
 */
export function measureShotCamera(document, shot, scene = engineScene(document)) {
	const fps = document.fps ?? 24, still = steady(shot), poses = [];
	for (let frame = shot.startFrame; frame <= shot.endFrame; frame++) poses.push(cameraAt(scene, still, frame));
	const frames = poses.length, start = poses[0], end = poses.at(-1);
	if (!start || !end || poses.some((pose) => !pose)) return { frames, seconds: frames / fps, held: true, unmeasured: true, window: null, start, end };
	let distance = 0, pan = 0, tilt = 0, first = -1, last = -1;
	for (let i = 1; i < frames; i++) {
		const a = poses[i - 1], b = poses[i];
		const step = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z), dYaw = shortestArc(a.yaw, b.yaw), dPitch = b.pitch - a.pitch;
		distance += step; pan += dYaw; tilt += dPitch;
		const moved = step > STEP_M || Math.abs(dYaw) > STEP_RAD || Math.abs(dPitch) > STEP_RAD || Math.abs(b.focalMm - a.focalMm) > STEP_MM || Math.abs((b.rollDeg ?? 0) - (a.rollDeg ?? 0)) > 0.01 || Math.abs((b.focusDistance ?? 0) - (a.focusDistance ?? 0)) > 1e-3;
		if (moved) { if (first < 0) first = i; last = i; }
	}
	const moveSeconds = first < 0 ? 0 : (last - first + 1) / fps, per = (value) => (moveSeconds > 0 ? value / moveSeconds : 0);
	const focus = [start.focusDistance, end.focusDistance];
	return {
		frames, seconds: frames / fps, held: first < 0, window: first < 0 ? null : [shot.startFrame + first - 1, shot.startFrame + last], moveSeconds,
		distanceM: distance, speedMps: per(distance), panDeg: pan * DEG, panDps: per(pan * DEG), tiltDeg: tilt * DEG, tiltDps: per(tilt * DEG),
		focalMm: [start.focalMm, end.focalMm], rollDeg: [start.rollDeg ?? 0, end.rollDeg ?? 0], focusM: focus.every(Number.isFinite) ? focus : null, start, end,
	};
}

const signed = (value, places) => `${value >= 0 ? "+" : "-"}${Math.abs(r(value, places))}`;

/** The measured camera in words, every number rounded as stated: m to 0.01, m/s to 0.01, degrees and °/s to 0.1, mm to 0.1. */
export function measuredWords(m) {
	if (m.unmeasured) return "camera not measured (a follow camera with no baked track)";
	if (m.held) {
		const roll = Math.abs(m.rollDeg[0]) >= 0.5 ? `, rolled ${r(m.rollDeg[0], 1)}°` : "";
		return `the camera holds still for ${r(m.seconds, 2)}s (locked off), ${r(m.focalMm[0], 1)} mm${roll}${m.focusM ? `, focus at ${r(m.focusM[0], 2)} m` : ""}`;
	}
	const parts = [];
	if (m.distanceM >= 0.05) parts.push(`travels ${r(m.distanceM, 2)} m at ${r(m.speedMps, 2)} m/s`);
	if (Math.abs(m.panDeg) >= 1) parts.push(`pans ${m.panDeg > 0 ? "left" : "right"} ${r(Math.abs(m.panDeg), 1)}° at ${r(Math.abs(m.panDps), 1)}°/s`);
	if (Math.abs(m.tiltDeg) >= 1) parts.push(`tilts ${m.tiltDeg > 0 ? "up" : "down"} ${r(Math.abs(m.tiltDeg), 1)}° at ${r(Math.abs(m.tiltDps), 1)}°/s`);
	if (!parts.length) parts.push("the camera holds its position");
	const dFocal = m.focalMm[1] - m.focalMm[0];
	parts.push(Math.abs(dFocal) >= 0.5 ? `focal ${r(m.focalMm[0], 1)} to ${r(m.focalMm[1], 1)} mm (${signed(dFocal, 1)} mm)` : `${r(m.focalMm[0], 1)} mm`);
	const dRoll = m.rollDeg[1] - m.rollDeg[0];
	if (Math.abs(dRoll) >= 0.5) parts.push(`rolls ${r(m.rollDeg[0], 1)}° to ${r(m.rollDeg[1], 1)}°`);
	else if (Math.abs(m.rollDeg[0]) >= 0.5) parts.push(`rolled ${r(m.rollDeg[0], 1)}°`);
	if (m.focusM && Math.abs(m.focusM[1] - m.focusM[0]) >= 0.05) parts.push(`focus pulls from ${r(m.focusM[0], 2)} m to ${r(m.focusM[1], 2)} m`);
	else if (m.focusM) parts.push(`focus at ${r(m.focusM[0], 2)} m`);
	return `${parts.join(", ")}, over ${r(m.moveSeconds, 2)}s`;
}
