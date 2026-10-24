/**
 * camera-motivation-tools.mjs — camera motivation as two MCP tools.
 *
 * check_motivation reports why each camera move happens: a story beat, a motion
 * beat, its subject, or nothing (then a fix). story_beats adds, moves, removes
 * and lists the authored story beats the check reads. With an editor connected
 * they run camera.checkMotivation and story.addBeat / moveBeat / removeBeat;
 * in memory (no shot list, no installed takes) the check reads the shots
 * cover_scene planned, and the move mark_camera_move marked (from the marked
 * framing to the camera now, over 3 s from frame 0, as describe_camera_move
 * names it), against the beats kept here and the subjects' travel, and says
 * that motion beats were not read.
 */
import { checkMotivation, DEFAULT_TOLERANCE } from "../src/camera-motivation/check.js";
import { resolveMotivationRequest } from "../src/camera-motivation/resolve.js";
import { findStoryBeat, nextStoryBeatId, repairStoryBeats, STORY_BEAT_KINDS, storyBeatWords } from "../src/camera-motivation/story-beats.js";
import { resolvedLine } from "./camera-technique-tools.mjs";

/** MCP annotations for the two tools (tool-handlers.mjs TOOL_ANNOTATIONS). */
export const MOTIVATION_TOOL_ANNOTATIONS = Object.freeze({
	check_motivation: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	story_beats: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
});
const MEMORY_NOTE = "memory: no takes are installed here, so motion beats are not read; story beats and subject travel only";

const issueLine = (issue) => `move ${issue.shotId} f${issue.frames.join("-")}  ${issue.severity} ${issue.rule}: ${issue.message} Fix: ${issue.fix.text}.`;
const moveLine = (shot, segment) => `${shot.shotName}  f${segment.startFrame}-${segment.endFrame}  ${segment.moveId}  ${segment.motivation.by ? `motivated by ${segment.motivation.by === "beat" ? `${segment.motivation.beat.source} beat ${segment.motivation.beat.name} (f${segment.motivation.beat.frame})` : `its subject (${segment.motivation.how})`}` : "unmotivated"}`;

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, cast, filmback, framing, refreshLiveDescription, runStudioCommand, isLive
 */
