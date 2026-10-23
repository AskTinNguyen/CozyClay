// How a move technique turns its base framing into camera keys or a rail.
// Every function answers { keys: [{ offset, framing, ease? }] } (offset in
// frames from the shot's first frame; ease names the segment that starts at
// that key) or { rail }, plus the move the classifier must read back.
import { SUBJECT_HEIGHT_M } from "../shot.js";
import { SIZE_SPECS, clampFocal, rotateXZ, scaleOf, stepSize } from "./framing.js";

const DEG = Math.PI / 180;
const SPAN = { slow: 1, medium: 0.65, fast: 0.35 };

const copy = (framing) => ({ position: { ...framing.position }, lookAt: { ...framing.lookAt }, focalMm: framing.focalMm });
const lift = (framing, dy, aimToo = true) => ({ ...copy(framing), position: { ...framing.position, y: framing.position.y + dy },
	lookAt: { ...framing.lookAt, y: framing.lookAt.y + (aimToo ? dy : 0) } });
/** Swing the camera around its aim point; positive degrees travel to camera-left. */
function around(framing, degrees) {
	const offset = rotateXZ({ x: framing.position.x - framing.lookAt.x, z: framing.position.z - framing.lookAt.z }, degrees * DEG);
	return { ...copy(framing), position: { x: framing.lookAt.x + offset.x, y: framing.position.y, z: framing.lookAt.z + offset.z } };
}
const yawPitch = (framing) => {
	const d = { x: framing.lookAt.x - framing.position.x, y: framing.lookAt.y - framing.position.y, z: framing.lookAt.z - framing.position.z };
	return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), range: Math.hypot(d.x, d.y, d.z) };
};
/** Re-aim from the same spot: +yaw turns left (controls.jsx YXZ convention). */
function aim(framing, yaw, pitch, range) {
	const cp = Math.cos(pitch);
	return { ...copy(framing), lookAt: { x: framing.position.x - Math.sin(yaw) * cp * range, y: framing.position.y + Math.sin(pitch) * range, z: framing.position.z - Math.cos(yaw) * cp * range } };
}

/** A move that holds, then happens over `frames` at constant speed. */
const snap = (start, end, length, frames) => {
	const hold = Math.max(0, Math.min(Math.round(length * 0.42), length - 1 - frames));
	return [{ offset: 0, framing: start }, { offset: hold, framing: copy(start), ease: "linear" }, { offset: Math.min(length - 1, hold + frames), framing: end }];
};

/**
 * @param {object} move     { recipe, params } of the move technique
 * @param {object} context  { base, frameAt(overrides), state, length (frames), subject, cast, filmback }
 */
