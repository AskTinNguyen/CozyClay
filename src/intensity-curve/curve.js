// The intensity curve (intensity-curve A1): per shot of a sequence, each
// camera component the cut rules and the brief already measure (size step,
// camera height against the subject's eyes, focal length, camera speed from
// measureShotCamera, shot length as cutting rate, roll, and the subject's
// screen-position jump at the cut), normalised and weighted by the D1 data
// module (weights.js), plus each cut's contrast: the jump in every component
// across it. Fixed rounding, no clock: the same document gives the same
// bytes. Pure: no DOM, no three.js.
import { castAt, shotSubject, sizeRung } from "../camera-coverage/cut-geometry.js";
import { eyePoint, measureComposition } from "../camera-coverage/composition.js";
import { engineScene, measureShotCamera } from "../shot-prompt-engine/measure.js";
import { SUBJECT_HEIGHT_M } from "../shot.js";
import { combine, CUT_JUMP, INTENSITY_COMPONENTS, INTENSITY_COMPONENT_IDS, INTENSITY_VERSION } from "./weights.js";

const DEG = 180 / Math.PI;
const r3 = (value) => Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;
const BY_ID = Object.fromEntries(INTENSITY_COMPONENTS.map((row) => [row.id, row]));

/** The shots a range picks, in time order: { from, to } (1-based, inclusive), { shotIds }, or all (as the sequence brief picks them). */
function intensityShots(document, range = null) {
	const sorted = [...(document.shots ?? [])].filter((shot) => Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrame)).sort((a, b) => a.startFrame - b.startFrame);
	if (Array.isArray(range?.shotIds) && range.shotIds.length) return sorted.filter((shot) => range.shotIds.includes(shot.id));
	return sorted.slice(Math.max(1, range?.from ?? 1) - 1, Math.min(sorted.length, range?.to ?? sorted.length));
}

/** One camera end of a shot read against its subject: size rung, elevation above the eyes, focal, roll, where the eyes sit across the frame. */
function endRead(camera, subject, aspect) {
	const eye = eyePoint(subject), horizontal = Math.hypot(camera.pos.x - eye.x, camera.pos.z - eye.z) || 1e-3;
	const placed = measureComposition(camera, eye, aspect);
	return { rung: sizeRung(camera, subject).rung, elevationDeg: Math.atan2(camera.pos.y - eye.y, horizontal) * DEG, focalMm: camera.focalMm ?? 35, rollDeg: camera.rollDeg ?? 0, screenX: placed.inFront ? placed.screenX : null };
}

/** The raw measures of one shot: both ends, the camera's rates while it moves, and its length. */
function shotRaw(document, shot, scene, place) {
	const fps = document.fps ?? 24, aspect = document.filmback?.aspectRatio ?? 16 / 9, m = measureShotCamera(document, shot, scene);
	const seconds = (shot.endFrame - shot.startFrame + 1) / fps;
	if (m.unmeasured || !m.start?.pos || !m.end?.pos) return { unmeasured: true, seconds, subjectId: null, ends: null };
	const people = (frame) => scene.cast.map((row) => ({ ...place(row, shot, frame), height: place(row, shot, frame).height ?? SUBJECT_HEIGHT_M }));
	const first = people(shot.startFrame), last = people(shot.endFrame);
	const subject = shotSubject(shot, m.start, first, aspect) ?? first[0] ?? { id: null, x: 0, z: 0, rot: 0, height: SUBJECT_HEIGHT_M };
	const atEnd = last.find((row) => row.id === subject.id) ?? subject;
	const zoomMmps = m.moveSeconds > 0 ? Math.abs(m.focalMm[1] - m.focalMm[0]) / m.moveSeconds : 0;
	return { unmeasured: false, seconds, subjectId: subject.id, ends: [endRead(m.start, subject, aspect), endRead(m.end, atEnd, aspect)],
		speedMps: m.speedMps ?? 0, panDps: m.panDps ?? 0, tiltDps: m.tiltDps ?? 0, zoomMmps };
}

