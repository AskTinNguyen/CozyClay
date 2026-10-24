// Composition rules for a framing: where the subject's eyes sit in the frame.
// Rule of thirds (left or right third) or centre, the headroom above the eyes
// (tight, normal, loose) and lead room ahead of where the subject faces or
// travels. A framing keeps its camera position and lens; only its aim turns
// so the eyes land on the chosen point. Measured the same way: the eye point
// projected through the stored camera. Pure math over plain rows.
import { SUBJECT_HEIGHT_M, focalMmToFov, fovToFocalMm } from "../shot.js";

export const COMPOSITION_PLACES = Object.freeze(["auto", "left-third", "centre", "right-third"]);
export const HEADROOMS = Object.freeze(["tight", "normal", "loose"]);
export const LEAD_ROOMS = Object.freeze(["none", "facing", "travel", "more"]);

// Eye line height in normalized device coordinates (+1 is the top edge): the
// upper third line is +1/3; tight headroom lifts the eyes, loose lowers them.
const EYE_LINE = { tight: 0.42, normal: 1 / 3, loose: 0.2 };
const PLACE_X = { "left-third": -1 / 3, centre: 0, "right-third": 1 / 3 };
const MORE_LEAD = 0.45;
const DEG = Math.PI / 180;

/** Defaults filled: a placement without a side follows the lead room; lead room alone means facing. */
export function normalizeComposition(value) {
	if (!value || typeof value !== "object") return null;
	const place = COMPOSITION_PLACES.includes(value.place) ? value.place : "auto";
	const headroom = HEADROOMS.includes(value.headroom) ? value.headroom : "normal";
	const leadRoom = LEAD_ROOMS.includes(value.leadRoom) ? value.leadRoom : place === "auto" ? "facing" : "none";
	return { place, headroom, leadRoom };
}

/** The slate words for a composition ("left third · normal headroom · lead room"). */
export function compositionLabel(composition) {
	const c = normalizeComposition(composition);
	if (!c) return "";
	const place = c.place === "auto" ? (c.leadRoom === "none" ? "centre" : "lead room") : c.place.replace("-", " ");
	return [place, `${c.headroom} headroom`, ...(c.place !== "auto" && c.leadRoom !== "none" ? ["lead room"] : []), ...(c.leadRoom === "more" ? ["more lead"] : [])].join(" · ");
}

/** Prompt words for where a composition put the eyes (its NDC target). */
export function compositionWords(target) {
	const side = Math.abs(target.x) < 0.05 ? "centred in frame" : `on the ${target.x < 0 ? "left" : "right"} ${Math.abs(target.x) > 0.4 ? "side" : "third"} of the frame`;
	const eyes = target.y > 0.4 ? "eyes high, tight headroom" : target.y < 0.25 ? "eyes low, loose headroom" : "eyes on the upper third line";
	return `the subject ${side}, ${eyes}${target.ahead && Math.abs(target.x) > 0.05 ? ", lead room ahead of them" : ""}`;
}

/** A subject's eyes: 93 % of its stature, a little ahead of the body axis (from the placement, as every surface reads it, never a posed bone). */
export function eyePoint(row) {
	const height = row.height ?? SUBJECT_HEIGHT_M, r = (row.rot ?? 0) * DEG;
	return { x: row.x + Math.sin(r) * 0.09 * (height / SUBJECT_HEIGHT_M), y: 0.93 * height, z: row.z + Math.cos(r) * 0.09 * (height / SUBJECT_HEIGHT_M) };
}

const vTanOf = (fovDeg) => Math.tan((fovDeg * DEG) / 2);
const basis = (yaw, pitch) => {
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	return { forward: { x: -Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp }, right: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }, up: { x: Math.sin(yaw) * sp, y: cp, z: Math.cos(yaw) * sp } };
};
const dot = (a, b) => a.x * b.x + (a.y ?? 0) * (b.y ?? 0) + a.z * b.z;

/** A stored framing ({ pos, yaw, pitch, fovDeg }) from an exact one ({ position, lookAt, focalMm }). */
export function framingOf(exact, filmback = {}) {
	if (exact.pos) return exact;
	const d = { x: exact.lookAt.x - exact.position.x, y: exact.lookAt.y - exact.position.y, z: exact.lookAt.z - exact.position.z };
	return { pos: { ...exact.position }, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fovDeg: (focalMmToFov(exact.focalMm, filmback.sensorId, filmback.aspectRatio) * 180) / Math.PI };
}

/** A world point through a stored framing: NDC { x, y } (+x right, +y up) and depth (m, > 0 in front). */
export function projectPoint(framing, point, aspectRatio = 16 / 9) {
	const { forward, right, up } = basis(framing.yaw, framing.pitch), d = { x: point.x - framing.pos.x, y: point.y - framing.pos.y, z: point.z - framing.pos.z };
	const depth = dot(d, forward), vTan = vTanOf(framing.fovDeg);
	return { x: dot(d, right) / (depth * vTan * aspectRatio), y: dot(d, up) / (depth * vTan), depth };
}

