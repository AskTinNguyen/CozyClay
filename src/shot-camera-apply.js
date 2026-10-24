// One way to put a sampled camera (sampleAt's camera) on the shot camera
// object: position, the look ref (yaw, pitch and roll, which ShotLookApplier
// re-applies every frame), the lens, and the lens state the lens renderer
// reads (src/lens-render.js). The timeline rigs, follow and rail rigs and the
// export recorder all go through it, so a roll, a mount, a shake, a focus or a
// shutter shows in the viewport, the preview and every capture alike.

const DEG = Math.PI / 180;

/** The roll in radians a sampled camera or framing carries (0 when level). */
const rollOf = (sample) => (Number.isFinite(sample?.rollDeg) ? sample.rollDeg * DEG : 0);

/**
 * @param {import("three").PerspectiveCamera} cam  the shot camera
 * @param {{current:{yaw:number,pitch:number,roll?:number}}} look
 * @param {object} sample  { pos, yaw, pitch, fovDeg, rollDeg?, fStop?, focusDistance?, focalMm?, blur?, transition? }
 */
export function applyShotCamera(cam, look, sample) {
	const roll = rollOf(sample);
	cam.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
	look.current.yaw = sample.yaw;
	look.current.pitch = sample.pitch;
	look.current.roll = roll;
	cam.rotation.order = "YXZ";
	cam.rotation.set(sample.pitch, sample.yaw, roll);
	if (Number.isFinite(sample.fovDeg) && Math.abs(cam.fov - sample.fovDeg) > 1e-6) cam.fov = sample.fovDeg;
	cam.updateProjectionMatrix();
	if (sample.fStop || sample.blur || sample.transition) {
		cam.userData.lens = { pos: { ...sample.pos }, focalMm: sample.focalMm, fStop: sample.fStop ?? null, focusDistance: sample.focusDistance ?? null, blur: sample.blur ?? null, transition: sample.transition ?? null };
	} else delete cam.userData.lens;
}

// A dissolve or fade around a cut rides the sample too (camera-coverage/transition-sample.js).
export { withShotTransition, withTransition } from "./camera-coverage/transition-sample.js";
