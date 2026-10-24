/**
 * camera-coverage-tools.mjs — camera coverage as three MCP tools.
 *
 * cover_scene lays a coverage pattern (shot-reverse-shot, master and coverage,
 * dialogue singles, walk and talk, action coverage, establish to detail, and
 * for three to six people triangle dialogue, group singles and branching
 * dialogue), check_cuts reports the editing rules at every cut, and
 * check_coverage answers whether the coverage is enough to edit. With an
 * editor connected they run camera.cover, camera.checkCuts and
 * camera.checkCoverage; in memory (one camera, no shot list) cover_scene
 * plans the shots for the in-memory cast and checks the plan's cuts, and the
 * other two read that plan again.
 */
import { checkCuts } from "../src/camera-coverage/cut-rules.js";
import { COVERAGE_PATTERN_IDS, coveragePattern } from "../src/camera-coverage/patterns.js";
import { plannedShot } from "../src/camera-coverage/plan.js";
import { planAnyCoverage } from "../src/camera-coverage/plan-group.js";
import { checkCoverage } from "../src/camera-coverage/completeness.js";
import { resolveCameraRequest } from "../src/camera-coverage/resolve.js";
import { SUBJECT_HEIGHT_M } from "../src/shot.js";
import { resolvedLine } from "./camera-technique-tools.mjs";

