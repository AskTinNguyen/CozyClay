// Where the cast stands at a frame, and the camera a body mount makes of it.
// A mount rides a bone of a character: the bone's height comes from the
// figure's proportions (a share of its stature) and its place and heading from
// the character's placement at that frame (its take root, its walked path or
// its shot override), so the rig follows the body frame by frame and the
// subject holds still in frame while the world moves behind it.
import { placementAt } from "../root-path.js";
import { isProxyFigure } from "../scenes.js";
import { SUBJECT_HEIGHT_M } from "../shot.js";

/** Bone heights as a share of stature, measured on the studio's Mixamo rigs. */
export const BONE_HEIGHT = Object.freeze({ hips: 0.53, chest: 0.72, back: 0.78, head: 0.9 });
const FACE = { height: 0.93, forward: 0.09 };
// A proxy figure is a capsule and a ball: its head sits at 1.58 m of a 1.8 m figure, on the body axis (proxy-figure.jsx).
const PROXY_FACE = { height: 1.58 / 1.8, forward: 0 };

const castRows = (scene) => (Array.isArray(scene?.cast) ? scene.cast : []);

/**
 * A cast member's placement at a frame: { x, z, rot (degrees), height, proxy? }, or
 * null when the scene does not hold that id. The camera subject with a take
 * stands on its sampled root (`subjectPoint`), so slow motion and follow
 * tracks agree with the body the renderer draws.
 */
export function castPlacementAt(scene, shot, id, frame, subjectPoint = null) {
	const entry = castRows(scene).find((row) => row?.id === id) ?? (scene?.subject?.id === id ? scene.subject : null);
	if (!entry) return null;
	const takeRoot = scene.subject?.id === id && subjectPoint && (scene.motion || scene.subjectTrack) ? { x: subjectPoint.x, z: subjectPoint.z } : null;
	const placed = placementAt(entry, frame, { shotAt: () => shot ?? null, takeRoot });
	return { x: placed.x ?? 0, z: placed.z ?? 0, rot: placed.rot ?? 0, height: SUBJECT_HEIGHT_M * (entry.scale ?? 1), ...(isProxyFigure(entry) ? { proxy: true } : {}) };
}

const axes = (rotDeg) => {
	const r = (rotDeg * Math.PI) / 180;
	return { ahead: { x: Math.sin(r), z: Math.cos(r) }, right: { x: -Math.cos(r), z: Math.sin(r) } };
};

/** A cast member's eyes: where a focus puller sets the mark and a mount looks. */
export function facePoint(placement) {
	const { ahead } = axes(placement.rot), face = placement.proxy ? PROXY_FACE : FACE;
	return { x: placement.x + ahead.x * face.forward * placement.height, y: face.height * placement.height, z: placement.z + ahead.z * face.forward * placement.height };
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
	const pos = { x: placement.x + right.x * o.side + ahead.x * o.forward, y: boneY + o.up, z: placement.z + right.z * o.side + ahead.z * o.forward };
	const face = facePoint(placement);
	const target = mount.look === "forward" ? { x: face.x + ahead.x * 6, y: face.y - 0.2, z: face.z + ahead.z * 6 } : face;
	return { pos, ...aim(pos, target) };
}
