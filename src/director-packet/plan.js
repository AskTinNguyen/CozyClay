// The director packet's plan (director-packet A2): a top-down shooting plan
// for a range of shots as data. Each shot's camera at its first frame with its
// number and frustum, and the path it travels with an arrow when it moves; the
// line of action of every pair the shots are about; each cast member's mark at
// each shot's start and the path they walk over the range; a legend. The page
// is landscape (A4 proportions) and every primitive fits inside it, with the
// legend in its own column on the right. World x runs right, z runs down the
// page, as in the Top View. Pure: plan-draw.js paints it on a canvas.
import { cameraAt, steady } from "../shot-prompt-engine/measure.js";
import { authoredLine, pairLabel, samePair } from "../camera-coverage/cut-line.js";

export const PLAN_PAGE = Object.freeze({ width: 1600, height: 1131, legendWidth: 280, marginPx: 48, frustumM: 2.5, sampleFrames: 4, moveM: 0.05, walkM: 0.1, sameMarkM: 0.05 });
const DEG = Math.PI / 180;
const round = (value) => Math.round(value * 1000) / 1000 + 0;
const flat = (point) => ({ x: round(point.x), z: round(point.z) });
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const length = (points) => points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
/** The frames to sample in a shot: every few frames, the last one always. */
const frames = (shot) => {
	const out = [];
	for (let frame = shot.startFrame; frame < shot.endFrame; frame += PLAN_PAGE.sampleFrames) out.push(frame);
	return [...out, shot.endFrame];
};
/** Drop consecutive points closer than a millimetre. */
const compact = (points) => points.filter((point, i) => i === 0 || distance(points[i - 1], point) > 0.001);

/** A shot's camera: where it stands, where it looks, its frustum, and the path it travels. */
function cameraPrimitive(shot, number, scene, aspect) {
	const still = steady(shot), start = cameraAt(scene, still, shot.startFrame);
	if (!start?.pos) return { kind: "camera", number, shotId: shot.id, label: String(number), unmeasured: true };
	// yaw 0 looks down -Z; positive yaw turns toward -X (the camera convention measure.js samples).
	const heading = { x: -Math.sin(start.yaw), z: -Math.cos(start.yaw) }, half = Math.atan(Math.tan(((start.fovDeg ?? 40) * DEG) / 2) * aspect);
	const edge = (turn) => flat({ x: start.pos.x + (heading.x * Math.cos(turn) - heading.z * Math.sin(turn)) * PLAN_PAGE.frustumM, z: start.pos.z + (heading.x * Math.sin(turn) + heading.z * Math.cos(turn)) * PLAN_PAGE.frustumM });
	const path = compact(frames(shot).map((frame) => cameraAt(scene, still, frame)).filter((pose) => pose?.pos).map((pose) => flat(pose.pos)));
	const moves = length(path) >= PLAN_PAGE.moveM, end = path.at(-1);
	// The arrowhead points along the last stretch of the path, read back far enough (0.25 m) that an ease-out still has a direction.
	const back = [...path].reverse().find((point) => distance(point, end) >= 0.25) ?? path[0];
	return {
		kind: "camera", number, shotId: shot.id, label: String(number), name: shot.name ?? null, position: flat(start.pos), heading: flat(heading), halfFovRad: round(half),
		frustum: [edge(-half), edge(half)], focalMm: round(start.focalMm ?? 0), ...(moves ? { path, arrow: { from: back, to: end }, travelM: round(length(path)) } : {}),
	};
}

/** The pairs the shots are about, each with where its two people stand at the first shot that keeps it. */
function actionLines(shots, cuts, scene, place) {
	const pairs = [];
	const add = (ids, shot, source) => {
		if (!ids || ids.length !== 2 || ids[0] === ids[1] || pairs.some((row) => samePair(row.pair, ids))) return;
		const rows = ids.map((id) => scene.cast.find((row) => row.id === id));
		if (rows.some((row) => !row)) return;
		const [a, b] = rows.map((row) => place(row, shot, shot.startFrame));
		pairs.push({ kind: "line", pair: [...ids], label: pairLabel([a, b]), source, shotId: shot.id, a: flat(a), b: flat(b) });
	};
	for (const shot of shots) add(authoredLine(shot), shot, "authored");
	for (const cut of cuts) if (cut.measures?.line?.pair?.length === 2) add(cut.measures.line.pair, shots.find((shot) => shot.id === cut.from) ?? shots[0], cut.measures.line.source);
	// Two people and no measured cut (a single shot): their line still governs where the cameras stand.
	if (!pairs.length && scene.cast.length === 2 && shots.length) add(scene.cast.map((row) => row.id), shots[0], "cast");
	return pairs;
}

