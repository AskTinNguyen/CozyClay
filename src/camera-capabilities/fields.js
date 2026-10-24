// The six capabilities a shot camera may carry beyond its keys, rail and
// follow: roll, a lens (aperture and focus), handheld shake, a body mount,
// the shot's speed (slow motion) and a shutter (motion blur). Each is an
// optional field on the camera block; absent means the camera of every older
// document, so those load and save byte-identical. Roll and focus also
// animate, on their own rig keys (`camera.rigKeys`), because a framing key
// eases the camera to a stop and a rack focus must not stop a moving camera.
//
// Dependency-free: the camera block, the shot document repair and the agent
// receipts all import it.

export const SHAKE_STYLES = Object.freeze(["handheld", "vehicle"]);
/** Where a body mount rides, as a share of the character's height (mount.js). */
export const MOUNT_BONES = Object.freeze(["chest", "head", "hips", "back"]);
export const MOUNT_LOOKS = Object.freeze(["face", "forward"]);
export const F_STOPS = Object.freeze([1.4, 2, 2.8, 4, 5.6, 8, 11, 16]);
export const SHUTTER_ANGLES = Object.freeze([90, 180, 270, 360]);
const CAPABILITY_FIELDS = Object.freeze(["rollDeg", "lens", "shake", "mount", "speed", "shutterDeg", "rigKeys"]);

export const LIMITS = Object.freeze({
	rollDeg: [-90, 90], fStop: [0.7, 32], focusDistance: [0.05, 1000], amplitude: [0, 1], frequency: [0.1, 12],
	seed: [0, 2147483647], offset: [-2, 2], speed: [0.1, 4], shutterDeg: [0, 360],
});
const RIG_KEY_MAX = 32;

const finite = Number.isFinite;
const clamp = (value, [min, max]) => Math.max(min, Math.min(max, value));
const round = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
const castId = (value) => (typeof value === "string" && /^[\w:.-]{1,80}$/.test(value) ? value : null);
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);

const repairRoll = (value) => (finite(value) && Math.abs(value) > 1e-6 ? round(clamp(value, LIMITS.rollDeg)) : null);

/** Focus is a cast member resolved per frame, or a distance in metres. */
function repairFocus(value) {
	if (!plain(value)) return null;
	if (castId(value.targetId)) return { targetId: value.targetId };
	return finite(value.distance) && value.distance > 0 ? { distance: round(clamp(value.distance, LIMITS.focusDistance)) } : null;
}

/** An aperture turns depth of field on; focus without one is still exported. */
function repairLens(value) {
	if (!plain(value)) return null;
	const fStop = finite(value.fStop) && value.fStop > 0 ? round(clamp(value.fStop, LIMITS.fStop), 2) : null;
	const focus = repairFocus({ targetId: value.focusTarget, distance: value.focusDistance });
	if (!fStop && !focus) return null;
	return { ...(fStop ? { fStop } : {}), ...(focus?.targetId ? { focusTarget: focus.targetId } : focus ? { focusDistance: focus.distance } : {}) };
}

function repairShake(value) {
	if (!plain(value) || !finite(value.amplitude) || value.amplitude <= 0) return null;
	const style = SHAKE_STYLES.includes(value.style) ? value.style : "handheld";
	return {
		style,
		amplitude: round(clamp(value.amplitude, LIMITS.amplitude), 3),
		frequency: round(clamp(finite(value.frequency) ? value.frequency : style === "vehicle" ? 6 : 1.4, LIMITS.frequency), 3),
		seed: Math.round(clamp(finite(value.seed) ? value.seed : 1, LIMITS.seed)),
	};
}

/** offset is metres in the bone's frame: side (+ right), up, forward (+ in front of the body). */
function repairMount(value) {
	if (!plain(value) || !castId(value.characterId)) return null;
	const bone = MOUNT_BONES.includes(value.bone) ? value.bone : "chest";
	const raw = plain(value.offset) ? value.offset : {};
	const fallback = bone === "back" ? { side: 0, up: 0.25, forward: -0.6 } : { side: 0, up: 0.25, forward: 0.6 };
	const offset = Object.fromEntries(["side", "up", "forward"].map((axis) => [axis, round(clamp(finite(raw[axis]) ? raw[axis] : fallback[axis], LIMITS.offset), 3)]));
	return { characterId: value.characterId, bone, offset, look: MOUNT_LOOKS.includes(value.look) ? value.look : bone === "back" ? "forward" : "face" };
}

const repairSpeed = (value) => (finite(value) && value > 0 && Math.abs(value - 1) > 1e-6 ? round(clamp(value, LIMITS.speed), 3) : null);
const repairShutter = (value) => (finite(value) && value > 0 ? round(clamp(value, LIMITS.shutterDeg), 2) : null);

/** Rig keys: { offset (frames from the shot's first frame), rollDeg?, focus?, ease? }, one per offset. */
function repairRigKeys(value) {
	if (!Array.isArray(value)) return null;
	const byOffset = new Map();
	for (const key of value) {
		if (!plain(key) || !finite(key.offset) || key.offset < 0) continue;
		const rollDeg = finite(key.rollDeg) ? round(clamp(key.rollDeg, LIMITS.rollDeg)) : null, focus = repairFocus(key.focus);
		if (rollDeg === null && !focus) continue;
		const offset = Math.round(key.offset);
		byOffset.set(offset, { offset, ...(rollDeg !== null ? { rollDeg } : {}), ...(focus ? { focus } : {}), ...(["linear", "in", "out"].includes(key.ease) ? { ease: key.ease } : {}) });
	}
	const keys = [...byOffset.values()].sort((a, b) => a.offset - b.offset).slice(0, RIG_KEY_MAX);
	return keys.length ? keys : null;
}

const REPAIRS = { rollDeg: repairRoll, lens: repairLens, shake: repairShake, mount: repairMount, speed: repairSpeed, shutterDeg: repairShutter, rigKeys: repairRigKeys };

/** The capability fields a stored or patched camera value carries, repaired; none when it carries none. */
export function cameraCapabilities(value) {
	if (!plain(value)) return {};
	const out = {};
	for (const field of CAPABILITY_FIELDS) {
		const repaired = REPAIRS[field](value[field]);
		if (repaired !== null) out[field] = repaired;
	}
	return out;
}

/** True when the camera carries any capability (the renderers' fast path). */
export const hasCapabilities = (camera) => plain(camera) && CAPABILITY_FIELDS.some((field) => camera[field] !== undefined && camera[field] !== null);
