// A sampled shot camera inside a transition window: the camera of the shot on
// the far side of the cut, and how much of each picture the frame shows. The
// lens renderer (src/lens-render.js via camera-capabilities/lens-plan.js)
// draws the two cameras weighted (a dissolve or whip) or the one camera fading
// to black (a fade). Pure: the shot camera preview and the export frame share it.
import { transitionAt } from "./transitions.js";

const pose = (camera) => ({ pos: { ...camera.pos }, yaw: camera.yaw, pitch: camera.pitch, rollDeg: camera.rollDeg ?? 0, fovDeg: camera.fovDeg });

/**
 * @param {object|null} camera  sampleAt's camera for the shot under `frame`
 * @param {{ shots: Array, frame: number, sampleShot: (shot, frame) => object|null }|null} context
 * @returns the camera, with `transition { type, selfWeight, otherWeight, other? }` inside a window
 */
export function withTransition(camera, context) {
	if (!camera || !context) return camera;
	const window = transitionAt(context.shots, Math.round(context.frame));
	if (!window) return camera;
	const other = window.other ? context.sampleShot(window.other.shot, window.other.frame) : null;
	return { ...camera, transition: { type: window.type, selfWeight: window.selfWeight, otherWeight: other ? window.otherWeight : 0, ...(other ? { other: pose(other) } : {}) } };
}
