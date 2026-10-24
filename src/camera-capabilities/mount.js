// Where the cast stands at a frame, and the camera a body mount makes of it.
// A mount rides a bone of a character: the bone's height comes from the
// figure's proportions (a share of its stature) and its place and heading from
// the character's placement at that frame (its take root, its walked path or
// its shot override), so the rig follows the body frame by frame and the
// subject holds still in frame while the world moves behind it. A baked take
// v3 moves the body through its hips (rig space, under the character's
// placement), so the rig rides the hips: their path, their heading and their
// rise and fall (the walk bob).
import { placementAt } from "../root-path.js";
import { isProxyFigure } from "../scenes.js";
import { SUBJECT_HEIGHT_M } from "../shot.js";

/** Bone heights as a share of stature, measured on the studio's Mixamo rigs. */
export const BONE_HEIGHT = Object.freeze({ hips: 0.53, chest: 0.72, back: 0.78, head: 0.9 });
const FACE = { height: 0.93, forward: 0.09 };
// A proxy figure is a capsule and a ball: its head sits at 1.58 m of a 1.8 m figure, on the body axis (proxy-figure.jsx).
const PROXY_FACE = { height: 1.58 / 1.8, forward: 0 };

const castRows = (scene) => (Array.isArray(scene?.cast) ? scene.cast : []);

const DEG = 180 / Math.PI;

/** A take's per-frame xyz track (v3 `hips`, else `rootPos`) at a fractional frame, or null. */
function trackAt(take, frame) {
	const track = take?.hips ?? take?.rootPos, count = take?.frameCount ?? take?.frames;
	if (!track || !(count > 1) || track.length < count * 3 || !Number.isFinite(frame)) return null;
	const at = Math.max(0, Math.min(count - 1, frame)), lo = Math.floor(at), hi = Math.min(lo + 1, count - 1), k = at - lo;
	const value = (axis) => track[lo * 3 + axis] + (track[hi * 3 + axis] - track[lo * 3 + axis]) * k;
	return { x: value(0), y: value(1), z: value(2), first: { x: track[0], y: track[1], z: track[2] } };
}

/** How far a take's hips have risen (m, + up) at a take frame since its first frame: a v3 take's `hips`, else `rootPos`. 0 without one. */
export function hipsRise(take, frame) {
	const at = trackAt(take, frame), rise = at ? at.y - at.first.y : 0;
	return Number.isFinite(rise) ? rise : 0;
}

/** The hips' heading in rig space (degrees, 0 faces +Z) at one frame of a take v3, as a unit vector. */
function hipsFacing(take, at, frame) {
	const i = (Math.max(0, Math.min(take.frameCount - 1, frame)) * take.bones.length + at) * 4, [x, y, z, w] = [take.rot[i], take.rot[i + 1], take.rot[i + 2], take.rot[i + 3]];
	const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
	return Number.isFinite(yaw) ? { s: Math.sin(yaw), c: Math.cos(yaw) } : { s: 0, c: 1 };
}

// The pelvis twists a few degrees each step while the chest and head hold their line, so the heading a
// mount follows is the hips' heading averaged over about one stride: turns come through, the twist does not.
const STRIDE_HALF_FRAMES = 20;

/** The body's heading in rig space (degrees) at a take frame of a take v3: the hips' heading over one stride, or 0. */
function bodyYaw(take, frame) {
	const at = Math.max(0, take?.bones?.indexOf("Hips") ?? -1), count = take?.frameCount;
	if (!take?.rot || !take.bones?.length || !(count > 0) || !Number.isFinite(frame)) return 0;
	const centre = Math.round(frame);
	let s = 0, c = 0;
	for (let f = centre - STRIDE_HALF_FRAMES; f <= centre + STRIDE_HALF_FRAMES; f++) { const v = hipsFacing(take, at, f); s += v.s; c += v.c; }
	return Math.atan2(s, c) * DEG;
}

/**
 * Where a take v3 carries the body at a take frame, in world space: the hips' stride path and heading under the
 * character's placement (as bakeTake stored them: rig space = un-yawed from the character's place), scaled
 * with the character. Null for a take without a `hips` track (a legacy take rides its `rootPos` root).
 */
