// C3. Where a scene object or a group is at a frame: the one place refs, probes, goals, the
// timeline and QA read object poses from. See docs/motion-api-v3.1.md (C3, 7.1, 7.2).
//
// The group (an Empty) is the unit. spec.objects[id] may name a body or a group:
//   hinge  { pivot, axis, channel }                        turns the record (a group: the whole group
//                                                          about the group root) by a keyed angle
//   carry  { prop, grab?, release?, at?, along?, visible? } the record rides prop `prop`'s hand
// A carried or hinged group gets ONE track, on the group root (take.objects[groupId]); its parts
// follow through the parent carry that already exists in src/object-travel.js (ancestorsOf /
// ownTravelMatrix). There are no per-part tracks. While the group is in hand (grab..release) its
// track is in world space and the carry from the group's own parent (a table) is cut, so nothing
// is carried twice.
//   f < grab              the scene pose
//   grab <= f <= release  follows the prop's hand; without at/along it keeps the transform it had
//                         against the palm axes at grab (no jump); at/along (bodies only) pin an offset
//   f > release           frozen at the release pose
//   no grab: in hand from frame 0; no release: in hand to the end (PR #14 behaviour)
// Carried objects are OBSTACLES at every frame, at their pose that frame: body vs object and
// object vs other scene objects are checked (kind COLLIDE, subject "<object> x <other>", the
// same QA_LIMITS depths), except the holding hand's fingers, hand and forearm; contact with the
// support it stood on at grab (the object right below it) is allowed for +-3 frames around grab
// and around release. Anything else is excused with checks.allow.
// Lane C implements grab/release, the group-root pose and the obstacle rule; W0 answers the
// scene pose, hinges (out.ctx.objectsAt) and the always-carried body (PR #14).
import { isCarried, carriedPose } from "./carried.js";

/**
 * Body ids that make up `id` in a motionScene: [id] for a body (plus any bodies parented under
 * it), every body under it for a group, [] when the scene knows no such id.
 * @returns {string[]}
 */
export function partsOf(scene, id) {
	const objects = scene?.objects ?? {};
	return Object.keys(objects).filter(k => k === id || objects[k].ancestors?.includes(id));
}

/**
 * True while spec.objects entry `o` holds its record in a hand at absolute frame f
 * (grab <= f <= release; a missing grab is 0, a missing release the last frame).
 */
export function inHandAt(o, f) {
	return isCarried(o) && f >= (o.grab ?? 0) && (o.release === undefined || f <= o.release);
}

/**
 * The boxes of `id` at absolute frame f of a compile result `out` (out.ctx.scene, out.ctx.spec):
 * [{ id: partId, pos, R, half }] for a body ([its own box]) or a group (every part box, moved by
 * the group root's pose at f). null when f is outside the compiled window (out.f0 ..
 * out.f0 + out.frames.length - 1) or the scene has no such id.
 * @returns {{ id: string, pos: number[], R: number[][], half: number[] }[] | null}
 */
export function objectBoxesAt(out, id, f) {
	const fr = out.frames?.[f - (out.f0 ?? 0)], scene = out.ctx.scene, parts = partsOf(scene, id);
	if (!fr || !parts.length) return null;
	const spec = out.ctx.spec, at = out.ctx.objectsAt(f);
	return parts.map(p => {
		const own = spec.objects?.[p], box = at[p] ?? scene.objects[p];
		const pose = inHandAt(own, f) ? carriedPose(out.ctx.sk, spec, fr.s, own) : box;
		return { id: p, pos: pose.pos, R: pose.R, half: box.half };
	});
}
