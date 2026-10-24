// What a shot's camera does with the set, over sampled frames (depth-staging
// A1, A2): the problems previs exists to catch before final art. Report only,
// in the shape camera.checkCuts reports (issues with rule, severity, frames,
// fix; decision D1). Each shot is read at its first and last frame and every
// k frames between (D2), so a move that passes behind a prop is caught.
//
//   occluded  the subject's eye point is hidden from the lens by a prop's box
//             (studio-geometry-facts occludersOf, the agent facts' own test)
//             or another cast member, at the first or last frame or on more
//             than OCCLUDED_SHARE of the samples
//   inside    the lens is inside a prop's box, or nearer to one than the near clip
//   crop      the top or bottom frame edge falls at a joint of the subject
//             (ankle, knee, waist, neck), placed from the figure's proportions
//
// Every issue carries a fix the camera can take (fixes.js). Pure.
import { occludersOf, segmentIntersectsAabb } from "../studio-geometry-facts.js";
import { castAt, shotCameraAt, shotSubject } from "../camera-coverage/cut-geometry.js";
import { eyePoint, projectPoint } from "../camera-coverage/composition.js";
import { scaleOf } from "../camera-techniques/framing.js";
import { castBoxes, propBoxes } from "./scene.js";
import { depthLayers } from "./layers.js";
import { suggestFix } from "./fixes.js";

export const SHOT_RULES = Object.freeze(["occluded", "inside", "crop"]);
/** The studio camera's near clip (App.jsx), metres. */
const NEAR_CLIP_M = 0.1;
const OCCLUDED_SHARE = 0.25;
/** Joint heights as a share of stature, and how near (share of stature) a frame edge may fall to one. */
export const JOINTS = Object.freeze({ ankle: 0.045, knee: 0.285, waist: 0.6, neck: 0.865 });
const CROP_BAND = 0.02;

/** The frames a shot is read at: first, last, and every k between (k = length / 8, 1 to 12). */
export function sampleFrames(shot) {
	const length = shot.endFrame - shot.startFrame + 1, k = Math.max(1, Math.min(12, Math.round(length / 8))), frames = [];
	for (let frame = shot.startFrame; frame < shot.endFrame; frame += k) frames.push(frame);
	return [...frames, shot.endFrame];
}

/** A character's sight blockers: a torso column to the shoulders and a narrower head above. */
function figureParts(row) {
	const s = scaleOf(row), h = row.height ?? 1.8 * s, part = (half, y0, y1) => ({ min: { x: row.x - half, y: y0, z: row.z - half }, max: { x: row.x + half, y: y1, z: row.z + half } });
	return [part(0.23 * s, 0, 0.82 * h), part(0.12 * s, 0.82 * h, h)];
}
const distanceToBox = (p, box) => Math.hypot(...["x", "y", "z"].map((a) => Math.max(box.min[a] - p[a], 0, p[a] - box.max[a])));
const contains = (box, p) => ["x", "y", "z"].every((a) => p[a] >= box.min[a] && p[a] <= box.max[a]);

/** What hides `eye` from `pos`: prop ids (occludersOf, the agent facts' test) and other cast ids. */
function blockersAt(pos, eye, subject, { props, people, state, bounds }) {
	const point = { min: eye, max: eye };
	const byProp = occludersOf({ id: subject.id }, pos, state, { bounds }, point).map((hit) => hit.byObjectId);
	const byCast = people.filter((row) => row.id !== subject.id && figureParts(row.row).some((box) => segmentIntersectsAabb(pos, eye, box))).map((row) => row.id);
	return [...byProp.filter((id) => props.some((row) => row.id === id)), ...byCast];
}

/** Props the lens is inside of, or nearer than the near clip to (an enclosure around the subject too is the set, not a prop). */
function insideAt(pos, eye, props) {
	return props.filter((row) => !row.attachedTo && !contains(row.box, eye)).flatMap((row) => {
		const inside = contains(row.box, pos), gap = distanceToBox(pos, row.box);
		return inside || gap < NEAR_CLIP_M ? [{ id: row.id, name: row.name, inside, gapM: Math.round(gap * 1000) / 1000 }] : [];
	});
}

