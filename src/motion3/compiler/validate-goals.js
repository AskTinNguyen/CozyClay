// Validation of spec.goals (C8), exact messages through err(...):
//   - each goal names exactly one predicate of near | above | moved (schema/fields.js GOAL_FIELDS)
//   - near/above take two refs, moved one object ref (refs.js checkRef, the full ref grammar)
//   - tol (near) and by (above, moved) are numbers, mode "all" | "any", at an absolute frame or
//     [f0, f1] within 0..frames-1; goal names differ
//   - unknown fields go through opts.unknown (ignored when lenient)
import { GOAL_FIELDS } from "../schema/fields.js";
import { checkRef } from "../refs.js";
import { GOAL_KINDS, goalKinds } from "../qa/goals.js";
import { didYouMean, fmt } from "./vocab.js";

const SHAPE = "{ name?, near | above | moved, tol?, by?, at, mode? }";

function validateAt(err, at, v, frames) {
	const ok = f => Number.isInteger(f);
	if (v === undefined) return err(`${at} needs at: a frame or [f0, f1] (absolute frames within 0..${frames - 1})`);
	const range = Array.isArray(v) ? v : [v, v];
	if (!(range.length === 2 && range.every(ok) && range[0] <= range[1])) return err(`${at}.at must be an integer frame or [f0, f1] with f0 <= f1, got ${fmt(v)}`);
	if (range[0] < 0 || range[1] > frames - 1) err(`${at}.at = ${fmt(v)} is outside 0..${frames - 1} (spec.frames ${frames})`);
}

function validateGoal(spec, err, opts, g, i, names) {
	const at = `goals[${i}]`, ctx = { sk: opts.sk, scene: opts.scene }, unknown = opts.unknown ?? err;
	if (!g || typeof g !== "object" || Array.isArray(g)) return err(`${at} must be ${SHAPE}, got ${fmt(g)}`);
	for (const f of Object.keys(g)) if (!GOAL_FIELDS.includes(f)) unknown(`${at} has unknown field "${f}"${didYouMean(f, GOAL_FIELDS)} (fields: ${GOAL_FIELDS.join(", ")})`);
	if (g.name !== undefined) {
		if (typeof g.name !== "string" || !g.name.trim()) err(`${at}.name must be a non-empty string, got ${fmt(g.name)}`);
		else if (names.has(g.name)) err(`${at}.name "${g.name}" is already used by goals[${names.get(g.name)}]; goal names must differ`);
		else names.set(g.name, i);
	}
	const kinds = goalKinds(g), kind = kinds[0];
	if (!kinds.length) err(`${at} needs one predicate: ${GOAL_KINDS.join(", ")}`);
	if (kinds.length > 1) err(`${at} names ${kinds.join(" and ")}; a goal takes exactly one of ${GOAL_KINDS.join(", ")} (split it into ${kinds.length} goals)`);
	if (kinds.length === 1 && kind === "moved") {
		if (typeof g.moved !== "string") err(`${at}.moved must be an object ref "object:<id>[.center|.top|.base]", got ${fmt(g.moved)}`);
		else checkRef(spec, err, ctx, `${at}.moved`, g.moved, ["object"]);
	} else if (kinds.length === 1) {
		const pair = g[kind];
		if (!(Array.isArray(pair) && pair.length === 2 && pair.every(r => typeof r === "string"))) err(`${at}.${kind} must be [ref, ref] (two point refs), got ${fmt(pair)}`);
		else pair.forEach((ref, j) => checkRef(spec, err, ctx, `${at}.${kind}[${j}]`, ref));
	}
	if (g.tol !== undefined) {
		if (kinds.length === 1 && kind !== "near") err(`${at}.tol applies to near; ${kind} takes by`);
		else if (!(Number.isFinite(g.tol) && g.tol >= 0)) err(`${at}.tol must be a number >= 0 (metres), got ${fmt(g.tol)}`);
	}
	if (g.by !== undefined) {
		if (kind === "near" && kinds.length === 1) err(`${at}.by applies to above and moved; near takes tol`);
		else if (!Number.isFinite(g.by) || (kind === "moved" && g.by < 0)) err(`${at}.by must be a ${kind === "moved" ? "number >= 0" : "finite number"} (metres), got ${fmt(g.by)}`);
	}
	if (g.mode !== undefined && g.mode !== "all" && g.mode !== "any") err(`${at}.mode must be "all" or "any", got ${fmt(g.mode)}`);
	validateAt(err, at, g.at, opts.frames);
}

/**
 * validateGoals(spec, err, opts)
 * @param {object} spec  the expanded spec
 * @param {(msg: string) => void} err  collects one problem (validate.js)
 * @param {{ sk?: object, scene?: object, frames: number, lenient?: boolean, unknown?: (msg: string) => void }} opts
 */
export function validateGoals(spec, err, opts) {
	if (spec.goals === undefined) return;
	if (!Array.isArray(spec.goals)) return err(`spec.goals must be an array of goals ${SHAPE}, got ${fmt(spec.goals)}`);
	const names = new Map();
	spec.goals.forEach((g, i) => validateGoal(spec, err, opts, g, i, names));
}
