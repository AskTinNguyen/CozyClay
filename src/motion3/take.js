// Take v3: what the compiler bakes and the player reads. Bone rotations are LOCAL quaternions
// on the Mixamo control bones (the first depth-first bone of each name), so playback writes
// them straight onto the rig; the hips also carry a position. Everything is expressed in the
// character's placement frame (its base position and yaw), in metres, so moving or turning
// the character carries the take with it. Scene objects the motion animates ride along in
// world space.
import { toLocal } from "./compiler/skeleton.js";
import { sub, apply, ry, quatFromMat, mul } from "./compiler/math.js";

const TAKE_SCHEMA = "cozyclay.take.v3";

/** out = compileMotion(...) result; placement = { position: [x,y,z], yaw } of the character. */
export function bakeTake(sk, out, placement = { position: [0, 0, 0], yaw: 0 }, meta = {}) {
	const F = out.frames.length, B = sk.names.length;
	const rot = new Float32Array(F * B * 4), hips = new Float32Array(F * 3);
	const unYaw = ry(-(placement.yaw ?? 0));
	for (let f = 0; f < F; f++) {
		const s = out.frames[f].s;
		const local = { P: s.P.map(p => apply(unYaw, sub(p, placement.position))), R: s.R.map(R => mul(unYaw, R)) };
		const { quats, hips: h } = toLocal(sk, local);
		quats.forEach((q, b) => rot.set(q, (f * B + b) * 4));
		hips.set(h, f * 3);
	}
	const objects = {};
	for (const id of Object.keys(out.ctx.spec.objects ?? {})) {
		const pos = new Float32Array(F * 3), quat = new Float32Array(F * 4);
		for (let f = 0; f < F; f++) { const o = out.objectsAt(f)[id]; if (!o) continue; pos.set(o.pos, f * 3); quat.set(quatFromMat(o.R), f * 4); }
		objects[id] = { pos, quat };
	}
	return { schema: TAKE_SCHEMA, fps: out.fps, frameCount: F, rig: sk.model, bones: sk.names.slice(), rot, hips, objects, placement, ...meta };
}

/** Local quaternion [x,y,z,w] of bone b at frame f (nearest frame, clamped). */
export function takeQuat(take, f, b) {
	const ff = Math.max(0, Math.min(take.frameCount - 1, Math.round(f))), i = (ff * take.bones.length + b) * 4;
	return [take.rot[i], take.rot[i + 1], take.rot[i + 2], take.rot[i + 3]];
}

export function takeHips(take, f) {
	const ff = Math.max(0, Math.min(take.frameCount - 1, Math.round(f))) * 3;
	return [take.hips[ff], take.hips[ff + 1], take.hips[ff + 2]];
}