/** MCP annotations for the two tools (tool-handlers.mjs TOOL_ANNOTATIONS). */
export const COVERAGE_TOOL_ANNOTATIONS = Object.freeze({
	cover_scene: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
	check_cuts: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	check_coverage: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

const issueLines = (cuts) => cuts.flatMap((cut) => cut.issues.map((issue) => `cut ${cut.cutFrame}  ${issue.severity} ${issue.rule}: ${issue.message} Fix: ${issue.fix.text}.`));

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, cast, findCharacter, filmback, refreshLiveDescription, runStudioCommand, isLive
 */
export function cameraCoverageTools(deps) {
	const { tool, z, text, liveError, state } = deps;
	const rowOf = (character) => ({ id: character.id, name: (character.subject ?? character.name ?? character.id).split(",")[0], x: character.x, z: character.z, rot: character.rot ?? 0, height: SUBJECT_HEIGHT_M * (character.scale ?? 1) });
	const sceneRows = () => deps.cast().filter((row) => !row.hidden).map((row) => ({ ...row, subject: row.subject ?? row.name }));

	function checkPlan() {
		const plan = state.coverage;
		return checkCuts(plan.shots, { cast: sceneRows(), filmback: deps.filmback() });
	}
	function planInMemory({ pattern, castIds, start, end, shots, branches }) {
		const people = sceneRows(), filmback = deps.filmback();
		const plan = planAnyCoverage(pattern, { cast: people.map(rowOf), subjects: castIds, range: { startFrame: start, endFrame: end }, filmback, count: shots, branches });
		state.coverage = { pattern: plan.pattern, shots: plan.shots.map((row) => ({ ...plannedShot(row, filmback), technique: { stack: row.stack }, ...(row.line ? { line: { between: row.line } } : {}),
			coverage: { pattern: plan.pattern, index: row.index, role: row.role, subjectId: row.subjectId, ...(row.setup ? { setup: row.setup, branch: row.branch } : {}) } })) };
		const result = checkPlan();
		return text([
			`Planned ${coveragePattern(plan.pattern).name} over ${start}-${end} (memory: no shot list here; an editor lays these with camera.cover).`,
			...plan.shots.map((row) => `shot ${String(row.index + 1).padStart(2)}  ${row.startFrame}-${row.endFrame}  ${row.name}  [${row.stack.map((item) => item.id).join(" + ")}] side ${row.side}  ${row.plan.label}`),
			...(plan.lines ? plan.lines.map((row) => `line      ${row.between.join("-")}: every camera of the pair on its ${row.side}`) : [`line      every camera on the ${plan.lineSide} of the ${plan.subjects.join("-")} line`]),
			...(plan.branches ? [`branches  ${plan.branches.map((row) => `${row.startFrame}-${row.endFrame}`).join(", ")}: the same setups in each`] : []),
			result.issueCount ? `cuts      ${result.issueCount} issue(s)` : `cuts      ${result.cuts.length} checked, every cut clean`,
			...issueLines(result.cuts),
			...plan.notes.map((note) => `note      ${note}`),
		].join("\n"));
	}

	return [
		tool(
			"cover_scene",
			{
				title: "Cover a scene with a coverage pattern",
				description:
					`Lay several shots at once from a coverage pattern: ${COVERAGE_PATTERN_IDS.join(", ")}; or say it ("cover this conversation", "master and coverage", ` +
					"\"walk and talk\", \"reverse on Joon\", \"cover this three-way argument\", \"branching dialogue, three branches\"). cast names A then B (ids, letters or slots; default the focused character and the nearest other), " +
					"or three to six people for triangle-dialogue and group-singles. Every camera stays on one side of the line between them (each pair on its own side); branching-dialogue repeats one set of setups in each of branches. With an editor connected it runs camera.cover over start_frame..end_frame (or the shot shot_id names, " +
					"default the playhead's) as one undo entry and answers each shot and the cut check; in memory it plans the shots and checks their cuts.",
				inputSchema: {
					request: z.string().min(1).max(300).optional().describe("the coverage in words"),
					pattern: z.enum(COVERAGE_PATTERN_IDS).optional().describe("pattern id"),
					cast: z.array(z.string()).min(1).max(6).optional().describe("A then B (up to six for a group pattern)"),
					branches: z.number().int().min(2).max(8).optional().describe("branching-dialogue: how many branches"),
					start_frame: z.number().int().min(0).optional().describe("first frame"),
					end_frame: z.number().int().min(1).optional().describe("end frame (exclusive)"),
					shots: z.number().int().min(2).max(8).optional().describe("how many shots a repeating pattern lays"),
					shot_id: z.string().optional().describe("editor shot to cover (live only)"),
				},
			},
			async ({ request, pattern, cast, start_frame, end_frame, shots, branches: asked, shot_id, ...admission }) => {
				const named = deps.cast().map((row) => ({ id: row.id, name: row.subject ?? row.name }));
				const routed = request && !pattern ? resolveCameraRequest(request, { cast: named }) : null;
				const chosen = pattern ?? (routed?.action === "camera.cover" ? routed.args.pattern : null);
				if (!chosen) return text(`No coverage pattern in "${request ?? ""}". Name one of ${COVERAGE_PATTERN_IDS.join(", ")}.`);
				const castIds = (cast ?? routed?.args.cast ?? []).map((ref) => deps.findCharacter(ref)?.id ?? ref), branches = asked ?? routed?.args.branches;
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) {
						const range = start_frame !== undefined && end_frame !== undefined ? { range: { startFrame: start_frame, endFrameExclusive: end_frame } } : {};
						return await deps.runStudioCommand({ ...admission, action: "camera.cover",
							args: { pattern: chosen, ...(castIds.length ? { cast: castIds } : {}), ...range, ...(shots ? { shots } : {}), ...(branches ? { branches } : {}), ...(shot_id ? { shotId: shot_id } : {}) } });
					}
					const first = castIds[0] ?? deps.findCharacter(state.focus ?? "A")?.id ?? sceneRows()[0]?.id;
					if (!first) return text("Add a character first; coverage frames the cast.");
					const planned = planInMemory({ pattern: chosen, castIds: [first, ...castIds.slice(castIds[0] ? 1 : 0)], start: start_frame ?? 0, end: (end_frame ?? state.timeline.frameCount) - 1, shots, branches });
					return routed?.action === "camera.cover" ? text(`${planned.content[0].text}\n${resolvedLine(routed)}`) : planned;
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
		tool(
			"check_cuts",
			{
				title: "Check the cuts",
				description:
					"Report the editing rules a script supervisor flags at every cut between consecutive shots: 180-degree line crossings, jump cuts (under 30 degrees " +
					"and one size step), screen-direction flips of a moving subject, and shot-reverse-shot eyelines, each with a severity, the frames and a suggested fix. " +
					"Read only. frame narrows it to the nearest cut. With an editor connected it runs camera.checkCuts; in memory it checks the shots cover_scene planned.",
				inputSchema: {
					frame: z.number().int().min(0).optional().describe("check the cut nearest this frame"),
					request: z.string().max(300).optional().describe("the question in words (\"is the cut at 96 crossing the line?\")"),
				},
			},
			async ({ frame, request }) => {
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) return await deps.runStudioCommand({ action: "camera.checkCuts", args: { ...(Number.isInteger(frame) ? { frame } : {}), ...(request ? { request } : {}) } });
					if (!state.coverage) return text("No shots to check in memory: plan some with cover_scene, or connect an editor.");
					const routed = request ? resolveCameraRequest(request) : null, at = frame ?? routed?.args?.frame;
					let { cuts } = checkPlan();
					if (Number.isInteger(at) && cuts.length) cuts = [cuts.reduce((best, cut) => (Math.abs(cut.cutFrame - at) < Math.abs(best.cutFrame - at) ? cut : best))];
					const issues = issueLines(cuts);
					return text([`${cuts.length} cut(s) checked in the ${state.coverage.pattern} plan: ${issues.length ? `${issues.length} issue(s)` : "no rule broken"}.`, ...issues,
						...cuts.map((cut) => `cut ${cut.cutFrame}  ${cut.fromName} -> ${cut.toName}  ${JSON.stringify(cut.measures)}`), ...(routed?.action === "camera.checkCuts" ? [resolvedLine(routed)] : [])].join("\n"));
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
		tool(
			"check_coverage",
			{
				title: "Check the coverage",
				description:
					"Is there enough here to edit? For a range and cast: a master or establishing shot, at least two sizes of each cast member, a neutral or cutaway " +
					"where the line changes, and the same setups in every branch; each gap with a suggested shot as a technique stack. Read only. With an editor " +
					"connected it runs camera.checkCoverage; in memory it checks the shots cover_scene planned. Say it: \"is my coverage enough to edit?\".",
				inputSchema: {
					request: z.string().max(300).optional().describe("the question in words"),
					cast: z.array(z.string()).min(1).max(6).optional().describe("who must be covered (ids, letters or slots; default everyone the shots are about)"),
					start_frame: z.number().int().min(0).optional().describe("first frame"),
					end_frame: z.number().int().min(1).optional().describe("end frame (exclusive)"),
				},
			},
			async ({ request, cast, start_frame, end_frame }) => {
				try {
					const named = deps.cast().map((row) => ({ id: row.id, name: row.subject ?? row.name }));
					const routed = request ? resolveCameraRequest(request, { cast: named }) : null;
					const castIds = (cast ?? (routed?.action === "camera.checkCoverage" ? routed.args.cast : null) ?? []).map((ref) => deps.findCharacter(ref)?.id ?? ref);
					const range = start_frame !== undefined && end_frame !== undefined ? { startFrame: start_frame, endFrame: end_frame - 1 } : null;
					await deps.refreshLiveDescription();
					if (deps.isLive()) return await deps.runStudioCommand({ action: "camera.checkCoverage", args: { ...(range ? { range: { startFrame: range.startFrame, endFrameExclusive: range.endFrame + 1 } } : {}), ...(castIds.length ? { cast: castIds } : {}), ...(request ? { request } : {}) } });
					if (!state.coverage) return text("No shots to check in memory: plan some with cover_scene, or connect an editor.");
					const report = checkCoverage(state.coverage.shots, { cast: sceneRows().map(rowOf), filmback: deps.filmback() }, { range, castIds: castIds.length ? castIds : null });
					return text([`${report.complete ? "Enough to edit" : `${report.gaps.length} gap(s)`}: the ${state.coverage.pattern} plan over ${report.range.startFrame}-${report.range.endFrame}, ${report.shots} shots, cast ${report.cast.join(", ")}.`,
						`checks    master ${report.checks.master ? "yes" : "no"} · two sizes each ${report.checks.sizes ? "yes" : "no"} · line changes covered ${report.checks.lineChanges ? "yes" : "no"}${report.checks.branches === null ? "" : ` · branches match ${report.checks.branches ? "yes" : "no"}`}`,
						...report.gaps.map((gap) => `gap       ${gap.kind}: ${gap.message} Suggest [${gap.suggest.stack.map((item) => item.id).join(" + ")}]${gap.suggest.subjectId ? ` on ${gap.suggest.subjectId}` : ""}.`),
						...(routed?.action === "camera.checkCoverage" ? [resolvedLine(routed)] : [])].join("\n"));
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
	];
}
