// The director eval set (test/fixtures/director-evals/*.json, README.md
// there): load every scenario row, check the schema, and compare one
// resolution (camera-coverage/route.js routeCameraRequest, or the same fields
// read off an MCP answer) with the row's expected resolution. Shared by
// test/verify-director-evals.mjs and mcp/verify-director-evals.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePhrase } from "../src/camera-techniques/resolve.js";
import { techniqueById } from "../src/camera-techniques/index.js";
import { coveragePattern } from "../src/camera-coverage/patterns.js";

const DIR = new URL("./fixtures/director-evals/", import.meta.url);
export const CATEGORIES = Object.freeze(["size", "angle", "move", "lens", "coverage", "composition", "cuts", "negative", "motivation", "structure"]);
// The motivation actions (camera-motivation): the check, the retime, and the story beats.
const MOTIVATION_KEYS = { "camera.checkMotivation": ["confidence"], "camera.alignMove": ["beat", "edge", "confidence"], "story.addBeat": ["frame", "label", "kind", "confidence"], "story.moveBeat": ["beat", "frame", "confidence"], "story.removeBeat": ["beat", "confidence"] };
// The structure check (intensity-curve): a question about the intensity curve, or a beat it must build into.
const STRUCTURE_KEYS = { "camera.checkStructure": ["beat", "confidence"] };
const ACTIONS = ["camera.applyTechnique", "camera.cover", "camera.checkCuts", "camera.checkCoverage", "camera.setLine", "none", ...Object.keys(MOTIVATION_KEYS), ...Object.keys(STRUCTURE_KEYS)];
const CONFIDENCE = ["high", "medium", "low"];
// The fixture cast every scenario names its people from (ids are what `cast` and `expected.subject` hold).
// Sela (group-coverage) watches the two from 3.4 m off their line; a row brings her in by naming her in its cast.
export const CAST = Object.freeze([{ id: "mara", name: "Mara", x: 0, z: 0, rot: 90 }, { id: "joon", name: "Joon", x: 4, z: 0, rot: -90 }, { id: "sela", name: "Sela", x: 2, z: 3.4, rot: 180 }]);
const FIELDS = ["id", "tier", "category", "request", "cast", "expected", "why"];
const EXPECTED_KEYS = { "camera.applyTechnique": ["stack", "params", "subject", "composition", "confidence"], "camera.cover": ["pattern", "cast", "branches", "confidence"],
	"camera.checkCuts": ["frame", "confidence"], "camera.checkCoverage": ["cast", "confidence"], "camera.setLine": ["between", "confidence"], none: ["confidence"], ...MOTIVATION_KEYS, ...STRUCTURE_KEYS };
const APPLY_KEYS = ["move", "size", "sizes", "height", "screenX", "eyeLineY", "shots", "oneSide", "issues", "setup", "flags", "refused", "complete", "line"];

/** Every scenario row, in file then row order, each with the file it came from. */
export function loadScenarios() {
	return readdirSync(DIR).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
		const file = JSON.parse(readFileSync(new URL(name, DIR), "utf8"));
		return file.scenarios.map((row) => ({ ...row, file: join("test/fixtures/director-evals", name).replaceAll("\\", "/"), fileCategory: file.category }));
	});
}