export function cameraMotivationTools(deps) {
	const { tool, z, text, liveError, state } = deps;
	const beats = () => (state.storyBeats ??= []);
	const said = (routed) => (routed ? `\n${resolvedLine(routed)}` : "");
	const marked = () => {
		if (!state.markedFraming) return [];
		const end = Math.min(state.timeline.frameCount - 1, Math.round(3 * (state.timeline.fps ?? 24)) - 1);
		return [{ id: "marked-move", name: "Marked move", kind: "clip", startFrame: 0, endFrame: end, camera: { mode: "keys" }, cameraKeys: [{ id: "marked-a", frame: 0, framing: state.markedFraming }, { id: "marked-b", frame: end, framing: deps.framing() }] }];
	};
	const shots = () => [...(state.coverage?.shots ?? []), ...marked()];
	const memoryDocument = () => ({ fps: state.timeline.fps ?? 24, frameCount: state.timeline.frameCount, filmback: deps.filmback(), storyBeats: beats(), motion: [],
		cast: deps.cast().filter((row) => !row.hidden).map((row) => ({ ...row, subject: row.subject ?? row.name })), shots: shots() });

	return [
		tool(
			"check_motivation",
			{
				title: "Check camera motivation",
				description:
					"Why each camera move happens: every move segment of every shot is motivated by a beat (an authored story beat, or with an editor a motion beat of an " +
					"installed take: steps, turns, reaches, jumps, landings), by its subject (a follow camera, a mount, a tracking rail, a camera that keeps a travelling " +
					`subject on screen), or unmotivated; a beat more than tolerance frames (default ${DEFAULT_TOLERANCE}) from the move's start or rest is flagged ` +
					"starts-off-beat / settles-off-beat. Each issue has a severity, the frames and a fix (hold, or camera.alignMove). Holds are never flagged. Read only. " +
					"With an editor connected it runs camera.checkMotivation; in memory it checks the shots cover_scene planned against story_beats and the subjects' travel.",
				inputSchema: {
					request: z.string().max(300).optional().describe("the question in words (\"is this move motivated?\")"),
					shot_ids: z.array(z.string()).min(1).max(32).optional().describe("only these shots"),
					tolerance: z.number().int().min(1).max(48).optional().describe("frames a beat may sit from the move's start or rest"),
				},
			},
			async ({ request, shot_ids, tolerance }) => {
				const routed = request ? resolveMotivationRequest(request) : null;
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) return await deps.runStudioCommand({ action: "camera.checkMotivation", args: { ...(shot_ids ? { shotIds: shot_ids } : {}), ...(tolerance ? { tolerance } : {}), ...(request ? { request } : {}) } });
					if (!shots().length) return text(`No shots to check in memory (${MEMORY_NOTE}): plan some with cover_scene or mark a move with mark_camera_move, or connect an editor.${said(routed)}`);
					const result = checkMotivation(memoryDocument(), { tolerance, shotIds: shot_ids });
					return text([
						`${result.segments} move(s) in ${result.shots.length} shot(s) checked (${[state.coverage ? `the ${state.coverage.pattern} plan` : null, state.markedFraming ? "the marked move" : null].filter(Boolean).join(" and ")}; ${MEMORY_NOTE}): ${result.issueCount ? `${result.issueCount} issue(s)` : "every move has its reason"}.`,
						...result.shots.flatMap((shot) => shot.segments.map((segment) => moveLine(shot, segment))),
						...result.issues.map(issueLine),
						`beats     ${beats().length ? beats().map(storyBeatWords).join(", ") : "none (add some with story_beats)"}`,
					].join("\n") + said(routed));
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
		tool(
			"story_beats",
			{
				title: "Story beats",
				description:
					`Author the story beats a camera move answers to (a line, a reveal, a decision): add (frame, label, kind ${STORY_BEAT_KINDS.join(" | ")}), move (beat, frame), ` +
					"remove (beat), or list; beat is an id, a label, or a frame near it. Or say it (\"add a beat 'confession' at 120\", \"move the beat 'confession' to 130\"). " +
					"With an editor connected it runs story.addBeat / story.moveBeat / story.removeBeat (one undo entry each), and lists through story.listBeats (every beat with its id, frame, label and kind); in memory it keeps the beats check_motivation reads.",
				inputSchema: {
					request: z.string().max(300).optional().describe("the beat edit in words"),
					op: z.enum(["add", "move", "remove", "list"]).optional().describe("what to do (default add with frame and label, else list)"),
					frame: z.number().int().min(0).optional().describe("the beat's frame"),
					label: z.string().min(1).max(80).optional().describe("what happens (\"Mara makes her admission\")"),
					kind: z.enum(STORY_BEAT_KINDS).optional().describe("the kind of beat"),
					beat: z.union([z.string().min(1).max(80), z.number().int().min(0)]).optional().describe("the beat to move or remove"),
				},
			},
			async ({ request, op, frame, label, kind, beat }) => {
				const routed = request ? resolveMotivationRequest(request) : null, args = routed?.action?.startsWith("story.") ? routed.args : {};
				const action = op ? { add: "story.addBeat", move: "story.moveBeat", remove: "story.removeBeat", list: null }[op] : routed?.action?.startsWith("story.") ? routed.action : frame !== undefined && label ? "story.addBeat" : null;
				const merged = { ...args, ...(frame !== undefined ? { frame } : {}), ...(label ? { label } : {}), ...(kind ? { kind } : {}), ...(beat !== undefined ? { beat } : {}) };
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) {
						if (!action) return await deps.runStudioCommand({ action: "story.listBeats", args: {} });
						return await deps.runStudioCommand({ action, args: { ...merged, ...(request ? { request } : {}) } });
					}
					if (action === "story.addBeat") {
						if (!Number.isInteger(merged.frame) || !merged.label) return text("A story beat needs a frame and a label.");
						state.storyBeats = repairStoryBeats([...beats(), { id: nextStoryBeatId(beats()), frame: merged.frame, label: merged.label, kind: merged.kind ?? "event" }], state.timeline.frameCount);
					} else if (action) {
						const found = findStoryBeat(beats(), merged.beat);
						if (!found) return text(`No story beat matches ${JSON.stringify(merged.beat)}; the beats are ${beats().map(storyBeatWords).join(", ") || "none"}.${said(routed)}`);
						state.storyBeats = action === "story.removeBeat" ? beats().filter((row) => row.id !== found.id)
							: repairStoryBeats(beats().map((row) => (row.id === found.id ? { ...row, frame: merged.frame ?? row.frame, ...(merged.label && action === "story.moveBeat" && op ? { label: merged.label } : {}) } : row)), state.timeline.frameCount);
					}
					return text(`${beats().length} story beat(s) in memory: ${beats().map((row) => `${row.id} ${storyBeatWords(row)}`).join(", ") || "none"}.${said(routed)}`);
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
	];
}