function takeBody(entry, take, frame) {
	if (!take?.hips || !trackAt(take, frame)) return null;
	// The pelvis also sways side to side each step; the line the body travels is its mean over a stride
	// (a centred window: no lag at a steady pace). The rise and fall stays per frame (hipsRise).
	let x = 0, z = 0, n = 0;
	for (let f = frame - STRIDE_HALF_FRAMES; f <= frame + STRIDE_HALF_FRAMES; f++) { const at = trackAt(take, f); x += at.x; z += at.z; n += 1; }
	x /= n; z /= n;
	const scale = entry.scale ?? 1, r = ((entry.rot ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
	return { x: (entry.x ?? 0) + (c * x + s * z) * scale, z: (entry.z ?? 0) + (-s * x + c * z) * scale, rot: (entry.rot ?? 0) + bodyYaw(take, frame) };
}

/**
 * A cast member's placement at a frame: { x, z, rot (degrees), height, bob, proxy? }, or
 * null when the scene does not hold that id. Its take is the subject's
 * `scene.motion` or another member's session take. A take v3 places the body
 * where its hips are (path and heading); the camera subject with an older take
 * stands on its sampled root (`subjectPoint`), so slow motion and follow
 * tracks agree with the body the renderer draws. `bob` is the hips' rise,
 * scaled with the character; a proxy figure does not bob.
 */
export function castPlacementAt(scene, shot, id, frame, subjectPoint = null) {
	const entry = castRows(scene).find((row) => row?.id === id) ?? (scene?.subject?.id === id ? scene.subject : null);
	if (!entry) return null;
	const proxy = isProxyFigure(entry), take = scene.subject?.id === id ? scene.motion : entry.sessionMotion, body = proxy ? null : takeBody(entry, take, frame);
	const takeRoot = body ?? (scene.subject?.id === id && subjectPoint && (scene.motion || scene.subjectTrack) ? { x: subjectPoint.x, z: subjectPoint.z } : null);
	const placed = placementAt(entry, frame, { shotAt: () => shot ?? null, takeRoot });
	const bob = proxy ? 0 : Math.round(hipsRise(take, frame) * (entry.scale ?? 1) * 1e6) / 1e6;
	return { x: placed.x ?? 0, z: placed.z ?? 0, rot: placed.rot ?? 0, height: SUBJECT_HEIGHT_M * (entry.scale ?? 1), bob, ...(proxy ? { proxy: true } : {}) };
}

const axes = (rotDeg) => {
	const r = (rotDeg * Math.PI) / 180;
	return { ahead: { x: Math.sin(r), z: Math.cos(r) }, right: { x: -Math.cos(r), z: Math.sin(r) } };
};

/** A cast member's eyes: where a focus puller sets the mark and a mount looks. */
export function facePoint(placement) {
	const { ahead } = axes(placement.rot), face = placement.proxy ? PROXY_FACE : FACE;
	return { x: placement.x + ahead.x * face.forward * placement.height, y: face.height * placement.height + (placement.bob ?? 0), z: placement.z + ahead.z * face.forward * placement.height };
}

function aim(from, to) {
	const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
	return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.max(Math.hypot(dx, dz), 1e-6)) };
}

/**
 * The camera pose a mount gives at one placement: { pos, yaw, pitch }.
 * @param {{bone:string, offset:{side:number,up:number,forward:number}, look:string}} mount
 * @param {{x:number,z:number,rot:number,height:number}} placement
 */
export function mountedPose(mount, placement) {
	const { ahead, right } = axes(placement.rot), o = mount.offset;
	const boneY = (BONE_HEIGHT[mount.bone] ?? BONE_HEIGHT.chest) * placement.height;
	const pos = { x: placement.x + right.x * o.side + ahead.x * o.forward, y: boneY + o.up + (placement.bob ?? 0), z: placement.z + right.z * o.side + ahead.z * o.forward };
	const face = facePoint(placement);
	const target = mount.look === "forward" ? { x: face.x + ahead.x * 6, y: face.y - 0.2, z: face.z + ahead.z * 6 } : face;
	return { pos, ...aim(pos, target) };
}
