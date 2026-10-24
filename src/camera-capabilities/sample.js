// The capability layer of sampleAt: given the keyed, railed or followed camera
// at a frame, mount it on a body, roll it, shake it, and resolve its focus,
// aperture and shutter. Pure and frame-addressed, so the viewport, the shot
// camera preview, a capture and every export read one camera.
import { KEY_EASES, easeInOut } from "../camera-move.js";
import { hasCapabilities } from "./fields.js";
import { castPlacementAt, facePoint, mountedPose } from "./mount.js";
import { applyShake, shakeOffset } from "./shake.js";

const BLUR_SAMPLES = 9;

/**
 * One rig-key channel at a frame. Only keys holding a value for `read` take
 * part; between two of them the value eases like a camera key (the earlier
 * key's `ease`, absent = in and out); outside them it holds. Null = no keys.
 */
function rigKeyValue(keys, startFrame, frame, read) {
	const valued = (keys ?? []).map((key) => ({ frame: startFrame + key.offset, ease: key.ease, value: read(key) })).filter((key) => Number.isFinite(key.value));
	if (!valued.length) return null;
	if (frame <= valued[0].frame) return valued[0].value;
	for (let i = 0; i < valued.length - 1; i++) {
		const a = valued[i], b = valued[i + 1];
		if (frame <= b.frame) return a.value + (b.value - a.value) * (KEY_EASES[a.ease] ?? easeInOut)((frame - a.frame) / Math.max(b.frame - a.frame, 1e-6));
	}
	return valued.at(-1).value;
}

/** Distance from the lens to a point along the optical axis: what a focus ring is set to. */
export function focusDistanceTo(camera, point) {
	const cp = Math.cos(camera.pitch), forward = { x: -Math.sin(camera.yaw) * cp, y: Math.sin(camera.pitch), z: -Math.cos(camera.yaw) * cp };
	const along = (point.x - camera.pos.x) * forward.x + (point.y - camera.pos.y) * forward.y + (point.z - camera.pos.z) * forward.z;
	return Math.max(0.05, along);
}

/**
 * @param {object|null} camera  sampleAt's camera { pos, yaw, pitch, fovDeg, focalMm, sensorId }
 * @param {{scene:object, shot:object, frame:number, takeFrame:number, subjectPoint:object|null}} at
 * @returns the camera with mount, rollDeg, shake, fStop, focusDistance and shutterDeg applied
 *   (each field present only when the shot's camera block carries it)
 */
export function withCapabilities(camera, { scene, shot, frame, takeFrame = frame, subjectPoint = null }) {
	const block = shot?.camera;
	if (!camera || !hasCapabilities(block)) return camera;
	const placementOf = (id) => castPlacementAt(scene, shot, id, takeFrame, subjectPoint);
	let out = camera;
	if (block.mount) {
		const placement = placementOf(block.mount.characterId);
		if (placement) out = { ...out, ...mountedPose(block.mount, placement) };
	}
	const keys = block.rigKeys ?? [], start = Number.isFinite(shot.startFrame) ? shot.startFrame : 0;
	const roll = rigKeyValue(keys, start, frame, (key) => key.rollDeg) ?? block.rollDeg ?? 0;
	if (roll) out = { ...out, rollDeg: roll };
	if (block.shake) out = applyShake(out, shakeOffset(block.shake, frame, scene?.fps ?? 24));
	const distanceTo = (focus) => {
		if (!focus) return null;
		if (!focus.targetId) return focus.distance ?? null;
		const placement = placementOf(focus.targetId);
		return placement ? focusDistanceTo(out, facePoint(placement)) : null;
	};
	const lens = block.lens;
	// An aperture with no focus of its own holds focus on the camera's subject.
	const held = lens?.focusTarget ? { targetId: lens.focusTarget } : lens?.focusDistance ? { distance: lens.focusDistance } : lens?.fStop && scene?.subject?.id ? { targetId: scene.subject.id } : null;
	const focusDistance = rigKeyValue(keys, start, frame, (key) => distanceTo(key.focus)) ?? distanceTo(held);
	return {
		...out,
		...(lens?.fStop ? { fStop: lens.fStop } : {}),
		...(Number.isFinite(focusDistance) ? { focusDistance: Math.round(focusDistance * 1000) / 1000 } : {}),
		...(block.shutterDeg ? { shutterDeg: block.shutterDeg } : {}),
	};
}

/**
 * The poses the shutter sees while it is open: BLUR_SAMPLES cameras spread
 * evenly over shutterDeg / 360 of a frame, centred on the frame (the window
 * the USD export names as shutter:open / shutter:close).
 * @param {(frame:number)=>object|null} cameraAt  the capability camera at any frame
 */
export function shutterSamples(cameraAt, frame, shutterDeg) {
	const open = shutterDeg / 360;
	return Array.from({ length: BLUR_SAMPLES }, (_, i) => {
		const camera = cameraAt(frame + open * (i / (BLUR_SAMPLES - 1) - 0.5));
		return camera && { pos: camera.pos, yaw: camera.yaw, pitch: camera.pitch, rollDeg: camera.rollDeg ?? 0, fovDeg: camera.fovDeg };
	}).filter(Boolean);
}
