// C16. Aim keys: a held-object key (C14) may give aim [x, y, z], the world direction the object's
// +Y points (a bat: knob to barrel), with an optional roll (degrees about that direction,
// right-handed), in place of the quaternion rot. An aim key turns the object the shortest way
// from where the plain carry (no keys) holds it at that key's frame onto aim, then by roll: roll 0
// keeps the hand's own roll there, so the wrist can follow. (Turning from the key before instead
// piles the roll up over a swing: the bat fixture's keys as aims, so chained, missed by 45.5 cm.)
// The quaternion is rounded to 1e-5 (the grid motion.keyObject writes) and kept on the hemisphere
// of the key before it. A rot key is used as given.
import { qmul, qrot, qdot, qnorm, arcQuat, axisQuat } from "./compiler/quat.js";
import { norm } from "./compiler/math.js";

const round5 = v => Math.round(v * 1e5) / 1e5;

/**
 * The rot of each key (keys sorted by f): a rot key's own, an aim key's resolved quaternion
 * [x, y, z, w]. plain(i) is the rotation (a quaternion) the plain carry gives the object at key
 * i's frame; it is asked for aim keys only.
 */
export function keyRots(keys, plain) {
	const rots = [];
	let prev = null;
	for (const [i, k] of keys.entries()) {
		if (k.aim === undefined) { rots.push(k.rot); prev = qnorm(k.rot); continue; }
		const from = qnorm(plain(i)), d = norm(k.aim);
		let q = qmul(arcQuat(norm(qrot(from, [0, 1, 0])), d), from);
		if (k.roll) q = qmul(axisQuat(d, k.roll), q);
		q = q.map(round5);
		if (prev && qdot(q, prev) < 0) q = q.map(v => -v);
		rots.push(q);
		prev = qnorm(q);
	}
	return rots;
}
