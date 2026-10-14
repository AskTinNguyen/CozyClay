// Validation of spec.objects (C3): a hinge { pivot, axis?, channel } or a carry { prop, grab?,
// release?, at?, along?, visible? }. Both take a body or a group (Empty) id; at/along are for
// bodies only (a group keeps its grab-frame palm offset). Fields: schema/fields.js OBJECT_FIELDS.
// See validate.js.
import { isVec3, fmt, didYouMean } from "./vocab.js";
import { objectOk } from "./validate-common.js";
import { OBJECT_FIELDS } from "../schema/fields.js";
import { groupsOf } from "../scene.js";

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
		for (const f of Object.keys(o ?? {})) if (!fields.includes(f)) unknown(`${at} (${kind}) has unknown field "${f}"${didYouMean(f, fields)}; fields: ${fields.join(", ")}`);
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
			continue;
		}
		if (!isVec3(o?.pivot)) err(`${at}.pivot must be [x, y, z] (world hinge point), got ${fmt(o?.pivot)}`);
		if (o?.axis !== undefined && (!isVec3(o.axis) || Math.hypot(...o.axis) < 1e-9)) err(`${at}.axis must be a non-zero [x, y, z], got ${fmt(o.axis)}`);
		if (typeof o?.channel !== "string" || !o.channel) err(`${at}.channel must name the angle channel (degrees)`);
	}
}