/** A component's 0-1 value at one end of a shot (size, height, focal, roll). */
const endValue = (id, end) => BY_ID[id].value(end);

/** The components of one shot: the end components as the mean of its two ends, the rates and length once, and the screen jump into it. */
function shotComponents(raw, screenJump) {
	const out = {};
	for (const id of INTENSITY_COMPONENT_IDS) {
		if (CUT_JUMP[id] === "ends") out[id] = raw.ends ? (endValue(id, raw.ends[0]) + endValue(id, raw.ends[1])) / 2 : 0;
		else if (id === "screen") out[id] = BY_ID.screen.value({ screenJump });
		else out[id] = raw.ends || id === "cutting" ? BY_ID[id].value(raw) : 0;
	}
	return out;
}

const rounded = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, r3(value)]));

/**
 * @param {object} document  a sequence document (shot-prompt-engine/document.js)
 * @param {{ range?: object, placeAt?: Function }} [options]  range as the brief takes it; placeAt(row, shot, frame) places the cast (default castAt)
 * @returns {{ version, components: string[], weights: object, shots: Array<{ index, shotId, shotName, startFrame, endFrame, subjectId, unmeasured?, components, combined, raw }>,
 *   cuts: Array<{ cutFrame, from, to, contrast, total }>, peak: { index, shotId, combined } | null }}
 */
export function sequenceIntensity(document, { range = null, placeAt = castAt } = {}) {
	const scene = engineScene(document), shots = intensityShots(document, range);
	const raws = shots.map((shot) => shotRaw(document, shot, scene, placeAt));
	const jumps = raws.map((raw, i) => {
		const before = raws[i - 1]?.ends?.[1], after = raw.ends?.[0];
		return before && after && before.screenX !== null && after.screenX !== null ? Math.abs(after.screenX - before.screenX) : 0;
	});
	const rows = shots.map((shot, i) => {
		const raw = raws[i], components = rounded(shotComponents(raw, jumps[i]));
		const stated = raw.ends ? { rung: raw.ends.map((end) => end.rung), elevationDeg: raw.ends.map((end) => r3(end.elevationDeg)), focalMm: raw.ends.map((end) => r3(end.focalMm)),
			rollDeg: raw.ends.map((end) => r3(end.rollDeg)), screenX: raw.ends.map((end) => end.screenX), speedMps: r3(raw.speedMps), panDps: r3(raw.panDps), tiltDps: r3(raw.tiltDps), zoomMmps: r3(raw.zoomMmps) } : {};
		return { index: i + 1, shotId: shot.id, shotName: shot.name ?? shot.id, startFrame: shot.startFrame, endFrame: shot.endFrame, subjectId: raw.subjectId,
			...(raw.unmeasured ? { unmeasured: true } : {}), components, combined: r3(combine(components)), raw: { seconds: r3(raw.seconds), screenJump: r3(jumps[i]), ...stated } };
	});
	const cuts = rows.slice(1).map((row, k) => {
		const a = rows[k], ra = raws[k], rb = raws[k + 1], contrast = {};
		for (const id of INTENSITY_COMPONENT_IDS) {
			const kind = CUT_JUMP[id];
			contrast[id] = r3(kind === "ends" ? (ra.ends && rb.ends ? Math.abs(endValue(id, rb.ends[0]) - endValue(id, ra.ends[1])) : 0) : kind === "incoming" ? row.components[id] : Math.abs(row.components[id] - a.components[id]));
		}
		const total = INTENSITY_COMPONENTS.reduce((sum, c) => sum + c.weight * contrast[c.id], 0);
		return { cutFrame: row.startFrame, from: a.shotId, to: row.shotId, index: row.index, contrast, total: r3(total) };
	});
	const peak = rows.reduce((best, row) => (!best || row.combined > best.combined ? row : best), null);
	return { version: INTENSITY_VERSION, components: [...INTENSITY_COMPONENT_IDS], weights: Object.fromEntries(INTENSITY_COMPONENTS.map((row) => [row.id, row.weight])),
		shots: rows, cuts, peak: peak ? { index: peak.index, shotId: peak.shotId, combined: peak.combined } : null };
}
