/**
 * camera-depth-tools.mjs — depth staging as one MCP tool (depth-staging A6).
 *
 * check_shots reads what each shot's camera does with the set over sampled
 * frames: the subject's eyes hidden by a prop or another person (occluded),
 * the lens inside a prop or nearer than the near clip (inside), a frame edge
 * at the ankle, knee, waist or neck (crop). Each issue has a severity, the
 * frames and a fix; each shot lists its depth layers. Read only. With an
 * editor connected it runs camera.checkShots (camera.fixShot applies a fix
 * through studio_run); in memory it reads the shots cover_scene planned
 * against the in-memory set.
 */
import { checkShots, SHOT_RULES } from "../src/camera-depth/shot-checks.js";
import { resolveShotCheck } from "../src/camera-depth/resolve.js";
import { depthWords } from "../src/camera-depth/layers.js";
import { resolvedLine } from "./camera-technique-tools.mjs";

/** MCP annotations (tool-handlers.mjs TOOL_ANNOTATIONS). */
export const DEPTH_TOOL_ANNOTATIONS = Object.freeze({
	check_shots: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});
const issueLine = (shot, issue) => `${shot.name}  ${issue.severity} ${issue.rule} f${issue.frames.join(",")}: ${issue.message} Fix: ${issue.fix.text}.`;

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, cast, scene, filmback, refreshLiveDescription, runStudioCommand, isLive
 */
export function cameraDepthTools(deps) {
	const { tool, z, text, liveError, state } = deps;
	const memoryScene = () => ({ cast: deps.cast().filter((row) => !row.hidden).map((row) => ({ ...row, subject: row.subject ?? row.name })), objects: deps.scene()?.objects ?? [], filmback: deps.filmback() });
	return [
		tool(
			"check_shots",
			{
				title: "Check shots against the set",
				description:
					`What each shot's camera does with the set, at its first and last frame and every k frames between ("is anything blocking her face?", "is the camera inside the wall?", "does the frame cut Mara at the knees?", "check my shots"): ${SHOT_RULES.join(", ")}. ` +
					"occluded: the subject's eyes hidden from the lens by a prop or another person at either end or on over a quarter of the samples; inside: the lens inside a prop or nearer than the 10 cm near clip; " +
					"crop: a frame edge at the ankle, knee, waist or neck. Each issue has a severity, the frames and a fix (raise or lower by d m, slide left or right by d m, one size step); each shot lists its depth layers " +
					"(foreground, midground, background). Read only. With an editor connected it runs camera.checkShots (studio_run camera.fixShot applies a fix); in memory it reads the shots cover_scene planned against the set.",
				inputSchema: {
					request: z.string().max(300).optional().describe("the question in words (\"is anything blocking her face?\")"),
					rule: z.enum(SHOT_RULES).optional().describe("keep one rule"),
					shot_ids: z.array(z.string()).min(1).max(64).optional().describe("only these shots"),
				},
			},
			async ({ request, rule, shot_ids }) => {
				const routed = request ? resolveShotCheck(request) : null, said = routed ? `\n${resolvedLine(routed)}` : "";
				const kept = rule ?? routed?.args.rule;
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) return await deps.runStudioCommand({ action: "camera.checkShots", args: { ...(shot_ids ? { shotIds: shot_ids } : {}), ...(rule ? { rule } : {}), ...(request ? { request } : {}) } });
					if (!state.coverage?.shots?.length) return text(`No shots to check in memory: plan some with cover_scene, or connect an editor.${said}`);
					const report = checkShots(state.coverage.shots, memoryScene(), { rule: kept ?? null, shotIds: shot_ids ?? null });
					return text([
						`${report.shots.length} shot(s) checked in the ${state.coverage.pattern} plan${kept ? ` for ${kept}` : ""} (rules ${kept ?? SHOT_RULES.join(", ")}): ${report.issueCount ? `${report.issueCount} issue(s) on ${report.flagged} shot(s)` : "nothing blocks a face, no lens in the set, no edge at a joint"}.`,
						...report.shots.flatMap((shot) => shot.issues.map((issue) => issueLine(shot, issue))),
						...report.shots.map((shot) => `depth     ${shot.name}: ${depthWords(shot.layers, shot.subjectName) ?? (shot.unjudged ? `not judged (${shot.unjudged})` : "the subject alone")}`),
					].join("\n") + said);
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
	];
}
