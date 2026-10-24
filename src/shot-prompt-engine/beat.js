// One shot of a sequence as a beat: what the camera does in the words the move
// classifier proved (the stored technique's phrase, else the keys or rail read
// back), measured (measure.js), the size, angle and lens at both ends, the
// composition the subject reads at, the coverage role, the transition in and
// the capabilities (roll, focus, shake, mount, speed, shutter). Pure.
import { classifyMove, moveSequencePhrase } from "../camera-move.js";
import { classifyKeys } from "../camera-techniques/readback.js";
import { currentTechnique } from "../camera-techniques/storage.js";
import { castAt, shotSubject } from "../camera-coverage/cut-geometry.js";
import { eyePoint, measureComposition } from "../camera-coverage/composition.js";
import { coveragePattern } from "../camera-coverage/patterns.js";
import { transitionOutWords, transitionWords } from "../camera-coverage/transitions.js";
import { capabilityWords } from "../camera-capabilities/words.js";
import { deriveShot, SUBJECT_HEIGHT_M } from "../shot.js";
import { lensWordFromFocalMm } from "../shot-prompt.js";
import { measureShotCamera, measuredWords } from "./measure.js";

const DEG = 180 / Math.PI;
const r = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
export const castName = (row) => String(row?.subject ?? row?.name ?? row?.id ?? "").split(",")[0].trim();

/** The classifier's move for a shot: { id, phrase } from its keys (each segment chained) or its sampled ends. */
function shotMove(shot, subject, measure, { fps = 24, filmback = {} } = {}) {
	const opts = { fps, height: subject.height, filmback };
	if (shot.camera?.mode !== "rail" && shot.cameraKeys?.length > 1) {
		const read = classifyKeys(shot.cameraKeys, subject, opts), moving = read.segments.filter((segment) => segment.id !== "static");
		return { id: read.id, phrase: moving.length > 1 && read.degrees === undefined ? moveSequencePhrase(moving) : read.phrase };
	}
	if (!measure.start || !measure.end) return { id: "static", phrase: "static, locked-off shot" };
	const move = classifyMove(measure.start, measure.end, subject, { durationS: Math.max(measure.seconds, 0.1), height: subject.height, sensorId: filmback.sensorId, aspectRatio: filmback.aspectRatio });
	return { id: move.id, phrase: move.phrase };
}

function angleWords(camera, view) {
	const down = -camera.pitch * DEG;
	const tilt = Math.abs(down) < 2 ? "level" : down > 0 ? `looking down ${r(down)}°` : `looking up ${r(-down)}°`;
	const height = view.elevationDeg > 25 ? "high angle" : view.elevationDeg < -10 ? "low angle" : "eye level";
	return `${height}, camera ${r(camera.pos.y, 2)} m high, ${tilt}, ${view.viewPhrase}`;
}

function compositionPhrase(name, placed) {
	if (!placed.inFront) return `${name} out of frame`;
	const x = placed.screenX, side = x < 0.42 ? (x < 0.2 ? "on the left edge" : "on the left third") : x > 0.58 ? (x > 0.8 ? "on the right edge" : "on the right third") : "centred";
	const eyes = placed.eyeLineY < 0.27 ? "eyes high, tight headroom" : placed.eyeLineY > 0.42 ? "eyes low, loose headroom" : "eyes on the upper third line";
	return `${name} ${side} (${r(x, 2)} across), ${eyes} (${r(placed.eyeLineY, 2)} down)`;
}

/**
 * @param {object} document  the sequence document (sequence.js)
 * @param {object} shot      one of document.shots
 * @param {object} context   { scene (measure.js engineScene), index (1-based), first (boolean) }
 */
export function describeBeat(document, shot, { scene, index, first }) {
	const fps = document.fps ?? 24, filmback = document.filmback ?? {}, aspectRatio = filmback.aspectRatio ?? 16 / 9;
	const measure = measureShotCamera(document, shot, scene);
	const people = scene.cast.map((row) => castAt(row, shot, shot.startFrame));
	const subjectRow = shotSubject(shot, measure.start, people, aspectRatio) ?? people[0] ?? { id: null, name: "the subject", x: 0, z: 0, rot: 0, height: SUBJECT_HEIGHT_M };
	const subject = { ...subjectRow, height: subjectRow.height ?? SUBJECT_HEIGHT_M };
	const technique = currentTechnique(shot), move = shotMove(shot, subject, measure, { fps, filmback });
	const ends = [measure.start, measure.end].map((camera) => (camera ? deriveShot(camera.pos, subject, (camera.fovDeg * Math.PI) / 180, subject.height, filmback) : null));
	const sizes = ends[0] ? (ends[0].sizeLabel === ends[1].sizeLabel ? ends[0].sizeLabel : `${ends[0].sizeLabel} to ${ends[1].sizeLabel}`) : "unknown size";
	const focal = measure.focalMm ?? [measure.start?.focalMm ?? 0, measure.end?.focalMm ?? 0];
	// The slate (and a technique's words) name the nearest prime; the frame line states the measured focal length too.
	const primes = ends.map((end) => end?.focalMm), slate = primes[0] && primes.some((mm, i) => Math.abs(mm - focal[i]) >= 1) ? ` (slated ${primes[0] === primes[1] ? primes[0] : primes.join(" to ")}mm)` : "";
	const lens = `${Math.abs(focal[1] - focal[0]) >= 0.5 ? `${r(focal[0])} to ${r(focal[1])} mm` : `${r(focal[0])} mm, ${lensWordFromFocalMm(focal[0])}`}${slate}`;
	const named = (id) => castName(scene.cast.find((row) => row.id === id) ?? { id });
	const coverage = shot.coverage?.pattern ? `${shot.coverage.role || "shot"}${shot.coverage.subjectId ? ` on ${named(shot.coverage.subjectId)}` : ""} in ${coveragePattern(shot.coverage.pattern)?.name ?? shot.coverage.pattern}` : null;
	const into = transitionWords(shot.transition, fps) ?? (first ? "opens the sequence" : "a straight cut from the previous shot");
	const out = transitionOutWords(shot.transitionOut);
	const placed = measure.start && subject.id ? measureComposition(measure.start, eyePoint(subject), aspectRatio) : null;
	return {
		index, id: shot.id, title: shot.name || `Shot ${index}`, startFrame: shot.startFrame, endFrame: shot.endFrame, frames: shot.endFrame - shot.startFrame + 1,
		subjectId: subject.id, subjectName: castName(subject) || "the subject",
		moveId: move.id, camera: technique?.phrase || move.phrase, technique: technique?.label ?? null,
		measure, measured: measuredWords(measure), size: sizes, lens,
		angle: measure.start && ends[0] ? angleWords(measure.start, ends[0]) : "unknown angle",
		placed, composition: placed ? compositionPhrase(castName(subject), placed) : null,
		rig: capabilityWords(shot.camera, { castName: named, fps }).filter((words) => !technique?.phrase?.includes(words)),
		coverage, transition: out ? `${into}; ${out}` : into,
	};
}
