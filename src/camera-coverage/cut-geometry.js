// What a cut looks like on each side: the camera a shot shows at a frame
// (its keys, or its rail integrated as the editor's rail follow does), where
// the cast stands then, which character the shot is about, and how big that
// character reads. Pure: commands/camera-coverage.js, the timeline marks and
// the MCP plan all measure cuts the same way.
import { createCameraBlock } from "../camera-block.js";
import { cameraMoveAt } from "../camera-move.js";
import { railTrack } from "../camera-techniques/readback.js";
import { SIZE_SPECS } from "../camera-techniques/framing.js";
import { SIZE_LADDER } from "../camera-techniques/entry.js";
import { placementAt } from "../root-path.js";
import { FRAMING_PIVOT_Y, SUBJECT_HEIGHT_M, focalMmToFov } from "../shot.js";
import { projectPoint } from "./composition.js";

const DEG = Math.PI / 180;

/** A cast member where it stands at a frame of a shot: { id, name, x, z, rot, height }. */
export function castAt(row, shot, frame) {
	const placed = { ...placementAt(row, frame, { shotAt: () => shot ?? null }), ...(shot?.kind !== "still" ? shot?.cast?.[row.id] ?? {} : {}) };
	return { id: row.id, name: (row.subject ?? row.name ?? row.id).split(",")[0], x: placed.x ?? 0, z: placed.z ?? 0, rot: placed.rot ?? 0, height: SUBJECT_HEIGHT_M * (row.scale ?? 1) };
}

/** Where a cast member is heading around a frame (m per frame over +-3 frames), or null when it stands still. `place` defaults to castAt. */
export function travelAt(row, shot, frame, place = castAt) {
	const a = place(row, shot, frame - 3), b = place(row, shot, frame + 3), dx = (b.x - a.x) / 6, dz = (b.z - a.z) / 6;
	return Math.hypot(dx, dz) * 24 > 0.25 ? { x: dx, z: dz } : null;
}

/** The camera a shot shows at a frame: { pos, yaw, pitch, fovDeg }, or null for a follow camera or an empty shot. */
export function shotCameraAt(shot, frame, { cast = [], filmback = {}, fovDeg = 40 } = {}) {
	const block = createCameraBlock(shot.camera), local = Math.max(shot.startFrame, Math.min(shot.endFrame, frame));
	if (block.mode === "rail" && block.cameraRail) {
		const aimId = block.aim?.ids?.[0], aimRow = cast.find((row) => row.id === aimId) ?? cast[0];
		const subject = aimRow ? castAt(aimRow, shot, local) : { x: 0, z: 0 };
		const length = shot.endFrame - shot.startFrame + 1;
		const track = railTrack({ points: block.cameraRail, height: block.craneHeight?.points[0]?.height ?? block.followCam.height, aimHeight: block.aim?.height ?? 1.35, response: block.followCam.response }, subject, length);
		const row = track[Math.max(0, Math.min(track.length - 1, local - shot.startFrame))];
		if (!row) return null;
		const lens = Number.isFinite(block.focalMm) ? (focalMmToFov(block.focalMm, filmback.sensorId, filmback.aspectRatio) * 180) / Math.PI : fovDeg;
		return { pos: { ...row.pos }, yaw: row.yaw, pitch: row.pitch, fovDeg: lens };
	}
	if (block.mode === "follow" || !shot.cameraKeys?.length) return null;
	const anchorRow = cast[0] ? castAt(cast[0], shot, local) : { x: 0, z: 0 };
	return cameraMoveAt(shot.cameraKeys, anchorRow, local, filmback);
}

/** How far off the optical axis a point sits (0 = dead centre), or Infinity when behind the lens or out of frame. */
function offAxis(camera, row, aspectRatio) {
	const ndc = projectPoint(camera, { x: row.x, y: 0.6 * row.height, z: row.z }, aspectRatio);
	return ndc.depth > 0.2 && Math.abs(ndc.x) <= 1.05 && Math.abs(ndc.y) <= 1.6 ? Math.hypot(ndc.x, ndc.y * 0.5) : Infinity;
}

/** The character a shot is about at a frame: the one its coverage names, else the visible one nearest the frame centre. */
export function shotSubject(shot, camera, people, aspectRatio = 16 / 9) {
	const named = people.find((row) => row.id === shot.coverage?.subjectId);
	if (named) return named;
	if (!camera) return null;
	const scored = people.map((row) => ({ row, off: offAxis(camera, row, aspectRatio) })).filter((entry) => Number.isFinite(entry.off)).sort((a, b) => a.off - b.off);
	return scored[0]?.row ?? null;
}

/** The size ladder rung (SIZE_LADDER index, 0 = extreme close-up) a character reads at in a camera. */
export function sizeRung(camera, row) {
	const distance = Math.max(Math.hypot(camera.pos.x - row.x, camera.pos.y - FRAMING_PIVOT_Y * (row.height / SUBJECT_HEIGHT_M), camera.pos.z - row.z), 1e-3);
	const fraction = row.height / (2 * distance * Math.tan((camera.fovDeg * DEG) / 2));
	let best = 0;
	SIZE_LADDER.forEach((size, i) => { if (Math.abs(Math.log(fraction / SIZE_SPECS[size].fraction)) < Math.abs(Math.log(fraction / SIZE_SPECS[SIZE_LADDER[best]].fraction))) best = i; });
	return { rung: best, size: SIZE_LADDER[best], fraction };
}

/** The horizontal angle (degrees, 0-180) between two cameras seen from a character. */
export function angleBetween(a, b, row) {
	const u = { x: a.pos.x - row.x, z: a.pos.z - row.z }, v = { x: b.pos.x - row.x, z: b.pos.z - row.z };
	const cos = (u.x * v.x + u.z * v.z) / ((Math.hypot(u.x, u.z) || 1) * (Math.hypot(v.x, v.z) || 1));
	return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
}

/** Signed distance (m) of a point from the line through `from` along `direction`: + is to the line's left. */
export function lineSide(point, from, direction) {
	const length = Math.hypot(direction.x, direction.z) || 1;
	return (direction.x * (point.z - from.z) - direction.z * (point.x - from.x)) / length;
}
