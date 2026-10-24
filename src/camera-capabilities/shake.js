// Procedural camera shake: deterministic, seeded, and applied at sample time
// on top of the keyed camera, never baked into keys, so editing the keys keeps
// the shake. The same seed and the same frame give the same offset in the
// viewport, a capture and every export. Each channel is three sines at
// non-harmonic ratios with seeded phases; the weights sum to one, so no
// channel ever exceeds amplitude x its scale (the bound the verify asserts).

const WEIGHTS = [0.6, 0.3, 0.1];
const RATIOS = { handheld: [1, 2.13, 4.37], vehicle: [1, 1.71, 3.29] };
// Per unit amplitude: metres along camera right/up/forward, degrees of yaw, pitch and roll.
export const SHAKE_SCALE = Object.freeze({
	handheld: Object.freeze({ side: 0.025, up: 0.02, forward: 0.012, yawDeg: 1.2, pitchDeg: 1, rollDeg: 0.8 }),
	vehicle: Object.freeze({ side: 0.01, up: 0.03, forward: 0.01, yawDeg: 0.4, pitchDeg: 0.8, rollDeg: 0.6 }),
});
const CHANNELS = ["side", "up", "forward", "yawDeg", "pitchDeg", "rollDeg"];

/** mulberry32: a tiny seeded generator, enough for six channels of phases. */
function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const phaseCache = new Map();
function phases(seed) {
	if (!phaseCache.has(seed)) {
		const next = random(seed * 2654435761);
		phaseCache.set(seed, CHANNELS.map(() => WEIGHTS.map(() => next() * Math.PI * 2)));
		if (phaseCache.size > 64) phaseCache.delete(phaseCache.keys().next().value);
	}
	return phaseCache.get(seed);
}

/**
 * The shake offset at a (possibly fractional) frame: { side, up, forward } in
 * metres and { yawDeg, pitchDeg, rollDeg }; all zero without a shake.
 * @param {{style:string, amplitude:number, frequency:number, seed:number}|null} shake
 */
export function shakeOffset(shake, frame, fps = 24) {
	const zero = { side: 0, up: 0, forward: 0, yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
	if (!shake || !(shake.amplitude > 0)) return zero;
	const style = RATIOS[shake.style] ? shake.style : "handheld", scale = SHAKE_SCALE[style], t = frame / fps, table = phases(shake.seed ?? 1);
	CHANNELS.forEach((channel, c) => {
		let sum = 0;
		for (let i = 0; i < WEIGHTS.length; i++) sum += WEIGHTS[i] * Math.sin(2 * Math.PI * shake.frequency * RATIOS[style][i] * t + table[c][i]);
		zero[channel] = shake.amplitude * scale[channel] * sum;
	});
	return zero;
}

/** Add a shake offset to a sampled camera (pos in world metres, yaw/pitch radians, rollDeg degrees). */
export function applyShake(camera, offset) {
	const right = { x: Math.cos(camera.yaw), z: -Math.sin(camera.yaw) }, ahead = { x: -Math.sin(camera.yaw), z: -Math.cos(camera.yaw) };
	return {
		...camera,
		pos: {
			x: camera.pos.x + right.x * offset.side + ahead.x * offset.forward,
			y: camera.pos.y + offset.up,
			z: camera.pos.z + right.z * offset.side + ahead.z * offset.forward,
		},
		yaw: camera.yaw + (offset.yawDeg * Math.PI) / 180,
		pitch: camera.pitch + (offset.pitchDeg * Math.PI) / 180,
		rollDeg: (camera.rollDeg ?? 0) + offset.rollDeg,
	};
}