export function compileMove(move, context) {
	const { recipe, params } = move, { base, frameAt, state, length, filmback } = context;
	const span = Math.max(2, Math.min(length - 1, Math.round((length - 1) * (SPAN[params.speed] ?? 1))));
	const two = (start, end, ease) => ({ keys: [{ offset: 0, framing: start, ...(ease ? { ease } : {}) }, { offset: span, framing: end }] });
	const up = params.direction !== "down";
	switch (recipe.move) {
		case "static": return { keys: [{ offset: 0, framing: base }], expect: "static" };
		case "dolly": {
			const tight = recipe.dir === "in" ? params.to ?? state.size ?? "medium close-up" : params.from ?? state.size ?? "medium close-up";
			const wide = recipe.dir === "in" ? params.from ?? stepSize(tight, params.steps) : params.to ?? stepSize(tight, params.steps);
			const focalMm = base.focalMm, near = frameAt({ size: tight, focalMm }), far = frameAt({ size: wide, focalMm });
			return { ...(recipe.dir === "in" ? two(far, near) : two(near, far)), expect: recipe.dir === "in" ? "push-in" : "pull-out", sizes: recipe.dir === "in" ? [wide, tight] : [tight, wide] };
		}
		case "zoom": case "crash-zoom": {
			const zoomIn = recipe.move === "crash-zoom" || params.direction !== "out";
			const tight = state.size ?? (recipe.move === "crash-zoom" ? "close-up" : "medium close-up"), wide = stepSize(tight, params.steps);
			const near = frameAt({ size: tight }), ratio = SIZE_SPECS[wide].fraction / SIZE_SPECS[tight].fraction;
			const far = { ...copy(near), focalMm: clampFocal(near.focalMm * ratio, filmback) };
			const [start, end] = zoomIn ? [far, near] : [near, far];
			if (recipe.move === "crash-zoom") return { keys: snap(start, end, length, params.frames), expect: "zoom-in" };
			return { ...two(start, end), expect: zoomIn ? "zoom-in" : "zoom-out" };
		}
		case "dolly-zoom": {
			const size = state.size ?? "medium close-up", long = clampFocal(64, filmback), short = clampFocal(long * 0.45, filmback);
			const tele = frameAt({ size, focalMm: long }), wide = frameAt({ size, focalMm: short });
			return { ...(params.direction === "out" ? two(wide, tele) : two(tele, wide)), expect: "dolly-zoom" };
		}
		case "pan": case "whip-pan": {
			const end = base, { yaw, pitch, range } = yawPitch(end), other = context.cast.find((row) => row.id !== context.subject.id);
			let turn = (params.direction === "left" ? -1 : 1) * params.degrees * DEG;
			if (recipe.move === "whip-pan" && other) {
				const toOther = Math.atan2(-(other.x - end.position.x), -(other.z - end.position.z)), delta = Math.atan2(Math.sin(toOther - yaw), Math.cos(toOther - yaw));
				if (Math.abs(delta) >= 30 * DEG) turn = delta;
			}
			const start = aim(end, yaw + turn, pitch, range), expect = turn > 0 ? "pan-right" : "pan-left";
			return recipe.move === "whip-pan" ? { keys: snap(start, end, length, params.frames), expect } : { ...two(start, end), expect };
		}
		case "tilt": {
			const { yaw, pitch, range } = yawPitch(base), delta = (up ? -1 : 1) * params.degrees * DEG;
			const start = aim(base, yaw, Math.max(-85 * DEG, Math.min(85 * DEG, pitch + delta)), range);
			return { ...two(start, base), expect: up ? "tilt-up" : "tilt-down" };
		}
		case "pedestal": {
			const low = lift(base, Math.max(0.15, base.position.y - params.rise) - base.position.y), high = lift(low, params.rise);
			return { ...(up ? two(low, high) : two(high, low)), expect: up ? "crane-up" : "crane-down" };
		}
		case "crane": case "jib": {
			const low = base, high = lift(around(base, recipe.arcDeg ? -recipe.arcDeg : 0), params.rise, false);
			return { ...(up ? two(low, high) : two(high, low)), expect: up ? "crane-up" : "crane-down" };
		}
		case "arc": case "orbit": {
			const sign = params.direction === "left" ? 1 : -1, total = params.degrees, segments = Math.max(1, Math.ceil(total / 90));
			const start = recipe.move === "arc" ? around(base, -sign * total / 2) : copy(base);
			const keys = Array.from({ length: segments + 1 }, (_, i) => ({ offset: Math.round((span * i) / segments), framing: around(start, (sign * total * i) / segments),
				...(i < segments && (segments > 1 || recipe.move === "orbit") ? { ease: recipe.move === "orbit" ? "linear" : i === 0 ? "in" : i === segments - 1 ? "out" : "linear" } : {}) }));
			return { keys, expect: "orbit", degrees: total };
		}
		case "rise-through": {
			const start = frameAt({ size: "close-up", level: "eye" }), s = scaleOf(context.subject);
			const away = { x: start.position.x - start.lookAt.x, z: start.position.z - start.lookAt.z }, k = 0.3 / (Math.hypot(away.x, away.z) || 1);
			const end = { position: { x: start.lookAt.x + away.x * k, y: params.height, z: start.lookAt.z + away.z * k }, lookAt: { ...start.lookAt, y: 0.5 * SUBJECT_HEIGHT_M * s }, focalMm: start.focalMm };
			return { ...two(start, end), expect: "crane-up" };
		}
		case "aerial": {
			const subject = context.subject, view = base.position, out = { x: view.x - subject.x, z: view.z - subject.z }, k = 1 / (Math.hypot(out.x, out.z) || 1);
			const at = (distance, height) => ({ position: { x: subject.x + out.x * k * distance, y: height, z: subject.z + out.z * k * distance },
				lookAt: { x: subject.x, y: 0.5 * SUBJECT_HEIGHT_M * scaleOf(subject), z: subject.z }, focalMm: clampFocal(state.focalMm ?? 24, filmback) });
			return { ...two(at(params.altitude * 2.6, params.altitude), at(params.altitude * 1.3, params.altitude * 0.8)), expect: "push-in" };
		}
		case "rail": return railMove(recipe, params, context);
		default: throw Object.assign(new Error(`Unknown move recipe ${recipe.move}.`), { code: "INVALID_ARGUMENT" });
	}
}

// A rail through the base camera: a lateral line across the camera's view
// (camera-right first unless direction is left), or an arc around the subject.
function railMove(recipe, params, { base, subject }) {
	const out = { x: base.position.x - subject.x, z: base.position.z - subject.z }, radius = Math.hypot(out.x, out.z) || 1;
	const sign = params.direction === "left" ? -1 : 1, aimHeight = base.lookAt.y, focalMm = base.focalMm, height = base.position.y;
	if (recipe.path === "arc") {
		const total = params.degrees * DEG, points = Array.from({ length: 5 }, (_, i) => {
			const p = rotateXZ(out, -sign * total * (i / 4 - 0.5));
			return { x: subject.x + p.x, z: subject.z + p.z };
		});
		return { rail: { points, height, aimHeight, focalMm }, expect: "orbit" };
	}
	const right = { x: out.z / radius, z: -out.x / radius }, scale = { slow: 0.8, medium: 1, fast: 1.5 }[params.speed] ?? 1;
	const half = Math.max(0.6, recipe.lengthRatio * radius * scale) / 2;
	const points = [-1, 1].map((t) => ({ x: base.position.x + right.x * half * t * sign, z: base.position.z + right.z * half * t * sign }));
	return { rail: { points, height, aimHeight, focalMm, ...(recipe.smooth ? { response: 0.45 } : {}) }, expect: "tracking" };
}
