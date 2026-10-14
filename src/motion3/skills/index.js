// Skill library: parameterised spec builders the agent calls with spec.use instead of writing
// every key. use: [{ skill, args, f0 }] expands, in order, into keys, anchors, props, fits,
// objects, checks and channels (the extra channels a skill keys) before compile; each skill reads the pose the earlier keys leave at its
// f0. The agent's own keys come after the skill keys (a key of the agent wins on the same
// frame), and the agent's own anchors/props/fits replace a skill's of the same name.
import { stateAt } from "../compiler/walk.js";
import { didYouMean, suggestField } from "../compiler/vocab.js";
import { USE_FIELDS } from "../schema/fields.js";
import { SKILL_INFO } from "./info.js";
import { standIdle, walkTo, reachGrip } from "./basic.js";
import { sitInSeat, exitCar } from "./car.js";
import { smokeCigarette } from "./smoke.js";

const SKILLS = { standIdle, sitInSeat, exitCar, walkTo, reachGrip, smokeCigarette };
export const SKILL_NAMES = Object.keys(SKILLS);
const bad = msg => { throw new Error(`MOTION_SPEC_INVALID: ${msg}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeNamed(into, part, what, tag) {
	for (const [name, v] of Object.entries(part ?? {})) {
		if (into[name] && !same(into[name], v)) bad(`${tag} defines ${what}.${name} differently from an earlier skill; rename one or define it yourself in spec.${what}`);
		into[name] = v;
	}
}

/** Lists merge without duplicates; anything else (an unknown check, a non-list) passes on for the validator to name. */
function mergeChecks(into, part) {
	for (const [name, v] of Object.entries(part ?? {})) {
		if (name === "limits" && v && typeof v === "object" && !Array.isArray(v)) { into.limits = { ...into.limits, ...v }; continue; }
		if (!Array.isArray(v) || (into[name] !== undefined && !Array.isArray(into[name]))) { into[name] = v; continue; }
		const list = into[name] ?? (into[name] = []);
		for (const item of v) if (!list.some(x => same(x, item))) list.push(item);
	}
}

/** use[i].args against the skill's args (skills/info.js); lenient ignores unknown ones. */
function argsOk(u, i, lenient) {
	if (u.args !== undefined && (!u.args || typeof u.args !== "object" || Array.isArray(u.args))) bad(`use[${i}].args must be an object, got ${JSON.stringify(u.args)}`);
	const known = Object.keys(SKILL_INFO[u.skill].args);
	if (!lenient) for (const a of Object.keys(u.args ?? {})) if (!known.includes(a)) bad(`use[${i}].args.${a} is not an arg of ${u.skill}${suggestField(a, known)} (args: ${known.join(", ")})`);
}

/**
 * spec with `use` -> { spec: plain spec (no use), used: [{ skill, f0, end }] }; lenient ignores
 * unknown use[i] fields and args. auto (frames-auto.js) lets a skill that holds to the last
 * frame end where its own motion ends.
 */
export function expandUse(spec, { sk, scene, lenient = false, auto = false }) {
	if (!spec.use?.length) return { spec, used: [] };
	if (!Array.isArray(spec.use)) bad("spec.use must be an array of { skill, args, f0 }");
	const own = (spec.keys ?? []).map((k, i) => ({ ...k, src: `keys[${i}]` }));
	const merged = { anchors: {}, props: {}, objects: {}, fits: [], checks: {}, channels: [] }, skillKeys = [], used = [];
	spec.use.forEach((u, i) => {
		const tag = `use[${i}] ${u?.skill}`;
		if (!SKILLS[u?.skill]) bad(`use[${i}].skill "${u?.skill}" is not a skill${didYouMean(String(u?.skill), SKILL_NAMES)} (skills: ${SKILL_NAMES.join(", ")})`);
		for (const f of Object.keys(u)) if (!USE_FIELDS.includes(f) && !lenient) bad(`use[${i}] has unknown field "${f}"${suggestField(f, USE_FIELDS)}; an entry is { skill, args, f0 }`);
		argsOk(u, i, lenient);
		if (!Number.isInteger(u.f0) || u.f0 < 0 || u.f0 > spec.frames - 1) bad(`use[${i}].f0 must be an integer frame within 0..${spec.frames - 1}, got ${JSON.stringify(u.f0)}`);
		const keys = [...skillKeys, ...own];
		const ctx = { sk, scene, frames: spec.frames, auto, f0: u.f0, args: structuredClone(u.args ?? {}), tag, keys, state: structuredClone(stateAt(keys, u.f0)), anchors: { ...merged.anchors, ...spec.anchors } };
		const part = SKILLS[u.skill](ctx), last = Math.max(part.end ?? u.f0, ...part.keys.map(k => k.f));
		if (last > spec.frames - 1) bad(`${tag} needs ${last - u.f0} frames from f${u.f0} (to f${last}), past the last frame f${spec.frames - 1}; set frames >= ${last + 1} or frames: "auto"`);
		skillKeys.push(...part.keys.map(k => ({ ...k, src: k.src ?? tag })));
		mergeNamed(merged.anchors, part.anchors, "anchors", tag);
		mergeNamed(merged.props, part.props, "props", tag);
		mergeNamed(merged.objects, part.objects, "objects", tag);
		for (const fit of part.fits ?? []) if (!merged.fits.some(x => same(x, fit))) merged.fits.push(fit);
		for (const ch of part.channels ?? []) if (!merged.channels.includes(ch)) merged.channels.push(ch);
		mergeChecks(merged.checks, part.checks);
		used.push({ skill: u.skill, f0: u.f0, end: part.end });
	});
	const out = { ...spec, keys: [...skillKeys, ...own], anchors: { ...merged.anchors, ...spec.anchors }, props: { ...merged.props, ...spec.props },
		objects: { ...merged.objects, ...spec.objects } };
	const channels = [...new Set([...merged.channels, ...(Array.isArray(spec.channels) ? spec.channels : [])])];
	if (channels.length) out.channels = channels;
	const mine = spec.fits ?? [];
	out.fits = [...merged.fits.filter(f => !mine.some(m => m.side === f.side && m.anchor === f.anchor)), ...mine];
	mergeChecks(merged.checks, spec.checks);
	out.checks = merged.checks;
	delete out.use;
	return { spec: out, used };
}
