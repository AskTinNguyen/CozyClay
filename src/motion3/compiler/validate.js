// Strict motion spec validation with exact messages, run before every compile through the
// pipeline (after skills expand, with open parameters at a trial value). Every problem found is
// listed at once, one per line, so the agent fixes them in one edit.
import { VEC_CHANNELS, POLE_CHANNELS, NUM_CHANNELS, MAP_CHANNELS, FINGER_PRESETS, rangeOf, CONVENTIONS, didYouMean, suggestField, isVec3, fmt } from "./vocab.js";
import { validateParts } from "./validate-parts.js";
import { SPEC_FIELDS, KEY_FIELDS } from "../schema/fields.js";
const MAX_ERRORS = 12;


/** Channels other than the body's own: hinge channels, channels a check names, *_vis switches, spec.channels. */
function customChannels(spec) {
	const out = new Set(spec.channels ?? []);
	for (const o of Object.values(spec.objects ?? {})) for (const ch of [o?.channel, o?.visible]) if (ch) out.add(ch);
	const c = spec.checks ?? {};
	const list = v => (Array.isArray(v) ? v.filter(k => k && typeof k === "object") : []);
	for (const k of [c.contacts, c.orient, c.below, c.clearance].flatMap(list)) if (typeof k.when === "string") out.add(k.when);
	for (const k of list(c.appear)) if (typeof k.channel === "string") out.add(k.channel);
	return out;
}

function checkValue(err, at, ch, v) {
	if (VEC_CHANNELS.has(ch)) {
		if (!isVec3(v)) return err(`${at} ${ch} must be [x, y, z] (3 finite numbers), got ${fmt(v)}`);
		if (POLE_CHANNELS.has(ch)) {
			const l = Math.hypot(...v);
			if (l < 1e-6) return err(`${at} ${ch} = ${fmt(v)} has no direction; a pole is ${CONVENTIONS.pole}`);
			if (ch.startsWith("knee") && v[2] < -0.7 * l) err(`${at} ${ch} = ${fmt(v)} points backward; knees bend toward +z. A pole is ${CONVENTIONS.pole}`);
		}
		if (ch.startsWith("foot") && v[1] < 0.04) err(`${at} ${ch} y = ${v[1]} puts the ankle into the floor; foot_* is ${CONVENTIONS.foot}`);
		return;
	}
	if (MAP_CHANNELS.has(ch)) {
		if (!v || typeof v !== "object" || Array.isArray(v)) return err(`${at} ${ch} must be { preset: weight }, presets ${FINGER_PRESETS.join(", ")}; got ${fmt(v)}`);
		for (const [p, w] of Object.entries(v)) {
			if (!FINGER_PRESETS.includes(p)) err(`${at} ${ch} preset "${p}" is unknown${didYouMean(p, FINGER_PRESETS)} (presets: ${FINGER_PRESETS.join(", ")})`);
			else if (!(Number.isFinite(w) && w >= 0 && w <= 1)) err(`${at} ${ch}.${p} must be a weight within 0..1, got ${fmt(w)}`);
		}
		return;
	}
	if (!Number.isFinite(v)) {
		const conv = ch === "yaw" ? ` (degrees; ${CONVENTIONS.yaw})` : ch.startsWith("fyaw") ? ` (${CONVENTIONS.fyaw})` : "";
		return err(`${at} ${ch} must be a finite number${conv}, got ${fmt(v)}`);
	}
	const r = rangeOf(ch);
	if (r && (v < r[1] || v > r[2])) err(`${at} ${ch} = ${v} is outside ${r[1]}..${r[2]} (${r[3]})`);
}

