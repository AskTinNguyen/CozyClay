// A technique stack -> the camera primitives the studio already has: the
// exact framings shot.frame keys (with an ease per segment) or the rail
// shot.setCameraRail lays, plus the move the classifier must confirm, the
// slate label and the parts only a prompt can carry. Pure: the command
// (commands/camera.js), the MCP tool and the picker preview share it.
import { resolveParams } from "./entry.js";
import { groupFraming, inFrame, povFraming, reverseFraming, shoulderFraming, singleFraming, SIZE_SPECS } from "./framing.js";
import { hasGeometry, techniqueById } from "./index.js";
import { compileMove } from "./moves.js";
import { slotOf } from "./resolve.js";
import { focalMmToFov, nearestPrime } from "../shot.js";
import { capabilityWords } from "../camera-capabilities/words.js";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const SHARED = ["speed", "focalMm", "direction", "degrees"];
const distanceTo = (a) => (b) => Math.hypot(b.x - a.x, b.z - a.z);
const byDistance = (cast, from) => cast.filter((row) => row.id !== from.id).sort((a, b) => distanceTo(from)(a) - distanceTo(from)(b));

function readStack(stack, shared) {
	if (!Array.isArray(stack) || !stack.length) fail("INVALID_ARGUMENT", "The stack needs at least one technique; read camera.techniques for ids.");
	const slots = {};
	return stack.map((raw) => {
		const item = typeof raw === "string" ? { id: raw } : raw;
		const entry = techniqueById(item?.id) ?? fail("INVALID_ARGUMENT", `Unknown technique "${item?.id}"; read camera.techniques for ids.`);
		const slot = slotOf(entry);
		if (slot !== "modifier" && slots[slot]) fail("INVALID_ARGUMENT", `The stack holds two ${slot} techniques (${slots[slot]} and ${entry.id}); keep one, or cut to a new shot for the other.`);
		if (slot !== "modifier") slots[slot] = entry.id;
		const given = { ...Object.fromEntries(SHARED.filter((key) => shared[key] !== undefined).map((key) => [key, shared[key]])), ...(item.params ?? {}) };
		return { entry, params: resolveParams(entry, given) };
	});
}

/** A stable seed per shot, so a re-applied handheld shot shakes the same way. */
const seedOf = (text) => [...String(text)].reduce((hash, char) => ((hash * 31) ^ char.charCodeAt(0)) >>> 0, 7) % 2147483647;

/**
 * The camera capability fields a stack sets (camera-capabilities/fields.js): a
 * roll from a Dutch or canted angle, a rack focus as an aperture and two focus
 * rig keys (30 % and 60 % into the shot), a handheld shake, a body mount on the
 * subject, a slow-motion speed, and a whip pan's shutter.
 */
function capabilityPatch(items, { subject, cast, shot, length, castRow, notes }) {
	const patch = {};
	for (const { entry, params } of items) {
		const recipe = entry.recipe;
		if (recipe.roll) patch.rollDeg = params.rollDeg * (params.side === "left" ? -1 : 1);
		if (recipe.shake) patch.shake = { style: "handheld", amplitude: params.intensity === "strong" ? 0.8 : 0.25, frequency: 1.4, seed: seedOf(shot.id ?? shot.name ?? "shot") };
		if (recipe.mount) patch.mount = { characterId: subject.id, bone: params.mount === "back" ? "back" : "chest" };
		if (recipe.speed) patch.speed = params.rate === "quarter" ? 0.25 : 0.5;
		if (recipe.shutter) patch.shutterDeg = params.shutterDeg;
		if (recipe.rack) {
			const from = castRow(params.from) ?? subject, to = castRow(params.to) ?? byDistance(cast, from)[0] ?? null;
			patch.lens = { fStop: params.fStop };
			if (!to) {
				notes.push("a rack focus needs a second character; focus holds on the subject");
				patch.lens.focusTarget = from.id;
			} else patch.rigKeys = [{ offset: Math.round((length - 1) * 0.3), focus: { targetId: from.id } }, { offset: Math.round((length - 1) * 0.6), focus: { targetId: to.id } }];
		}
	}
	return patch;
}

