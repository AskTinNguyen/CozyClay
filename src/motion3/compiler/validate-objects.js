// Validation of spec.objects (C3): a hinge { pivot, axis?, channel } or a carry { prop, grab?,
// release?, at?, along?, visible?, keys? }. Both take a body or a group (Empty) id; at/along are for
// bodies only (a group keeps its grab-frame palm offset); keys (C14) pose a carried object while it
// is in hand. Fields: schema/fields.js OBJECT_FIELDS, OBJECT_KEY_FIELDS. See validate.js.
import { isVec3, fmt, didYouMean } from "./vocab.js";
import { objectOk } from "./validate-common.js";
import { OBJECT_FIELDS, OBJECT_KEY_FIELDS } from "../schema/fields.js";
import { groupsOf } from "../scene.js";

const KEY = "{ f, pos: [x, y, z], rot: [x, y, z, w] }";
const isQuat = q => Array.isArray(q) && q.length === 4 && q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) <= 0.01;

/** objects.<id>.keys (C14): whole frames inside grab..release, one per frame, a world position and a unit quaternion. */
function validateKeys(err, unknown, at, o, frames) {
	if (!Array.isArray(o.keys)) return err(`${at}.keys must be an array of ${KEY}`);
	const lo = o.grab ?? 0, hi = o.release ?? (Number.isInteger(frames) ? frames - 1 : Infinity), seen = new Map();
	o.keys.forEach((k, i) => {
		const kat = `${at}.keys[${i}]`;
		if (!k || typeof k !== "object" || Array.isArray(k)) return err(`${kat} must be ${KEY}, got ${fmt(k)}`);
		for (const f of Object.keys(k)) if (!OBJECT_KEY_FIELDS.includes(f)) unknown(`${kat} has unknown field "${f}"${didYouMean(f, OBJECT_KEY_FIELDS)}; a key is ${KEY}`);
		if (!Number.isInteger(k.f)) err(`${kat}.f must be a whole frame, got ${fmt(k.f)}`);
		else if (k.f < lo || k.f > hi) err(`${kat}.f = ${k.f} is outside grab..release (${lo}..${hi}); keys pose the object only while it is in hand`);
		else if (seen.has(k.f)) err(`${kat}.f = ${k.f}: keys[${seen.get(k.f)}] is at that frame already; one key per frame`);
		else seen.set(k.f, i);
		if (!isVec3(k.pos)) err(`${kat}.pos must be [x, y, z], the world position of the object's base (a group: its root), got ${fmt(k.pos)}`);
		if (!isQuat(k.rot)) err(`${kat}.rot must be a unit quaternion [x, y, z, w], got ${fmt(k.rot)}`);
	});
}

function frameOk(err, at, v, frames) {
	if (v === undefined) return true;
	if (Number.isInteger(v) && v >= 0 && (!Number.isInteger(frames) || v < frames)) return true;
	err(`${at} must be a whole frame 0..${Number.isInteger(frames) ? frames - 1 : "frames-1"}, got ${fmt(v)}`);
	return false;
}

export function validateObjects(spec, err, { scene, frames = spec.frames, unknown = err }) {
	for (const [id, o] of Object.entries(spec.objects ?? {})) {
		const at = `objects.${id}`, group = !scene?.objects?.[id] && !!groupsOf(scene)[id];
		objectOk(err, scene, at, id, { groups: true });
		const kind = o?.prop !== undefined ? "carry" : "hinge", fields = OBJECT_FIELDS[kind];
		for (const f of Object.keys(o ?? {})) if (!fields.includes(f) && !(kind === "hinge" && f === "keys")) unknown(`${at} (${kind}) has unknown field "${f}"${didYouMean(f, fields)}; fields: ${fields.join(", ")}`);
		if (kind === "carry") {
			if (!spec.props?.[o.prop]) err(`${at}.prop "${o.prop}" is not in spec.props`);
			for (const f of ["at", "along"]) {
				if (o[f] === undefined) continue;
				if (group) err(`${at}.${f}: "${id}" is a group; a group keeps the offset it has against the palm at grab (leave at/along out)`);
				else if (!isVec3(o[f])) err(`${at}.${f} must be [d, l, n] along the palm axes, got ${fmt(o[f])}`);
			}
			if (o.visible !== undefined && (typeof o.visible !== "string" || !o.visible)) err(`${at}.visible must name a channel (shown above 0.5)`);
			if (frameOk(err, `${at}.grab`, o.grab, frames) && frameOk(err, `${at}.release`, o.release, frames)
				&& o.grab !== undefined && o.release !== undefined && !(o.grab < o.release)) err(`${at}: grab (${o.grab}) must come before release (${o.release})`);
			if (o.keys !== undefined) validateKeys(err, unknown, at, o, frames);
			continue;
		}
		if (o?.keys !== undefined) err(`${at}.keys: only a carried object (prop) takes keys; a hinge turns by its channel "${o.channel}", keyed in spec.keys`);
		if (!isVec3(o?.pivot)) err(`${at}.pivot must be [x, y, z] (world hinge point), got ${fmt(o?.pivot)}`);
		if (o?.axis !== undefined && (!isVec3(o.axis) || Math.hypot(...o.axis) < 1e-9)) err(`${at}.axis must be a non-zero [x, y, z], got ${fmt(o.axis)}`);
		if (typeof o?.channel !== "string" || !o.channel) err(`${at}.channel must name the angle channel (degrees)`);
	}
}
