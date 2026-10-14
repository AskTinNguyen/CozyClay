// C3. Where a scene object or a group is at a frame: the one place refs, probes, goals, the
// timeline, the take and QA read object poses from. See docs/motion-api-v3.1.md (C3, 7.1, 7.2).
//
// The group (an Empty) is the unit. spec.objects[id] may name a body or a group:
//   hinge  { pivot, axis, channel }                        turns the record (a group: the whole group
//                                                          about the group root) by a keyed angle
//   carry  { prop, grab?, release?, at?, along?, visible? } the record rides prop `prop`'s hand
// A carried or hinged group gets ONE track, on the group root (take.objects[groupId]); its parts
// follow through the parent carry that already exists in src/object-travel.js (ancestorsOf /
// ownTravelMatrix). There are no per-part tracks. While the group is in hand (grab..release) its
// track is in world space and the carry from the group's own parent (a table) is cut, so nothing
// is carried twice (the take's `hold` flags, object-travel.js).
//   f < grab              the scene pose
//   grab <= f <= release  follows the prop's hand; without at/along it keeps the transform it had
//                         against the palm axes at grab (no jump); at/along (bodies only) pin an offset
//   f > release           frozen at the release pose
//   no grab: in hand from frame 0; no release: in hand to the end (PR #14 behaviour)
// Carried objects are OBSTACLES at every frame, at their pose that frame (qa/object-checks.js).
import { isCarried, carriedPose, compose, relative } from "./carried.js";
import { groupsOf } from "./scene.js";
import { solveFrame } from "./compiler/compile.js";
import { channelsAt } from "./compiler/channels.js";

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

/** The scene pose { pos, R } of a body or a group root, or null. */
function restPose(scene, id) {
	return scene?.objects?.[id] ?? groupsOf(scene)[id] ?? null;
}

/** The spec.objects key that moves body `part`: itself or its nearest group with an entry, or null. */
function moverOf(spec, scene, part) {
	return [part, ...(scene?.objects?.[part]?.ancestors ?? [])].find(id => spec.objects?.[id]) ?? null;
}

/** [grab, release] of a carried entry in absolute frames of `out` (after a retime). */
export function spanOf(out, o) {
	const map = f => (out.timeMap ? Math.round(out.timeMap(f)) : f);
	return [map(o.grab ?? 0), o.release === undefined ? out.frameCount - 1 : map(o.release)];
}

/** Without at/along a grabbed body, and always a group, keeps its grab-frame palm offset. */
const keepsOffset = (scene, id, o) => (!scene?.objects?.[id] && !!groupsOf(scene)[id]) || (o.grab !== undefined && o.at === undefined && o.along === undefined);

const solved = new WeakMap(), poses = new WeakMap();

/** The solved frame at absolute f: out.frames, or solved once on demand outside a window. */
function frameAt(out, f) {
	const own = out.frames[f - (out.f0 ?? 0)];
	if (own) return own;
	if (!solved.has(out)) solved.set(out, new Map());
	const cache = solved.get(out);
	if (!cache.has(f)) cache.set(f, solveFrame(out.ctx, channelsAt(out.baked, f), f));
	return cache.get(f);
}

/** Pose of the record a carried entry moves, cached on the solved frame. */
function carriedAt(out, id, o, f) {
	const fr = frameAt(out, f), { sk, spec, scene } = out.ctx;
	if (!poses.has(fr)) poses.set(fr, new Map());
	const cache = poses.get(fr);
	if (cache.has(id)) return cache.get(id);
	let pose;
	if (!keepsOffset(scene, id, o)) pose = carriedPose(sk, spec, fr.s, o);
	else {
		const palm = s => carriedPose(sk, spec, s, { prop: o.prop });
		const grab = spanOf(out, o)[0], offset = relative(palm(frameAt(out, grab).s), restPose(scene, id));
		pose = compose(palm(fr.s), offset);
	}
	cache.set(id, pose);
	return pose;
}

/**
 * World pose { pos, R } of the record spec.objects[id] moves (a body or a group root) at
 * absolute frame f: carried, hinged (out.ctx.objectsAt for a body; the group root turned by
 * the same hinge) or still. null for an id the scene does not know.
 */
export function rootPoseAt(out, id, f) {
	const { spec, scene } = out.ctx, o = spec.objects?.[id], rest = restPose(scene, id);
	if (isCarried(o) && (rest || !keepsOffset(scene, id, o))) {
		const [grab, release] = spanOf(out, o);
		return f < grab && rest ? { pos: rest.pos, R: rest.R } : carriedAt(out, id, o, Math.max(grab, Math.min(f, release)));
	}
	if (!rest) return null;
	if (o && scene.objects[id]) return out.ctx.objectsAt(f)[id];
	if (o) { const part = partsOf(scene, id)[0], box = out.ctx.objectsAt(f)[part]; return compose(box, relative(scene.objects[part], rest)); }
	return { pos: rest.pos, R: rest.R };
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
		const box = scene.objects[p], mover = moverOf(spec, scene, p);
		const pose = isCarried(spec.objects?.[mover]) ? compose(rootPoseAt(out, mover, f), relative(restPose(scene, mover), box)) : at[p] ?? box;
		return { id: p, pos: pose.pos, R: pose.R, half: box.half };
	});
}
