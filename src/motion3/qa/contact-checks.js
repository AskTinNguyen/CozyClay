// Contact checks on top of the general set (ported from the car-exit prototype QA): hands and
// held prop points entering the torso, the two hands overlapping, and hinged scene objects
// (spec.objects, e.g. a door) passing through the rest of the scene. Corners only for objects.
import { add, sub, scale, dot, len, apply, clamp } from "../compiler/math.js";
import { CAPSULES, segPoints, sdBox, segDist } from "./geometry.js";

const TORSO = CAPSULES.filter(c => c[0].startsWith("torso"));
const HAND_R = CAPSULES.find(c => c[0] === "hand_l")[3];
const PROP_R = 0.004;

function pointSegDist(p, a, b) {
	const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12), 0, 1);
	return len(sub(p, add(a, scale(ab, t))));
}

function corners(o) {
	const out = [];
	for (const x of [-1, 1]) for (const y of [0, 2]) for (const z of [-1, 1]) out.push(add(o.pos, apply(o.R, [x * o.half[0], y * o.half[1], z * o.half[2]])));
	return out;
}

/** L: limits { body, hands, object } (m); push(kind, msg, frame, value, limit). */
export function contactChecks(sk, out, L, push) {
	const I = sk.index, hinged = Object.keys(out.ctx.spec.objects ?? {});
	for (let f = 0; f < out.frames.length; f++) {
		const { s, diag } = out.frames[f], P = s.P;
		const probes = [];
		for (const S of ["Left", "Right"]) for (const p of segPoints(P[I[`${S}Hand`]], P[I[`${S}HandMiddle3`]], 5)) probes.push([`hand_${S[0].toLowerCase()}`, p, HAND_R]);
		for (const [pn, pts] of Object.entries(diag.props ?? {})) for (const [k, p] of Object.entries(pts)) if (Array.isArray(p) && k !== "origin") probes.push([`prop_${pn}`, p, PROP_R]);
		for (const [part, a, b, r] of TORSO) {
			const worst = new Map();
			for (const [nm, p, pr] of probes) worst.set(nm, Math.max(worst.get(nm) ?? -Infinity, r + pr - pointSegDist(p, P[I[a]], P[I[b]])));
			for (const [nm, d] of worst) if (d > L.body) push("BODY", `${nm} into ${part}`, f, d, L.body);
		}
		const overlap = 2 * HAND_R - segDist(P[I.LeftHand], P[I.LeftHandMiddle3], P[I.RightHand], P[I.RightHandMiddle3]);
		if (overlap > L.hands) push("SELF", "hands overlap", f, overlap, L.hands);
		if (!hinged.length) continue;
		const objs = out.objectsAt(f);
		for (const id of hinged) {
			if (!objs[id]?.half) continue;
			const cs = corners(objs[id]);
			for (const [oid, box] of Object.entries(objs)) {
				if (hinged.includes(oid) || !box.half || box.ignore) continue;
				const depth = -Math.min(...cs.map(p => sdBox(p, box)));
				if (depth > L.object) push("OBJECT", `${id} into ${oid}`, f, depth, L.object);
			}
		}
	}
}