/** Where the top and bottom frame edges cross the subject's axis, as shares of its stature (null when that edge misses the figure), and whether the face is in frame. */
function frameEdges(camera, subject, aspectRatio = 16 / 9) {
	const h = subject.height ?? 1.8, at = (share) => projectPoint(camera, { x: subject.x, y: share * h, z: subject.z }, aspectRatio);
	const crossing = (edge) => {
		let lo = 0, hi = 1;
		const side = (share) => Math.sign(at(share).y - edge);
		if (side(lo) === side(hi) || at(0).depth <= 0 || at(1).depth <= 0) return null;
		for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (side(mid) === side(lo)) lo = mid; else hi = mid; }
		return Math.round(((lo + hi) / 2) * 1000) / 1000;
	};
	// A figure framing shows the face, or cuts it off at the neck: an insert or a detail below the eyes is not judged at the joints.
	const eye = projectPoint(camera, eyePoint(subject), aspectRatio), top = crossing(1);
	return { bottom: crossing(-1), top, inFrame: eye.depth > 0 && Math.abs(eye.x) <= 1 && (Math.abs(eye.y) <= 1 || jointAt(top) === "neck") };
}

/** The joint a frame edge (a share of stature) falls on, or null. */
const jointAt = (share) => (share === null ? null : Object.entries(JOINTS).find(([, height]) => Math.abs(share - height) < CROP_BAND)?.[0] ?? null);
/** The frame edges that fall at a joint of a subject in frame: [{ edge, joint, at }]. */
function cropAt(camera, subject, aspect) {
	const edges = frameEdges(camera, subject, aspect);
	return edges.inFrame ? ["bottom", "top"].map((edge) => ({ edge, joint: jointAt(edges[edge]), at: edges[edge] })).filter((hit) => hit.joint) : [];
}

/**
 * Check one shot.
 * @param {object} shot
 * @param {object} scene { cast: visible character rows, objects: scene object rows, filmback, placeAt?(row, shot, frame), bounds?: the editor's bounds port }
 */
