// Scene records -> what the motion compiler and QA collide with: each drawable object as an
// oriented box on its base pivot (bottom centre), sized by objectSize (scene-objects.js, the
// one owner of footprint x scale) and turned by the renderer's Euler XYZ (rotX, rot, rotZ).
// Every entry lists its `ancestors` (parent ids, nearest group first), so a group (an Empty,
// which has no box of its own) is known by its parts: object-pose.js partsOf.
import { objectSize } from "../scene-objects.js";
import { mul, rx, ry, rz } from "./compiler/math.js";

const NO_BODY = new Set(["empty", "plane", "cutout"]);

/** Parent ids of a record, nearest first (stops at a cycle, a missing parent or an attached record). */
function ancestorsOf(o, byId) {
	const out = [];
	for (let p = byId.get(o.parent); p && !out.includes(p.id) && !p.attach; p = byId.get(p.parent)) out.push(p.id);
	return out;
}

export function motionScene(objects = []) {
	const out = {}, byId = new Map(objects.filter(Boolean).map(o => [o.id, o]));
	for (const o of objects) {
		if (!o || o.hidden || NO_BODY.has(o.renderer)) continue;
		const size = objectSize(o);
		if (!(size.width > 0 && size.height > 0 && size.depth > 0)) continue;
		out[o.id] = { name: o.name, renderer: o.renderer, pos: [o.x ?? 0, o.y ?? 0, o.z ?? 0],
			R: mul(rx(o.rotX ?? 0), mul(ry(o.rot ?? 0), rz(o.rotZ ?? 0))), half: [size.width / 2, size.height / 2, size.depth / 2], ancestors: ancestorsOf(o, byId) };
	}
	return { objects: out };
}
