// C5. Probes: measurements the agent asks for on this compile (motion.compile { probes }),
// whether or not it installs. At most 16 probes; each is checked first (schema/fields.js
// PROBE_FIELDS, refs.js checkRef with the full grammar) and every problem is thrown at once as
// MOTION_SPEC_INVALID, one per line, e.g.
//   probes[0].distance[0] "joint:LeftHnad": unknown bone; did you mean "LeftHand"?
// Bone names may be loose ("hips", "hand_l", bones.js resolveBone); they are turned into the
// rig's names before measuring. Answers per name (a probe without a name is "probes[i]"):
//   distance [a, b]  { min, minAt, max, maxAt, mean, first, last }   (refs.js refDistance; metres
//                    to 6 decimals; every `every` frames, default 1; null when no frame has a value)
//   position ref     { at: [{ f, p: [x,y,z] }] }                      (metres to 4 decimals; at most 16
//                    rows; every defaults to the step that fits the range in 16 rows)
// frames: [f0, f1] absolute and inclusive, or one frame (default the whole take).
import { PROBE_FIELDS } from "./schema/fields.js";
import { checkRef, refPoint, refDistance } from "./refs.js";
import { resolveBone } from "./bones.js";
import { didYouMean, fmt } from "./compiler/vocab.js";

const MAX_PROBES = 16, MAX_ROWS = 16, MAX_ERRORS = 12, SHAPE = "{ name, distance: [refA, refB] | position: ref, frames: [f0, f1], every }";
const r6 = v => Math.round(v * 1e6) / 1e6, r4 = v => Math.round(v * 1e4) / 1e4;

/** joint:/bone: refs with the rig's own bone name ("joint:hips" -> "joint:Hips"). */
function exactRef(sk, ref) {
	const m = /^(joint|bone):(.+)$/s.exec(ref);
	return m ? `${m[1]}:${resolveBone(sk, m[2]).bone ?? m[2]}` : ref;
}

function rangeOf(p, at, last, err) {
	const fr = p.frames === undefined ? [0, last] : Number.isInteger(p.frames) ? [p.frames, p.frames] : p.frames;
	const ok = Array.isArray(fr) && fr.length === 2 && fr.every(Number.isInteger) && fr[0] >= 0 && fr[0] <= fr[1] && fr[1] <= last;
	if (!ok) err(`${at}.frames must be [f0, f1], integer frames within 0..${last} with f0 <= f1, got ${fmt(p.frames)}`);
	return ok ? fr : null;
}

/** Checked probes [{ name, refs, kind, range, every }]; throws MOTION_SPEC_INVALID listing every problem. */
function checkProbes(out, probes, { spec, sk, scene }) {
	const errors = [], err = m => { if (errors.length < MAX_ERRORS) errors.push(m); }, last = out.frameCount - 1, list = [], names = new Map();
	if (!Array.isArray(probes)) err(`probes must be an array of ${SHAPE}`);
	else if (probes.length > MAX_PROBES) err(`probes has ${probes.length} entries; at most ${MAX_PROBES} per compile`);
	else probes.forEach((p, i) => {
		const at = `probes[${i}]`;
		if (!p || typeof p !== "object" || Array.isArray(p)) return err(`${at} must be ${SHAPE}`);
		for (const k of Object.keys(p)) if (!PROBE_FIELDS.includes(k)) err(`${at} has unknown field "${k}"${didYouMean(k, PROBE_FIELDS)}; a probe is ${SHAPE}`);
		const name = p.name ?? at;
		if (typeof name !== "string" || !name) err(`${at}.name must be a non-empty string, got ${fmt(p.name)}`);
		else if (names.has(name)) err(`${at}.name "${name}" is already used by ${names.get(name)}; probe names must differ`);
		else names.set(name, at);
		if ((p.distance === undefined) === (p.position === undefined)) return err(`${at} needs exactly one of distance: [refA, refB] or position: ref`);
		const kind = p.distance !== undefined ? "distance" : "position";
		const refs = kind === "distance" ? p.distance : [p.position];
		if (kind === "distance" && !(Array.isArray(refs) && refs.length === 2 && refs.every(r => typeof r === "string"))) return err(`${at}.distance must be [refA, refB], two point refs, got ${fmt(p.distance)}`);
		if (kind === "position" && typeof p.position !== "string") return err(`${at}.position must be a point ref, got ${fmt(p.position)}`);
		const good = refs.map((r, j) => checkRef(spec, err, { sk, scene }, kind === "distance" ? `${at}.distance[${j}]` : `${at}.position`, r)).every(Boolean);
		const range = rangeOf(p, at, last, err);
		if (p.every !== undefined && !(Number.isInteger(p.every) && p.every >= 1)) return err(`${at}.every must be a positive integer, got ${fmt(p.every)}`);
		if (!good || !range) return;
		const span = range[1] - range[0] + 1, every = p.every ?? (kind === "position" ? Math.ceil(span / MAX_ROWS) : 1), rows = Math.ceil(span / every);
		if (kind === "position" && rows > MAX_ROWS) return err(`${at} (position) gives ${rows} rows over f${range[0]}..${range[1]} with every ${every}; at most ${MAX_ROWS} rows (every >= ${Math.ceil(span / MAX_ROWS)})`);
		list.push({ name, kind, refs: refs.map(r => exactRef(sk, r)), range, every });
	});
	if (errors.length) throw new Error(`MOTION_SPEC_INVALID: ${errors.join("\n")}${errors.length >= MAX_ERRORS ? "\n(more problems not listed)" : ""}`);
	return list;
}

function frameList([f0, f1], every) {
	const out = [];
	for (let f = f0; f <= f1; f += every) out.push(f);
	return out;
}

function distanceOf(out, p) {
	const vals = frameList(p.range, p.every).map(f => [f, refDistance(out, f, p.refs[0], p.refs[1])]).filter(([, v]) => Number.isFinite(v));
	if (!vals.length) return { min: null, minAt: null, max: null, maxAt: null, mean: null, first: null, last: null };
	let lo = vals[0], hi = vals[0], sum = 0;
	for (const fv of vals) { if (fv[1] < lo[1]) lo = fv; if (fv[1] > hi[1]) hi = fv; sum += fv[1]; }
	return { min: r6(lo[1]), minAt: lo[0], max: r6(hi[1]), maxAt: hi[0], mean: r6(sum / vals.length), first: r6(vals[0][1]), last: r6(vals[vals.length - 1][1]) };
}

function positionOf(out, p) {
	return { at: frameList(p.range, p.every).map(f => { const q = refPoint(out, f, p.refs[0]); return { f, p: q ? q.map(r4) : null }; }) };
}

/**
 * runProbes(out, probes, { spec, sk, scene }) -> { [name]: result }
 * @param {object} out  compileMotion result
 * @param {object[]} probes  the request's probes
 * @param {{ spec: object, sk: object, scene: object }} ctx  spec = the expanded spec
 */
export function runProbes(out, probes, ctx) {
	return Object.fromEntries(checkProbes(out, probes, ctx).map(p => [p.name, p.kind === "distance" ? distanceOf(out, p) : positionOf(out, p)]));
}