/** The screen-x direction (-1..1) a horizontal world direction takes in a framing: + is toward frame right. */
export function screenDirection(framing, direction) {
	const length = Math.hypot(direction.x, direction.z) || 1;
	return dot({ x: direction.x / length, y: 0, z: direction.z / length }, basis(framing.yaw, framing.pitch).right);
}

/** NDC target for the eyes: the chosen third or centre, or the third that leaves room ahead of `ahead` (screen-x of the facing or travel). */
function compositionTarget(composition, ahead = 0) {
	const c = normalizeComposition(composition);
	const y = EYE_LINE[c.headroom];
	if (c.place !== "auto") return { x: PLACE_X[c.place], y, ahead: c.leadRoom !== "none" ? ahead : 0 };
	if (c.leadRoom === "none" || Math.abs(ahead) < 0.15) return { x: 0, y, ahead, centred: c.leadRoom !== "none" };
	return { x: -Math.sign(ahead) * (c.leadRoom === "more" ? MORE_LEAD : 1 / 3), y, ahead };
}

/**
 * Turn an exact framing so `eye` lands on NDC `target` (camera position and lens unchanged).
 * Solves pitch from the vertical offset, then yaw from the horizontal one (YXZ, no roll).
 */
export function aimFraming(exact, eye, target, filmback = {}) {
	const fovDeg = (focalMmToFov(exact.focalMm, filmback.sensorId, filmback.aspectRatio) * 180) / Math.PI, vTan = vTanOf(fovDeg);
	const a = target.x * vTan * (filmback.aspectRatio ?? 16 / 9), b = target.y * vTan;
	const d = { x: eye.x - exact.position.x, y: eye.y - exact.position.y, z: eye.z - exact.position.z }, range = Math.hypot(d.x, d.y, d.z) || 1;
	const length = Math.hypot(a, b, 1), s = Math.max(-1, Math.min(1, (length * d.y) / range / Math.hypot(1, b)));
	const pitch = Math.asin(s) - Math.atan(b);
	const zp = b * Math.sin(pitch) - Math.cos(pitch), yaw = Math.atan2(d.x, d.z) - Math.atan2(a, zp);
	const cp = Math.cos(pitch);
	const lookAt = { x: exact.position.x - Math.sin(yaw) * cp * range, y: exact.position.y + Math.sin(pitch) * range, z: exact.position.z - Math.cos(yaw) * cp * range };
	return { position: { ...exact.position }, lookAt, focalMm: exact.focalMm };
}

/** Where the eyes sit in a stored framing, as frame fractions from the top-left corner. */
export function measureComposition(framing, eye, aspectRatio = 16 / 9) {
	const ndc = projectPoint(framing, eye, aspectRatio);
	return { screenX: Math.round(((ndc.x + 1) / 2) * 1000) / 1000, eyeLineY: Math.round(((1 - ndc.y) / 2) * 1000) / 1000, inFront: ndc.depth > 0 };
}

/**
 * Compose every key of a plan on one subject: the side follows the lead room
 * measured in the first key, so a move keeps the subject on one third.
 * @param {Array<{framing:object}>} keys  exact framings
 * @param {object} subject  { x, z, rot, height, eye?, travel? }
 * @returns {{ keys, target, notes }}
 */
export function composeKeys(keys, subject, composition, filmback = {}) {
	const c = normalizeComposition(composition), eye = eyePoint(subject), notes = [];
	const r = (subject.rot ?? 0) * DEG, facing = { x: Math.sin(r), z: Math.cos(r) };
	const direction = c.leadRoom === "travel" && subject.travel && Math.hypot(subject.travel.x, subject.travel.z) > 1e-3 ? subject.travel : facing;
	if (c.leadRoom === "travel" && direction === facing) notes.push("the subject is not travelling here, so the lead room follows its facing");
	const ahead = screenDirection(framingOf(keys[0].framing, filmback), direction), target = compositionTarget(c, ahead);
	if (target.centred) notes.push("the subject faces the lens, so the lead room has no side and the eyes are centred");
	return { keys: keys.map((key) => ({ ...key, framing: aimFraming(key.framing, eye, target, filmback) })), target, notes };
}

/**
 * Compose one stored camera key ({ pos, yaw, pitch, fovDeg }, as shot.frame writes it) on a subject:
 * answers the turned key and where the eyes now sit (shot.frame's composition).
 */
export function composeStoredFraming(framing, subject, composition, filmback = {}) {
	const cp = Math.cos(framing.pitch), lookAt = { x: framing.pos.x - Math.sin(framing.yaw) * cp * 5, y: framing.pos.y + Math.sin(framing.pitch) * 5, z: framing.pos.z - Math.cos(framing.yaw) * cp * 5 };
	const exact = { position: { ...framing.pos }, lookAt, focalMm: fovToFocalMm((framing.fovDeg * Math.PI) / 180, filmback.sensorId, filmback.aspectRatio) };
	const composed = composeKeys([{ framing: exact }], subject, composition, filmback), turned = framingOf(composed.keys[0].framing, filmback);
	const next = { ...framing, yaw: turned.yaw, pitch: turned.pitch };
	return { framing: next, target: composed.target, notes: composed.notes, label: compositionLabel(composition), ...measureComposition(next, eyePoint(subject), filmback.aspectRatio) };
}