export function checkShot(shot, scene) {
	const aspect = scene.filmback?.aspectRatio ?? 16 / 9, place = scene.placeAt ?? castAt, frames = sampleFrames(shot), cast = scene.cast ?? [], objects = scene.objects ?? [];
	const report = { shotId: shot.id, name: shot.name, startFrame: shot.startFrame, endFrame: shot.endFrame, frames, subjectId: null, issues: [], layers: null };
	const samples = frames.map((frame) => {
		const camera = shotCameraAt(shot, frame, { cast, filmback: scene.filmback });
		if (!camera) return null;
		const people = castBoxes(cast, shot, frame, place), props = propBoxes(objects, cast, { frame, bounds: scene.bounds });
		const named = people.find((row) => row.id === (shot.coverage?.subjectId ?? shot.subjectIds?.[0]));
		const subject = named?.row ?? shotSubject(shot, camera, people.map((row) => row.row), aspect);
		return subject ? { frame, camera, people, props, subject, eye: eyePoint(subject), named: Boolean(named), state: { objects, characters: cast, frame } } : null;
	});
	const found = samples.filter(Boolean);
	if (!found.length) return { ...report, unjudged: "a follow camera, an empty shot or no visible subject has nothing to read" };
	// One subject for the whole shot: the one the first judged frame reads.
	const judged = found.map((row) => { const own = row.people.find((entry) => entry.id === found[0].subject.id)?.row ?? row.subject; return { ...row, subject: own, eye: eyePoint(own) }; });
	const first = judged[0], last = judged.at(-1), subject = first.subject;
	const held = (row) => row.frame === first.frame || row.frame === last.frame;
	const clears = (rule, camera, row) => rule === "occluded" ? !blockersAt(camera.pos, row.eye, row.subject, { ...row, bounds: scene.bounds }).length
		: rule === "inside" ? !insideAt(camera.pos, row.eye, row.props).length : !held(row) || !cropAt(camera, row.subject, aspect).length;
	// A shot that names no subject reads the most central person: a fix must not hand the shot to someone else.
	const keeps = (camera, row) => row.named || shotSubject(shot, camera, row.people.map((entry) => entry.row), aspect)?.id === row.subject.id;
	report.subjectId = subject.id;
	report.subjectName = subject.name;
	report.layers = depthLayers(first.camera, subject, [...first.people, ...first.props], aspect);
	const issue = (rule, severity, message, frames, extra = {}) => report.issues.push({ rule, severity, message: message.slice(0, 200), frames, subjectId: subject.id, ...extra, fix: suggestFix(rule, shot, judged, { aspect, clears, keeps }) });

	// Occluded: on the held frames, or on too many of the samples a move passes through.
	const blocked = judged.map((row) => ({ frame: row.frame, by: blockersAt(row.camera.pos, row.eye, row.subject, { ...row, bounds: scene.bounds }) })).filter((row) => row.by.length);
	const ends = blocked.filter((row) => row.frame === first.frame || row.frame === last.frame);
	if (ends.length || blocked.length / judged.length > OCCLUDED_SHARE) {
		const by = [...new Set(blocked.flatMap((row) => row.by))], nameOf = (id) => [...first.people, ...first.props, ...last.props].find((row) => row.id === id)?.name ?? id;
		const severity = ends.length === 2 || ends.length === 1 && first === last || blocked.length / judged.length > 0.5 ? "high" : "medium";
		issue("occluded", severity, `${list(by.map(nameOf))} hide${by.length === 1 ? "s" : ""} ${subject.name}'s eyes from the lens on ${blocked.length} of ${judged.length} sampled frames (${blocked.map((row) => row.frame).join(", ")}).`, blocked.map((row) => row.frame), { by });
	}

	// Inside: the lens in a prop, or nearer to one than the near clip, on any sample.
	const inside = judged.map((row) => ({ frame: row.frame, hits: insideAt(row.camera.pos, row.eye, row.props) })).filter((row) => row.hits.length);
	if (inside.length) {
		const hits = inside.flatMap((row) => row.hits), inProp = hits.some((hit) => hit.inside), names = [...new Set(hits.map((hit) => hit.name))];
		issue("inside", inProp ? "high" : "medium", `The camera is ${inProp ? "inside" : `within ${Math.round(NEAR_CLIP_M * 100)} cm of`} ${list(names)} on ${inside.length} of ${judged.length} sampled frames (${inside.map((row) => row.frame).join(", ")}).`, inside.map((row) => row.frame), { by: [...new Set(hits.map((hit) => hit.id))] });
	}

	// Crop: a frame edge at a joint on the frames the shot holds (its first and last).
	for (const row of first === last ? [first] : [first, last]) {
		for (const hit of cropAt(row.camera, row.subject, aspect)) if (!report.issues.some((other) => other.rule === "crop" && other.joint === hit.joint && other.edge === hit.edge)) {
			issue("crop", hit.joint === "knee" || hit.joint === "neck" ? "medium" : "low", `The ${hit.edge} frame edge cuts ${subject.name} at the ${hit.joint} (${Math.round(hit.at * 100)} % of stature) on frame ${row.frame}.`, [row.frame], { joint: hit.joint, edge: hit.edge });
		}
	}
	return report;
}
const list = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Every clip shot (stills too: a still is a frame the camera holds).
 * @param {{ rule?: string, shotIds?: string[] }} [options]  rule keeps one rule's issues
 * @returns {{ shots: Array, issueCount: number, flagged: number }}
 */
export function checkShots(shots, scene, { rule = null, shotIds = null } = {}) {
	const picked = [...(shots ?? [])].filter((shot) => !shotIds || shotIds.includes(shot.id)).sort((a, b) => a.startFrame - b.startFrame);
	const reports = picked.map((shot) => checkShot(shot, scene)).map((row) => (rule ? { ...row, issues: row.issues.filter((issue) => issue.rule === rule) } : row));
	return { shots: reports, issueCount: reports.reduce((sum, row) => sum + row.issues.length, 0), flagged: reports.filter((row) => row.issues.length).length };
}
