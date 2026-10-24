/**
 * intensity-curve-tools.mjs — the intensity curve as one MCP tool.
 *
 * check_structure measures every shot's intensity (size, height, lens,
 * movement, cutting rate, roll, screen jump), each cut's contrast, and reports
 * where the sequence goes flat, peaks off its strongest story beat, or does not
 * build into a reveal, threat or decision, each with a technique stack to
 * apply. With an editor connected it runs camera.checkStructure; in memory it
 * reads the shots cover_scene planned and the move mark_camera_move marked,
 * against the story beats story_beats keeps. strip: true adds the intensity
 * strip as a PNG image (the picture director-packet carries).
 */
import { checkStructure, STRUCTURE_RULES, structureWords } from "../src/intensity-curve/structure.js";
import { resolveStructureRequest } from "../src/intensity-curve/resolve.js";
import { INTENSITY_COMPONENTS } from "../src/intensity-curve/weights.js";
import { stripImage } from "../src/intensity-curve/strip.js";
import { resolvedLine } from "./camera-technique-tools.mjs";
import { encodePng } from "./image-file.mjs";
// The depth tool (check_shots, depth-staging) rides the registry after this one.
export { cameraDepthTools, DEPTH_TOOL_ANNOTATIONS } from "./camera-depth-tools.mjs";

/** MCP annotations (tool-handlers.mjs TOOL_ANNOTATIONS). */
export const STRUCTURE_TOOL_ANNOTATIONS = Object.freeze({
	check_structure: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});
const r2 = (value) => value.toFixed(2);
const shotLine = (row) => `${row.index}. ${row.shotName}  f${row.startFrame}-${row.endFrame}  ${r2(row.combined)}  ${INTENSITY_COMPONENTS.map((c) => `${c.label} ${r2(row.components[c.id])}`).join(", ")}`;
const issueLine = (issue) => `${issue.severity} ${issue.rule} f${issue.frames.join("-")}: ${issue.message} Try: ${issue.suggestion.text}${issue.suggestion.stack.length ? ` (apply_camera_technique ${issue.suggestion.stack.map((row) => row.id).join(" + ")} on ${issue.suggestion.shotId})` : ""}.`;

/** The strip as an MCP image block, from curve rows ({ startFrame, endFrame, components, combined }). */
function stripBlock(shots, beats, issues) {
	const image = stripImage({ shots }, { beats, issues });
	return { type: "image", data: encodePng(image.width, image.height, image.data).toString("base64"), mimeType: "image/png" };
}

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, cast, filmback, framing, refreshLiveDescription, runStudioCommand, isLive
 */
export function intensityCurveTools(deps) {
	const { tool, z, text, liveError, state } = deps;
	const marked = () => {
		if (!state.markedFraming) return [];
		const end = Math.min(state.timeline.frameCount - 1, Math.round(3 * (state.timeline.fps ?? 24)) - 1);
		return [{ id: "marked-move", name: "Marked move", kind: "clip", startFrame: 0, endFrame: end, camera: { mode: "keys" }, cameraKeys: [{ id: "marked-a", frame: 0, framing: state.markedFraming }, { id: "marked-b", frame: end, framing: deps.framing() }] }];
	};
	const shots = () => (state.coverage?.shots?.length ? state.coverage.shots : marked());
	const memoryDocument = () => ({ fps: state.timeline.fps ?? 24, frameCount: state.timeline.frameCount, filmback: deps.filmback(), storyBeats: state.storyBeats ?? [], motion: [],
		cast: deps.cast().filter((row) => !row.hidden).map((row) => ({ ...row, subject: row.subject ?? row.name })), shots: shots() });

	return [
		tool(
			"check_structure",
			{
				title: "Check sequence structure",
				description:
					`The sequence's intensity curve against its story beats ("where does this sequence go flat?", "show me the intensity", "build to the reveal"): per shot the measured ${INTENSITY_COMPONENTS.map((row) => row.label).join(", ")} ` +
					`(each 0-1, weighted into one combined value), each cut's contrast, and issues ${STRUCTURE_RULES.join(", ")}; with no story beats only flat runs. Each issue has frames and a suggestion: ` +
					"a technique stack (one size tighter, low-angle, a longer lens) for apply_camera_technique, and shorter shots in words. Read only. strip: true adds the intensity strip as a PNG. " +
					"With an editor connected it runs camera.checkStructure; in memory it reads the shots cover_scene planned against story_beats.",
				inputSchema: {
					request: z.string().max(300).optional().describe("the question in words (\"where does this sequence go flat?\", \"build to the reveal\")"),
					shot_ids: z.array(z.string()).min(1).max(64).optional().describe("only these shots"),
					beat: z.union([z.string().min(1).max(80), z.number().int().min(0)]).optional().describe("a story beat the sequence must build into"),
					strip: z.boolean().optional().describe("also return the intensity strip image"),
				},
			},
			async ({ request, shot_ids, beat, strip }) => {
				const routed = request ? resolveStructureRequest(request) : null, said = routed ? `\n${resolvedLine(routed)}` : "";
				const into = beat ?? routed?.args.beat;
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) {
						const answer = await deps.runStudioCommand({ action: "camera.checkStructure", args: { ...(shot_ids ? { shotIds: shot_ids } : {}), ...(into !== undefined ? { beat: into } : {}), ...(request ? { request } : {}) } });
						const receipt = strip ? JSON.parse(answer.content[0].text) : null;
						if (!receipt?.ok) return answer;
						const rows = receipt.output.shots.map((row) => ({ ...row, startFrame: row.frames[0], endFrame: row.frames[1] }));
						return { ...answer, content: [...answer.content, stripBlock(rows, receipt.output.beats, receipt.output.issues)] };
					}
					if (!shots().length) return text(`No shots to read in memory: plan some with cover_scene, or connect an editor.${said}`);
					const result = checkStructure(memoryDocument(), { range: shot_ids ? { shotIds: shot_ids } : null, beat: into ?? null });
					const body = text([
						`${result.curve.shots.length} shot(s) (${state.coverage ? `the ${state.coverage.pattern} plan` : "the marked move"}; rules ${result.rules.join(", ")}): ${structureWords(result)} ${result.issueCount ? `${result.issueCount} issue(s).` : "No issue."}`,
						...result.curve.shots.map(shotLine),
						...result.curve.cuts.map((cut) => `cut f${cut.cutFrame}  contrast ${r2(cut.total)}`),
						...result.issues.map(issueLine),
						`beats     ${result.beats.length ? result.beats.map((row) => `${row.kind} "${row.label}" at f${row.frame}`).join(", ") : "none (story_beats adds them; without them only flat runs)"}`,
					].join("\n") + said);
					return strip ? { ...body, content: [...body.content, stripBlock(result.curve.shots, result.beats, result.issues)] } : body;
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
	];
}
