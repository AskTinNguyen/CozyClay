// What the lens renderer (src/lens-render.js) draws for one sampled camera:
// a set of sub-cameras whose average is the frame. Depth of field spreads
// them over the aperture disc, each one sheared so the focal plane stays put
// (an accumulation-buffer lens); motion blur spreads them over the poses the
// open shutter sees (sampleAt's camera.blur), as many as the sweep needs, each
// smeared over its own step so the copies join into one streak. Pure, so node
// tests read it.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEG = 180 / Math.PI;
/** Blur sub-renders aim at one per this share of the frame swept (the smear fills each step). */
const BLUR_STEP_SHARE = 1 / 120;
const TRAVEL_REFERENCE_M = 3;

/**
 * A sub-render's smear as a texture-space step (u right, v up) on a frame of hFovDeg x vFovDeg: turning
 * left (yaw up) carries the scene toward the right, tilting up (pitch up) carries it down. Small-angle,
 * which is what one slice of a shutter is.
 */
export function smearUv(smear, hFovDeg, vFovDeg) {
	return smear ? { u: smear.yawDeg / Math.max(1e-3, hFovDeg), v: -smear.pitchDeg / Math.max(1e-3, vFovDeg) } : { u: 0, v: 0 };
}

const wrap = (radians) => (radians > Math.PI ? radians - Math.PI * 2 : radians < -Math.PI ? radians + Math.PI * 2 : radians);

/** How much of the frame the open shutter sweeps: pan, tilt and roll over the field of view, zoom, and travel as an angle. */
export function blurSweep(poses, focusDistance = null) {
	let share = 0;
	for (let i = 1; i < poses.length; i++) {
		const a = poses[i - 1], b = poses[i], fov = Math.max(1, Math.min(a.fovDeg, b.fovDeg));
		const turn = Math.hypot(wrap(b.yaw - a.yaw) * DEG, (b.pitch - a.pitch) * DEG, ((b.rollDeg ?? 0) - (a.rollDeg ?? 0)) * 0.5);
		const travel = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z) / (focusDistance || TRAVEL_REFERENCE_M) * DEG;
		share += (turn + travel) / fov + Math.abs(b.fovDeg - a.fovDeg) / (2 * fov);
	}
	return share;
}

/**
 * @param {object} camera  sampleAt's camera: fStop, focusDistance, focalMm, blur
 * @param {{samples?:number, maxSamples?:number}} [options]  samples: the base count; a blur raises it
 *   with the sweep up to maxSamples (default: samples)
 * @returns null when the frame is a plain render (no aperture, no shutter, no transition),
 *   else { apertureRadiusM, focusDistance, sweep, samples: [{ pose, dx, dy, weight, smear? }] }:
 *   pose is the camera to draw (a blur pose or the camera itself), dx, dy
 *   are metres along its right and up axes on the aperture disc, and weight
 *   its share of the frame. A blur sample's smear { yawDeg, pitchDeg } is the
 *   turn from its pose to the next one: the renderer spreads it over that much
 *   of the screen. Inside a transition (camera-coverage) the camera's
 *   own samples share selfWeight and the far shot's camera takes otherWeight;
 *   a fade leaves the rest black.
 */
export function lensPlan(camera, { samples = 16, maxSamples = samples } = {}) {
	if (!camera?.pos) return null;
	const dof = camera.fStop > 0 && camera.focusDistance > 0 && camera.focalMm > 0;
	const blur = Array.isArray(camera.blur) && camera.blur.length > 1 ? camera.blur : null;
	const transition = camera.transition && camera.transition.selfWeight < 1 ? camera.transition : null;
	if (!dof && !blur && !transition) return null;
	const sweep = blur ? blurSweep(blur, dof ? camera.focusDistance : null) : 0;
	const base = Math.max(2, Math.round(samples)), wanted = Math.ceil(sweep / BLUR_STEP_SHARE);
	const count = dof || blur ? Math.max(base, Math.min(Math.max(base, Math.round(maxSamples)), wanted)) : 1, self = transition ? transition.selfWeight : 1;
	const apertureRadiusM = dof ? camera.focalMm / camera.fStop / 2 / 1000 : 0;
	const own = { pos: camera.pos, yaw: camera.yaw, pitch: camera.pitch, rollDeg: camera.rollDeg ?? 0, fovDeg: camera.fovDeg };
	return {
		apertureRadiusM,
		focusDistance: dof ? camera.focusDistance : null,
		sweep,
		samples: [...Array.from({ length: count }, (_, i) => {
			const r = apertureRadiusM * Math.sqrt((i + 0.5) / count), angle = i * GOLDEN_ANGLE;
			const row = { pose: blur ? poseAt(blur, (i + 0.5) / count) : own, dx: r * Math.cos(angle), dy: r * Math.sin(angle), weight: self / count };
			if (blur) {
				// The turn across this sub-render's slice of the shutter, centred on its pose: the slices tile the sweep.
				const a = poseAt(blur, Math.max(0, i / count)), b = poseAt(blur, Math.min(1, (i + 1) / count));
				row.smear = { yawDeg: wrap(b.yaw - a.yaw) * DEG, pitchDeg: (b.pitch - a.pitch) * DEG };
			}
			return row;
		}), ...(transition?.other && transition.otherWeight > 0 ? [{ pose: transition.other, dx: 0, dy: 0, weight: transition.otherWeight }] : [])],
	};
}

const lerp = (a, b, t) => a + (b - a) * t;

/** The shutter pose at t in [0, 1], between the two nearest blur samples. */
function poseAt(poses, t) {
	const at = t * (poses.length - 1), i = Math.min(poses.length - 2, Math.floor(at)), k = at - i, a = poses[i], b = poses[i + 1];
	let dYaw = b.yaw - a.yaw;
	if (dYaw > Math.PI) dYaw -= Math.PI * 2;
	if (dYaw < -Math.PI) dYaw += Math.PI * 2;
	return {
		pos: { x: lerp(a.pos.x, b.pos.x, k), y: lerp(a.pos.y, b.pos.y, k), z: lerp(a.pos.z, b.pos.z, k) },
		yaw: a.yaw + dYaw * k, pitch: lerp(a.pitch, b.pitch, k), rollDeg: lerp(a.rollDeg ?? 0, b.rollDeg ?? 0, k), fovDeg: lerp(a.fovDeg, b.fovDeg, k),
	};
}
