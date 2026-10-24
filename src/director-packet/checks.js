// The checks a director packet reports (director-packet A1): each is one of
// the Studio's existing checks, run over the packet's range, its findings
// turned into flags on the shot they belong to or, when they belong to the
// whole range, into notes. The packet adds no check of its own (Non-Goals).
// A feature that has not landed simply has no entry here, so the packet
// leaves its section out. Pure.
import { checkCuts } from "../camera-coverage/cut-rules.js";
import { checkCoverage } from "../camera-coverage/completeness.js";
import { checkMotivation } from "../camera-motivation/check.js";
import { checkShotAgainstPreset, presetById } from "../model-presets.js";

const flag = (check, shotId, rule, severity, message, frames = null) => ({ check, shotId, rule, severity, message, ...(frames ? { frames } : {}) });

/** camera.checkCuts over the range: a cut's issue is the incoming shot's flag. */
function cuts({ shots, scene }) {
	const result = checkCuts(shots, scene);
	const flags = result.cuts.flatMap((cut) => cut.issues.map((issue) => flag("cuts", cut.to, issue.rule, issue.severity, issue.message, issue.frames)));
	return { summary: `${result.cuts.length} ${result.cuts.length === 1 ? "cut" : "cuts"}, ${result.issueCount} flagged`, flags, notes: [] };
}

/** camera.checkCoverage over the range: a gap on a shot is its flag; the rest (no master, a cast member's sizes, a line change) are notes. */
function coverage({ shots, scene }) {
	if (!shots.length) return null;
	const range = { startFrame: shots[0].startFrame, endFrame: shots.at(-1).endFrame }, result = checkCoverage(shots, scene, { range });
	const flags = [], notes = [];
	for (const gap of result.gaps) {
		const suggest = gap.suggest?.text ? ` Try: ${gap.suggest.text}.` : "";
		if (gap.shotId) flags.push(flag("coverage", gap.shotId, gap.kind, "medium", `${gap.message}${suggest}`));
		else notes.push({ check: "coverage", rule: gap.kind, severity: "medium", message: `${gap.message}${suggest}`, ...(gap.frames ? { frames: gap.frames } : {}) });
	}
	return { summary: result.complete ? `enough to edit: ${result.shots} shots, ${result.cast.length} cast` : `${result.gaps.length} ${result.gaps.length === 1 ? "gap" : "gaps"} in ${result.shots} shots`, flags, notes };
}

/** camera.checkMotivation over the range's shots, against the story beats and motion beats. */
function motivation({ document, shots, placeAt }) {
	const result = checkMotivation(document, { shotIds: shots.map((shot) => shot.id), placeAt });
	const flags = result.issues.map((issue) => flag("motivation", issue.shotId, issue.rule, issue.severity, `${issue.message} Fix: ${issue.fix.text}.`, issue.frames));
	return { summary: `${result.segments} ${result.segments === 1 ? "move" : "moves"}, ${result.issueCount} flagged`, flags, notes: [] };
}

/** The shot check the timeline badges: a shot aimed at a video model, against that model's clip lengths and aspects. */
function shot({ document, shots }) {
	const aimed = shots.filter((row) => row.targetModel && presetById(row.targetModel));
	if (!aimed.length) return null;
	const flags = aimed.flatMap((row) => checkShotAgainstPreset({ frames: row.endFrame - row.startFrame + 1, fps: document.fps ?? 24, aspect: row.aspect ?? document.aspect }, presetById(row.targetModel))
		.warnings.map((words) => flag("shot", row.id, words.split(":")[0].replace(/\s+/g, "-"), "low", words)));
	return { summary: `${aimed.length} ${aimed.length === 1 ? "shot" : "shots"} aimed at a model, ${flags.length} flagged`, flags, notes: [] };
}

/** Every check the packet reports, in the order its notes list them. A check that answers null has nothing to say for this range and is left out. */
export const PACKET_CHECKS = Object.freeze([
	{ id: "cuts", label: "Cuts", run: cuts },
	{ id: "coverage", label: "Coverage", run: coverage },
	{ id: "motivation", label: "Motivation", run: motivation },
	{ id: "shot", label: "Shot", run: shot },
]);

/**
 * @param {{ document, shots, scene, placeAt }} context  the range's shots in time order and the check scene
 * @returns {{ checks: Array<{ id, label, summary, flagCount }>, flags: Array, notes: Array }}
 */
export function runPacketChecks(context, checks = PACKET_CHECKS) {
	const ran = checks.map((check) => ({ check, result: check.run(context) })).filter((row) => row.result);
	return {
		checks: ran.map(({ check, result }) => ({ id: check.id, label: check.label, summary: result.summary, flagCount: result.flags.length + result.notes.length })),
		flags: ran.flatMap((row) => row.result.flags), notes: ran.flatMap((row) => row.result.notes),
	};
}
