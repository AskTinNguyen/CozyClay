#!/usr/bin/env node
// Director evals: every scenario in test/fixtures/director-evals/*.json (a
// director's request, its cast and the expected resolution, README.md there)
// resolves through the one router camera.applyTechnique uses
// (camera-coverage/route.js), states its matched words and a confidence, and
// the rows marked `apply` run through the command bus in memory
// (test/director-evals-apply.mjs) where the measured result is asserted: the
// move classifier verdict, the size step, camera height, the side of the
// line, the composition and the camera.checkCuts flags. Core rows are a gate;
// stretch rows are a score with the failing ids listed.
import { routeCameraRequest } from "../src/camera-coverage/route.js";
import { CAST, CATEGORIES, loadScenarios, receiptErrors, resolutionMismatch, resolutionOf, schemaErrors } from "./director-evals-data.mjs";
import { applyScenarios } from "./director-evals-apply.mjs";

const rows = loadScenarios(), errors = schemaErrors(rows);
if (errors.length) {
	for (const message of errors) console.log(`FAIL schema ${message}`);
	console.log(`\nschema: ${errors.length} problems`);
	process.exit(1);
}
// The schema check itself catches a repeated request, an unknown category and a missing why.
const broken = schemaErrors([...rows, { ...rows[0], id: "broken-row", why: undefined }, { ...rows[1], id: "broken-cat", request: "a fresh request", category: "sound" }]);
if (!["request repeats", "missing why", "category sound"].every((part) => broken.some((message) => message.includes(part)))) { console.log(`FAIL schema self-check: ${broken.join("; ")}`); process.exit(1); }
console.log(`ok - schema: ${rows.length} scenarios, ${CATEGORIES.length} categories (${CATEGORIES.map((name) => `${name} ${rows.filter((row) => row.category === name).length}`).join(", ")}), ids and requests unique`);

// Resolution: the router's answer against the expected one, plus the receipt words.
const results = new Map();
for (const row of rows) {
	const cast = CAST.filter((member) => row.cast.includes(member.id)), routed = routeCameraRequest(row.request, { cast });
	const problems = [...resolutionMismatch(row.expected, resolutionOf(routed)), ...receiptErrors(row.request, routed).map((message) => `receipt: ${message}`)];
	results.set(row.id, { row, problems, routed });
}

// Applied outcome: the rows marked apply, through the bus in memory.
const applied = await applyScenarios(rows.filter((row) => row.apply));
for (const [id, outcome] of applied) {
	const result = results.get(id);
	result.applied = outcome;
	result.problems.push(...outcome.problems.map((message) => `applied: ${message}`));
}

const passed = (result) => result.problems.length === 0;
let coreFailures = 0;
for (const result of results.values()) {
	const { row, problems, routed } = result;
	const said = `${row.id} [${row.tier}] "${row.request}" -> ${routed.action}${routed.args?.stack ? ` ${routed.args.stack.map((item) => item.id).join("+")}` : ""}${routed.args?.pattern ? ` ${routed.args.pattern}` : ""} (${routed.confidence}: ${routed.matched.join(", ") || "-"})`;
	if (passed(result)) console.log(`ok - ${said}${result.applied ? ` | applied: ${result.applied.line}` : ""}`);
	else {
		console.log(`${row.tier === "core" ? "FAIL" : "MISS"} ${said}\n      ${problems.join("\n      ")}`);
		if (row.tier === "core") coreFailures += 1;
	}
}

console.log("");
const tally = (list) => `${list.filter(passed).length}/${list.length}`;
for (const category of CATEGORIES) {
	const all = [...results.values()].filter((result) => result.row.category === category);
	const core = all.filter((result) => result.row.tier === "core"), stretch = all.filter((result) => result.row.tier === "stretch");
	const missing = stretch.filter((result) => !passed(result)).map((result) => result.row.id);
	console.log(`${category}: core ${tally(core)}, stretch ${tally(stretch)}${missing.length ? ` (failing: ${missing.join(", ")})` : ""}, applied ${all.filter((result) => result.applied).length}`);
}
const all = [...results.values()], core = all.filter((result) => result.row.tier === "core"), stretch = all.filter((result) => result.row.tier === "stretch");
const negatives = all.filter((result) => result.row.category === "negative");
console.log(`negatives: ${negatives.filter((result) => result.routed.action === "none").length}/${negatives.length} resolve to no camera action, ${negatives.filter((result) => result.applied?.problems.length === 0).length} refused by the bus`);
console.log(`receipts: ${all.filter((result) => !result.problems.some((message) => message.startsWith("receipt:"))).length}/${all.length} state their matched words and a confidence`);
const appliedAll = all.filter((result) => result.applied);
console.log(`applied: ${appliedAll.filter((result) => result.applied.problems.length === 0).length}/${appliedAll.length} measured results hold through the bus`);
const stretchMissing = stretch.filter((result) => !passed(result)).map((result) => result.row.id);
console.log(`\ncore: ${tally(core)}  stretch: ${tally(stretch)}${stretchMissing.length ? ` (failing: ${stretchMissing.join(", ")})` : ""}  total: ${tally(all)}`);
process.exit(coreFailures ? 1 : 0);
