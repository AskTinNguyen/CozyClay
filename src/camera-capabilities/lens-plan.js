// What the lens renderer (src/lens-render.js) draws for one sampled camera:
// a set of sub-cameras whose average is the frame. Depth of field spreads
// them over the aperture disc, each one sheared so the focal plane stays put
// (an accumulation-buffer lens); motion blur spreads them over the poses the
// open shutter sees (sampleAt's camera.blur). Pure, so node tests read it.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * @param {object} camera  sampleAt's camera: fStop, focusDistance, focalMm, blur
 * @param {{samples?:number}} [options]
 * @returns null when the frame is a plain render (no aperture, no shutter, no transition),
 *   else { apertureRadiusM, focusDistance, samples: [{ pose, dx, dy, weight }] }:
 *   pose is the camera to draw (a blur pose or the camera itself), dx, dy
 *   are metres along its right and up axes on the aperture disc, and weight
 *   its share of the frame. Inside a transition (camera-coverage) the camera's
 *   own samples share selfWeight and the far shot's camera takes otherWeight;
 *   a fade leaves the rest black.
 */
export function lensPlan(camera, { samples = 16 } = {}) {
	if (!camera?.pos) return null;
	const dof = camera.fStop > 0 && camera.focusDistance > 0 && camera.focalMm > 0;
	const blur = Array.isArray(camera.blur) && camera.blur.length > 1 ? camera.blur : null;
	const transition = camera.transition && camera.transition.selfWeight < 1 ? camera.transition : null;
	if (!dof && !blur && !transition) return null;
	const count = dof || blur ? Math.max(2, Math.round(samples)) : 1, self = transition ? transition.selfWeight : 1;
	const apertureRadiusM = dof ? camera.focalMm / camera.fStop / 2 / 1000 : 0;
	const own = { pos: camera.pos, yaw: camera.yaw, pitch: camera.pitch, rollDeg: camera.rollDeg ?? 0, fovDeg: camera.fovDeg };
	return {
		apertureRadiusM,
		focusDistance: dof ? camera.focusDistance : null,
		samples: [...Array.from({ length: count }, (_, i) => {
			const r = apertureRadiusM * Math.sqrt((i + 0.5) / count), angle = i * GOLDEN_ANGLE;
			return { pose: blur ? poseAt(blur, (i + 0.5) / count) : own, dx: r * Math.cos(angle), dy: r * Math.sin(angle), weight: self / count };
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
