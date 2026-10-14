// Validation of spec.objects: hinges and carried records (C3). Lane C adds grab/release,
// group ids and the field lists of schema/fields.js OBJECT_FIELDS. See validate.js.
import { isVec3, fmt } from "./vocab.js";
import { objectOk } from "./validate-common.js";

export function validateObjects(spec, err, { scene }) {
	for (const [id, o] of Object.entries(spec.objects ?? {})) {
		const at = `objects.${id}`;
		objectOk(err, scene, at, id);
		if (o?.prop !== undefined) {
			if (!spec.props?.[o.prop]) err(`${at}.prop "${o.prop}" is not in spec.props`);
			for (const f of ["at", "along"]) if (o[f] !== undefined && !isVec3(o[f])) err(`${at}.${f} must be [d, l, n] along the palm axes, got ${fmt(o[f])}`);
			if (o.visible !== undefined && (typeof o.visible !== "string" || !o.visible)) err(`${at}.visible must name a channel (shown above 0.5)`);
			continue;
		}
		if (!isVec3(o?.pivot)) err(`${at}.pivot must be [x, y, z] (world hinge point), got ${fmt(o?.pivot)}`);
		if (o?.axis !== undefined && (!isVec3(o.axis) || Math.hypot(...o.axis) < 1e-9)) err(`${at}.axis must be a non-zero [x, y, z], got ${fmt(o.axis)}`);
		if (typeof o?.channel !== "string" || !o.channel) err(`${at}.channel must name the angle channel (degrees)`);
	}
}
