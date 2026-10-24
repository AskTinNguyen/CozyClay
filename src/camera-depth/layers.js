// The depth layers of a frame (depth-staging A4): which cast and props stand
// in its foreground, midground and background, as distance bands around the
// subject along the camera's view. Measured from world boxes through the
// stored camera; only what the frame shows counts, and a floor or an
// enclosure (a box around the camera or the subject) is the set, not a layer.
// The sequence brief and the plan diagram read the same answer. Pure.
import { eyePoint, projectPoint } from "../camera-coverage/composition.js";
import { boxCorners } from "../camera-techniques/foreground.js";
import { castBoxes, propBoxes } from "./scene.js";

const NEAR_M = 0.1, FLAT_M = 0.05, BAND_M = 0.75, BAND_SHARE = 0.25;
const centreOf = (box) => ({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 });
const contains = (box, p) => ["x", "y", "z"].every((a) => p[a] >= box.min[a] && p[a] <= box.max[a]);

/** Does any of a box show through the framing? Its projected corners overlap the frame (a box reaching behind the lens counts when its centre is ahead). */
function inView(framing, box, aspectRatio = 16 / 9) {
	const points = boxCorners(box).map((corner) => projectPoint(framing, corner, aspectRatio)), ahead = points.filter((point) => point.depth > NEAR_M);
	if (!ahead.length) return false;
	if (ahead.length < points.length) return projectPoint(framing, centreOf(box), aspectRatio).depth > NEAR_M;
	const xs = ahead.map((point) => point.x), ys = ahead.map((point) => point.y);
	return Math.max(...xs) >= -1 && Math.min(...xs) <= 1 && Math.max(...ys) >= -1 && Math.min(...ys) <= 1;
}

/**
 * @param {object} framing  a stored camera { pos, yaw, pitch, fovDeg }
 * @param {object} subject  the subject row { id, name, x, z, rot, height }
 * @param {Array<{id,name,kind,box,attachedTo?}>} entities  cast and props (camera-depth/scene.js), the subject among them or not
 * @returns {{ subjectId, depthM, bandM, foreground: Array<{id,name,kind,depthM}>, midground: [...], background: [...] }}
 */
export function depthLayers(framing, subject, entities, aspectRatio = 16 / 9) {
	const depthM = projectPoint(framing, eyePoint(subject), aspectRatio).depth, bandM = Math.max(BAND_M, BAND_SHARE * depthM);
	const layers = { subjectId: subject.id, depthM: Math.round(depthM * 100) / 100, bandM: Math.round(bandM * 100) / 100, foreground: [], midground: [], background: [] };
	for (const row of entities) {
		if (row.id === subject.id || row.attachedTo === subject.id || row.box.max.y - row.box.min.y < FLAT_M) continue;
		if (contains(row.box, framing.pos) || contains(row.box, eyePoint(subject)) || !inView(framing, row.box, aspectRatio)) continue;
		const depth = projectPoint(framing, centreOf(row.box), aspectRatio).depth, entry = { id: row.id, name: row.name, kind: row.kind, depthM: Math.round(depth * 100) / 100 };
		layers[depth < depthM - bandM ? "foreground" : depth > depthM + bandM ? "background" : "midground"].push(entry);
	}
	for (const band of ["foreground", "midground", "background"]) layers[band].sort((a, b) => a.depthM - b.depthM || (a.id < b.id ? -1 : 1));
	return layers;
}

const list = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
// "Floor lamp" reads "the floor lamp"; a name with capitals past its first letter ("Pillar E") keeps them.
const named = (row) => (row.kind === "cast" ? row.name : `the ${/[A-Z]/.test(row.name.slice(1)) ? row.name : row.name.toLowerCase()}`);

/** The layers in a brief's words ("Joon's shoulder soft in the foreground, the floor lamp behind", "Joon level with Mara"), or null when the frame holds only its subject. */
export function depthWords(layers, subjectName = "the subject") {
	if (!layers) return null;
	const near = layers.foreground.slice(0, 3).map((row) => (row.kind === "cast" ? `${row.name}'s shoulder` : named(row)));
	const beside = layers.midground.slice(0, 3).map(named), far = layers.background.slice(0, 3).map(named);
	const parts = [...(near.length ? [`${list(near)} soft in the foreground`] : []), ...(beside.length ? [`${list(beside)} level with ${subjectName}`] : []), ...(far.length ? [`${list(far)} behind`] : [])];
	return parts.length ? parts.join(", ") : null;
}

/**
 * A shot's layers at a frame through a stored camera: the cast where they stand then and the visible props.
 * @param {{ cast: object[], objects?: object[], aspectRatio?: number, frameCount?: number, bounds?: Function, placeAt?: Function }} scene
 */
export function shotLayers(shot, camera, subjectId, { cast, objects = [], aspectRatio = 16 / 9, frameCount, bounds, placeAt } = {}) {
	if (!camera || !subjectId) return null;
	const frame = shot.startFrame, people = castBoxes(cast, shot, frame, placeAt), subject = people.find((row) => row.id === subjectId)?.row;
	return subject ? depthLayers(camera, subject, [...people, ...propBoxes(objects, cast, { frame, frameCount, bounds })], aspectRatio) : null;
}