/** Schema problems across the set (A1): fields, ids, tiers, categories, expected shapes, unique ids and requests, row counts. */
export function schemaErrors(rows) {
	const errors = [], ids = new Set(), requests = new Map(), castIds = CAST.map((row) => row.id);
	const say = (row, message) => errors.push(`${row.id ?? row.file}: ${message}`);
	for (const row of rows) {
		for (const field of FIELDS) if (row[field] === undefined) say(row, `missing ${field}`);
		for (const key of Object.keys(row)) if (![...FIELDS, "apply", "file", "fileCategory"].includes(key)) say(row, `unknown field ${key}`);
		if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(row.id ?? "")) say(row, "id is lowercase words joined by hyphens");
		if (ids.has(row.id)) say(row, "id repeats");
		ids.add(row.id);
		const key = normalizePhrase(row.request);
		if (requests.has(key)) say(row, `request repeats ${requests.get(key)}`);
		requests.set(key, row.id);
		if (!["core", "stretch"].includes(row.tier)) say(row, `tier ${row.tier}`);
		if (!CATEGORIES.includes(row.category) || row.category !== row.fileCategory) say(row, `category ${row.category} in ${row.file}`);
		if (typeof row.why !== "string" || row.why.length < 12 || row.why.length > 200 || /\n/.test(row.why)) say(row, "why is one line of 12-200 characters");
		if (!Array.isArray(row.cast) || row.cast.some((id) => !castIds.includes(id))) say(row, `cast is a list of ${castIds.join(", ")}`);
		const expected = row.expected ?? {};
		if (!ACTIONS.includes(expected.action)) { say(row, `expected.action ${expected.action}`); continue; }
		for (const name of Object.keys(expected)) if (name !== "action" && !EXPECTED_KEYS[expected.action].includes(name)) say(row, `expected.${name} does not go with ${expected.action}`);
		if (expected.confidence && !CONFIDENCE.includes(expected.confidence)) say(row, `confidence ${expected.confidence}`);
		for (const id of [...(expected.stack ?? []), ...Object.keys(expected.params ?? {})]) if (!techniqueById(id)) say(row, `no technique ${id}`);
		if (expected.action === "camera.applyTechnique" && !expected.stack?.length && !expected.composition) say(row, "a technique row names a stack or a composition");
		if (expected.action === "camera.cover" && !coveragePattern(expected.pattern)) say(row, `no pattern ${expected.pattern}`);
		for (const id of [expected.subject, ...(expected.cast ?? []), ...(expected.between ?? [])].filter(Boolean)) if (!row.cast.includes(id)) say(row, `${id} is not in the row's cast`);
		for (const name of Object.keys(row.apply ?? {})) if (!APPLY_KEYS.includes(name)) say(row, `apply.${name} is not a measured result`);
	}
	for (const category of CATEGORIES) {
		const count = rows.filter((row) => row.category === category).length;
		if (count < 5) errors.push(`${category}: ${count} rows, at least 5`);
	}
	if (rows.length < 60) errors.push(`${rows.length} scenarios, at least 60`);
	return errors;
}

// Key order never matters: { place, leadRoom } is { leadRoom, place }.
const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value);
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/**
 * What differs between a row's expected resolution and a got one:
 * { action, stack: [{ id, params? }], subject, composition, pattern, cast, frame, between, branches, confidence }. [] when they agree.
 */
export function resolutionMismatch(expected, got) {
	const problems = [], want = (label, a, b) => { if (!same(a, b)) problems.push(`${label} ${JSON.stringify(b)}, want ${JSON.stringify(a)}`); };
	want("action", expected.action, got.action);
	if (expected.action !== got.action) return problems;
	// A composition-only row wants no technique beside it: an absent stack is an empty one.
	if (expected.action === "camera.applyTechnique") want("stack", expected.stack ?? [], (got.stack ?? []).map((row) => row.id));
	for (const [id, params] of Object.entries(expected.params ?? {})) {
		const own = (got.stack ?? []).find((row) => row.id === id)?.params ?? {};
		for (const [key, value] of Object.entries(params)) want(`${id}.${key}`, value, own[key]);
	}
	if (expected.subject) want("subject", expected.subject, got.subject);
	if (expected.composition) want("composition", expected.composition, got.composition);
	if (expected.pattern) want("pattern", expected.pattern, got.pattern);
	if (expected.cast) want("cast", expected.cast, got.cast);
	if (expected.between) want("between", expected.between, got.between);
	if (expected.branches) want("branches", expected.branches, got.branches);
	if (expected.action === "camera.checkCuts") want("frame", expected.frame, got.frame);
	else if (expected.frame !== undefined) want("frame", expected.frame, got.frame);
	for (const key of ["label", "kind", "beat", "edge"]) if (expected[key] !== undefined) want(key, expected[key], got[key]);
	if (expected.confidence) want("confidence", expected.confidence, got.confidence);
	return problems;
}

/** A routeCameraRequest answer in the fields resolutionMismatch compares. */
export function resolutionOf(routed) {
	const args = routed.args ?? {};
	return { action: routed.action, stack: args.stack, subject: args.subjectId, composition: args.composition, pattern: args.pattern, cast: args.cast, frame: args.frame, between: args.between, branches: args.branches, confidence: routed.confidence,
		label: args.label, kind: args.kind, beat: args.beat, edge: args.edge };
}

/** A receipt states the words it matched (each one in the request) and a confidence (A4). */
export function receiptErrors(request, receipt) {
	const phrase = ` ${normalizePhrase(request)} `, errors = [];
	if (!CONFIDENCE.includes(receipt?.confidence)) errors.push(`confidence ${receipt?.confidence}`);
	if (!Array.isArray(receipt?.matched)) errors.push("no matched words");
	else for (const words of receipt.matched) if (!phrase.includes(` ${words} `) && !phrase.includes(words)) errors.push(`"${words}" is not in the request`);
	if (receipt?.action !== "none" && !receipt?.matched?.length) errors.push("a camera action with no matched words");
	return errors;
}