/** Each cast member's marks (one per place they start a shot from) and the path they walk over the range. */
function castPrimitives(shots, scene, place) {
	const marks = [], paths = [];
	scene.cast.forEach((row, i) => {
		const letter = "ABCDEFGH"[i] ?? String(i + 1), name = String(row.subject ?? row.name ?? row.id).split(",")[0].trim();
		const own = [];
		shots.forEach((shot, s) => {
			const at = place(row, shot, shot.startFrame), same = own.find((mark) => distance(mark, at) <= PLAN_PAGE.sameMarkM && Math.abs(mark.rot - at.rot) < 5);
			if (same) { same.shots.push(s + 1); return; }
			own.push({ ...flat(at), rot: round(at.rot ?? 0), shots: [s + 1] });
		});
		for (const mark of own) marks.push({ kind: "mark", characterId: row.id, letter, label: name, x: mark.x, z: mark.z, facing: flat({ x: Math.sin(mark.rot * DEG), z: Math.cos(mark.rot * DEG) }), shots: mark.shots });
		const walked = compact(shots.flatMap((shot) => frames(shot).map((frame) => flat(place(row, shot, frame)))));
		if (length(walked) >= PLAN_PAGE.walkM) paths.push({ kind: "walk", characterId: row.id, letter, label: name, points: walked, travelM: round(length(walked)) });
	});
	return { marks, paths };
}

const LEGEND = [
	["camera", "camera: number, frustum at its first frame"], ["cameraPath", "camera move: path and arrow"], ["line", "line of action between a pair"],
	["mark", "cast mark at a shot's start (shot numbers)"], ["walk", "cast path over the range"],
];

/** Fit every point onto the page left of the legend column, keeping metres square. */
function fit(points) {
	const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
	const min = { x: Math.min(...xs, 0), z: Math.min(...zs, 0) }, max = { x: Math.max(...xs, 0), z: Math.max(...zs, 0) };
	const area = { x: PLAN_PAGE.marginPx, y: PLAN_PAGE.marginPx, width: PLAN_PAGE.width - PLAN_PAGE.legendWidth - 2 * PLAN_PAGE.marginPx, height: PLAN_PAGE.height - 2 * PLAN_PAGE.marginPx };
	const spanX = Math.max(max.x - min.x, 1), spanZ = Math.max(max.z - min.z, 1), scale = Math.min(area.width / spanX, area.height / spanZ);
	const offset = { x: area.x + (area.width - spanX * scale) / 2 - min.x * scale, y: area.y + (area.height - spanZ * scale) / 2 - min.z * scale };
	return { scale: round(scale), offset: { x: round(offset.x), y: round(offset.y) }, area, view: { minX: round(min.x), maxX: round(max.x), minZ: round(min.z), maxZ: round(max.z) } };
}

/** Every world point a primitive draws, for fitting and for the fit check. */
export function primitivePoints(primitive) {
	if (primitive.kind === "camera") return primitive.unmeasured ? [] : [primitive.position, ...primitive.frustum, ...(primitive.path ?? [])];
	if (primitive.kind === "line") return [primitive.a, primitive.b];
	if (primitive.kind === "mark") return [primitive];
	if (primitive.kind === "walk") return primitive.points;
	return [];
}

/**
 * @param {Array} shots  the range's shots in time order
 * @param {object} scene engineScene (cast, filmback) of the document
 * @param {{ cuts?: Array, placeAt: Function, aspect?: number }} options  cuts: checkCuts' cuts (their measured pairs)
 * @returns {{ page, scale, offset, view, primitives, counts }}
 */
export function planPrimitives(shots, scene, { cuts = [], placeAt, aspect = 16 / 9 }) {
	const cameras = shots.map((shot, i) => cameraPrimitive(shot, i + 1, scene, aspect)), lines = actionLines(shots, cuts, scene, placeAt);
	const { marks, paths } = castPrimitives(shots, scene, placeAt), drawn = [...lines, ...paths, ...marks, ...cameras];
	const present = new Set(drawn.map((row) => row.kind)), moving = cameras.some((row) => row.path);
	const legend = { kind: "legend", rows: LEGEND.filter(([kind]) => (kind === "cameraPath" ? moving : present.has(kind))).map(([kind, label]) => ({ kind, label })) };
	const frame = fit(drawn.flatMap(primitivePoints));
	const primitives = [{ kind: "grid", stepM: 1, ...frame.view }, ...drawn, legend];
	const counts = { cameras: cameras.length, moving: cameras.filter((row) => row.path).length, lines: lines.length, marks: marks.length, walks: paths.length, legendRows: legend.rows.length };
	return { page: { width: PLAN_PAGE.width, height: PLAN_PAGE.height, orientation: "landscape", legend: { x: PLAN_PAGE.width - PLAN_PAGE.legendWidth, width: PLAN_PAGE.legendWidth } }, scale: frame.scale, offset: frame.offset, view: frame.view, primitives, counts };
}

/** World metres to page pixels for a plan. */
export const toPage = (plan, point) => [plan.offset.x + point.x * plan.scale, plan.offset.y + point.z * plan.scale];