/**
 * @param {Array<string|{id:string,params?:object}>} stack
 * @param {object} ctx  { subject, cast (visible, subject included), shot: { startFrame, endFrame }, filmback, camera? }
 *   rows are { id, name?, x, z, rot, height?, eye? }; camera is { position, lookAt, focalMm }
 * @param {object} [shared]  stack-wide params: speed, focalMm, direction, degrees
 */
export function compileStack(stack, ctx, shared = {}) {
	const items = readStack(stack, shared), { subject, filmback, shot } = ctx, cast = ctx.cast ?? [subject];
	const state = { size: null, level: "eye", view: "front three-quarter", side: "right", focalMm: Number.isFinite(shared.focalMm) ? shared.focalMm : null, levelMetres: null };
	const notes = [], promptOnly = [], set = { level: false, view: false };
	let coverage = null, move = null, lens = null;
	for (const { entry, params } of items) {
		const recipe = entry.recipe;
		if (entry.requires.length) promptOnly.push({ id: entry.id, name: entry.name, requires: entry.requires, words: entry.prompt });
		if (recipe.move === "static") lens ??= params.focalMm;
		if (entry.kind === "size") { state.size = recipe.size; lens ??= params.focalMm; } else if (entry.kind === "angle") {
			if (recipe.level) { state.level = recipe.level; set.level = true; }
			if (params.level) { state.level = params.level; set.level = true; }
			if (recipe.view) { state.view = recipe.view; set.view = true; }
			if (params.side) state.side = params.side;
			if (recipe.size) state.angleSize = recipe.size;
			if (params.focalMm) lens ??= params.focalMm;
		} else if (slotOf(entry) === "coverage") coverage = { entry, params };
		else if (recipe.move) move = { entry, params, recipe };
	}
	const defaults = [coverage?.entry.recipe, move?.recipe].filter(Boolean);
	state.size ??= defaults.map((recipe) => recipe.size).find(Boolean) ?? state.angleSize ?? null;
	for (const recipe of defaults) {
		if (recipe.level && !set.level) state.level = recipe.level;
		if (recipe.view && !set.view) state.view = recipe.view;
	}
	if (coverage?.params.side) state.side = coverage.params.side;
	if (coverage?.entry.id === "establishing-shot") state.levelMetres = coverage.params.height;
	if (move?.recipe.altitude) state.levelMetres = move.params.altitude;
	if (move?.recipe.height) state.levelMetres = move.recipe.height * ((subject.height ?? 1.8) / 1.8);
	state.focalMm ??= lens;

	const castRow = (id) => (id ? cast.find((row) => row.id === id) ?? fail("STALE_TARGET", `${id} is not a visible character in this scene.`) : null);
	let subjectIds = [subject.id], members = null, frameCoverage = null;
	const recipe = coverage?.entry.recipe ?? {};
	if (recipe.group) {
		const wanted = recipe.group === "all" ? cast.length : recipe.group, partner = castRow(coverage.params.with);
		members = [subject, ...(partner ? [partner] : []), ...byDistance(cast, subject).filter((row) => row !== partner)].slice(0, wanted);
		if (members.length < wanted && recipe.group !== "all") notes.push(`${coverage.entry.name} wants ${wanted} characters; the scene shows ${members.length}`);
		frameCoverage = (st) => groupFraming(members, st, filmback);
	} else if (recipe.ots) {
		const over = castRow(coverage.params.over) ?? byDistance(cast, subject)[0];
		if (!over) notes.push("no second character to shoot over; framed a single instead");
		else frameCoverage = (st) => shoulderFraming(subject, over, st, filmback);
	} else if (recipe.pov) {
		const viewer = castRow(coverage.params.of) ?? subject;
		const target = castRow(coverage.params.target) ?? (viewer === subject ? byDistance(cast, viewer)[0] : subject) ?? null;
		subjectIds = [(target ?? viewer).id];
		if (state.size) notes.push("a point-of-view shot takes its size from the eyes, so the stack's size was not used");
		frameCoverage = (st) => povFraming(viewer, target, st, filmback);
	} else if (recipe.reverse) frameCoverage = (st) => reverseFraming(subject, ctx.camera, st, filmback);

	// A coverage framing has no size ladder of its own: a move rescales its distance (or its lens) around the aim.
	const frameAt = (over = {}) => {
		const st = { ...state, ...over };
		if (!frameCoverage) return singleFraming(subject, st, filmback, notes);
		const at = frameCoverage(state), from = SIZE_SPECS[state.size ?? "medium shot"], to = SIZE_SPECS[st.size ?? state.size ?? "medium shot"];
		const k = (over.focalMm ? over.focalMm / at.focalMm : 1) * (from.fraction / to.fraction);
		const position = { x: at.lookAt.x + (at.position.x - at.lookAt.x) * k, y: at.position.y, z: at.lookAt.z + (at.position.z - at.lookAt.z) * k };
		return { position, lookAt: at.lookAt, focalMm: over.focalMm ?? at.focalMm };
	};
	const base = frameAt();
	const length = shot.endFrame - shot.startFrame + 1;
	const geometric = items.some(({ entry }) => hasGeometry(entry));
	let compiled = geometric ? { keys: [{ offset: 0, framing: base }], expect: "static" } : { keys: null, expect: null };
	if (move) {
		if (length < 3 && !move.recipe.move.match(/^(static|rail)$/)) fail("TARGET_NOT_READY", `A move needs a shot of at least 3 frames; this one has ${length}.`);
		compiled = compileMove(move, { base, frameAt, state, length, filmback, subject, cast });
	}
	const keys = compiled.keys?.map(({ offset, framing, ease }) => ({ frame: shot.startFrame + offset, framing, ...(ease ? { ease } : {}) })) ?? null;
	if (keys && new Set(keys.map((key) => key.frame)).size !== keys.length) fail("TARGET_NOT_READY", `The shot is too short (${length} frames) to hold this move's ${keys.length} keys.`);
	// The slate names the nearest real prime, as every other studio slate does (shot.js nearestPrime).
	const prime = (mm) => nearestPrime(focalMmToFov(mm, filmback.sensorId, filmback.aspectRatio), filmback.sensorId, filmback.aspectRatio);
	const focal = (keys ? [keys[0].framing.focalMm, keys.at(-1).framing.focalMm] : compiled.rail ? [compiled.rail.focalMm] : []).map(prime);
	const tags = ["angle", "roll", "size", "coverage", "move", "modifier"].flatMap((slot) => items.filter(({ entry }) => slotOf(entry) === slot).map(({ entry }) => entry.tag));
	const lensText = focal.length ? (focal[0] === focal.at(-1) ? `${focal[0]}mm` : `${focal[0]}→${focal.at(-1)}mm`) : null;
	const capabilities = capabilityPatch(items, { subject, cast, shot, length, castRow, notes });
	const castName = (id) => (cast.find((row) => row.id === id)?.name ?? id).split(",")[0];
	return {
		stack: items.map(({ entry, params }) => ({ id: entry.id, params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined)) })),
		subjectIds, keys, rail: compiled.rail ?? null, expectedMove: compiled.expect, sizes: compiled.sizes ?? null, degrees: compiled.degrees ?? null,
		label: [...tags, ...(lensText ? [lensText] : [])].join(" · "),
		words: items.filter(({ entry }) => hasGeometry(entry) && slotOf(entry) !== "move" && !entry.requires.length).map(({ entry }) => entry.prompt),
		moveWords: move && !move.entry.requires.length ? move.entry.prompt : null,
		promptOnly, notes: [...new Set(notes)],
		// What camera.set writes for roll, rack focus, shake, mount, slow motion and whip-pan blur, and its words.
		capabilities, capabilityWords: capabilityWords(capabilities, { castName }),
		members: members && members.map((row) => ({ id: row.id, inFrame: inFrame(base, row, filmback) })),
	};
}