function validateKeys(spec, err, frames, unknown) {
	if (spec.keys !== undefined && !Array.isArray(spec.keys)) return err("spec.keys must be an array of { f, set, step? }");
	const anchors = Object.keys(spec.anchors ?? {}), custom = customChannels(spec);
	const known = [...VEC_CHANNELS, ...NUM_CHANNELS, ...MAP_CHANNELS, ...custom, ...anchors.flatMap(a => [`w_${a}_l`, `w_${a}_r`])];
	(spec.keys ?? []).forEach((key, i) => {
		const name = key?.src ? (key.src.startsWith("keys[") ? key.src : `${key.src} key`) : `keys[${i}]`;
		if (!key || typeof key !== "object") return err(`${name} must be { f, set, step? }`);
		for (const field of Object.keys(key)) if (!KEY_FIELDS.includes(field)) unknown(`${name} has unknown field "${field}"${suggestField(field, KEY_FIELDS)}; a key is { f, set, step? }`);
		if (!Number.isInteger(key.f)) return err(`${name}.f must be an integer frame, got ${fmt(key.f)}`);
		if (key.f < 0 || key.f > frames - 1) err(`${name}.f = ${key.f} is outside 0..${frames - 1} (spec.frames ${frames})`);
		const at = `${name} (f${key.f})`;
		if (!key.set || typeof key.set !== "object" || Array.isArray(key.set)) return err(`${at} needs set: { channel: value }`);
		for (const [ch, v] of Object.entries(key.set)) {
			const w = /^w_(.+)_([lr])$/.exec(ch);
			if (w && !anchors.includes(w[1])) err(`${at} sets ${ch}, but there is no anchor "${w[1]}"${didYouMean(ch, known)}`);
			else if (w) checkValue(err, at, ch, v);
			else if (VEC_CHANNELS.has(ch) || NUM_CHANNELS.has(ch) || MAP_CHANNELS.has(ch)) checkValue(err, at, ch, v);
			else if (custom.has(ch) || ch.endsWith("_vis")) { if (!Number.isFinite(v)) err(`${at} ${ch} must be a finite number, got ${fmt(v)}`); }
			else err(`${at} sets unknown channel "${ch}"${didYouMean(ch, known)}`);
		}
		for (const ch of key.step ?? []) if (!(ch in key.set)) err(`${at} step names "${ch}", which this key does not set`);
		if (key.step !== undefined && !Array.isArray(key.step)) err(`${at} step must be an array of channel names`);
	});
}

/**
 * Throws MOTION_SPEC_INVALID listing every problem; scene objects are checked when given.
 * lenient (a saved take compiled again, take-source.js) ignores unknown fields.
 */
export function validateSpec(spec, { sk, scene, lenient = false } = {}) {
	const errors = [], err = m => { if (errors.length < MAX_ERRORS) errors.push(m); }, unknown = lenient ? () => {} : err;
	if (!spec || typeof spec !== "object") throw new Error("MOTION_SPEC_INVALID: spec must be an object");
	if (spec.schema !== "cozyclay.motion-spec.v1") err(`spec.schema must be "cozyclay.motion-spec.v1", got ${fmt(spec.schema)}`);
	for (const k of Object.keys(spec)) if (!SPEC_FIELDS.includes(k)) unknown(`spec.${k} is not a spec field${didYouMean(k, SPEC_FIELDS)} (fields: ${SPEC_FIELDS.join(", ")})`);
	if (spec.fps !== undefined && spec.fps !== 24) err(`spec.fps must be 24, the timeline rate, got ${fmt(spec.fps)}`);
	const frames = spec.frames;
	if (!Number.isInteger(frames) || frames < 1 || frames > 20000) err(`spec.frames must be an integer 1..20000 or "auto", got ${fmt(frames)}`);
	validateKeys(spec, err, Number.isInteger(frames) ? frames : 20000, unknown);
	validateParts(spec, err, { sk, scene, frames: Number.isInteger(frames) ? frames : 20000, lenient, unknown });
	if (errors.length) throw new Error(`MOTION_SPEC_INVALID: ${errors.join("\n")}${errors.length >= MAX_ERRORS ? "\n(more problems not listed)" : ""}`);
}
