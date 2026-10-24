/**
 * render-prompt-tool.mjs — render_prompt: the shot under the camera, or the
 * whole sequence, as a prompt for an AI image or video model.
 *
 * scope "shot" (the default) composes one shot's prompt from the camera, the
 * cast and the set, stating an applied technique and the camera capabilities.
 * scope "sequence" writes the sequence brief (src/shot-prompt-engine): with an
 * editor connected over its shots, in memory over the shots cover_scene
 * planned. profile shapes either for a video model (model-profiles.js) and
 * lists what breaks its limits, with a fix.
 */
import { CAMERA_MOVES, IMAGE_MODELS, VIDEO_MODELS, composePrompt, slateLine } from "../src/shot.js";
import { MODEL_PROFILES, profileById } from "../src/model-profiles.js";
import { buildSequencePrompt } from "../src/shot-prompt-engine/sequence.js";
import { sequenceDocument } from "../src/shot-prompt-engine/document.js";
import { shotAtFrame } from "../src/cuts.js";
import { promptTechnique } from "./camera-technique-tools.mjs";
import { promptCapabilities } from "./camera-capability-tools.mjs";

const PROFILE_IDS = MODEL_PROFILES.flatMap((profile) => [profile.id, ...(profile.aliases ?? [])]);
const modelById = (id) => [...VIDEO_MODELS, ...IMAGE_MODELS].find((m) => m.id === id) ?? null;
const warningLines = (warnings) => warnings.map((row) => `- ${row.message} Fix: ${row.fix}`);

/**
 * The sequence document: the editor's shots (and story beats) when one is connected, else the shots
 * cover_scene planned and the beats story_beats keeps in memory. render_packet reads the same one.
 */
export function promptDocument(deps, live, { environment, style } = {}) {
	const { state } = deps, sc = deps.scene(), st = deps.stage(), shots = live ? sc?.shotDocument?.shots ?? [] : state.coverage?.shots ?? [];
	return sequenceDocument({ title: sc?.name ?? state.doc?.name, shots, characters: st.characters ?? [], objects: sc?.objects ?? [], fps: state.timeline.fps ?? 24, aspect: st.shotAspect ?? "16:9", filmback: deps.filmback(),
		frameCount: Math.max(state.timeline.frameCount ?? 0, 1 + Math.max(0, ...shots.map((shot) => shot.endFrame))), activeCharacterId: deps.findCharacter(state.focus)?.id ?? null,
		look: style, environment: environment ?? st.environment, environmentImage: st.environmentImage, stage: st, storyBeats: live ? sc?.shotDocument?.storyBeats ?? sc?.storyBeats ?? [] : state.storyBeats ?? [] });
}

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, scene, stage, findCharacter, filmback, currentShot, refreshLiveDescription, isLive
 */
export function renderPromptTool(deps) {
	const { tool, z, text, liveError, state } = deps;

	const documentFor = (live, environment, style) => promptDocument(deps, live, { environment, style });

	function sequence({ environment, style, profile, from_shot, to_shot }) {
		const live = deps.isLive(), document = documentFor(live, environment, style);
		if (!document.shots.length) return text(live ? "The editor has no shots yet: add one (shot.create) or cover the scene (cover_scene)." : "No shots in memory: plan some with cover_scene, or connect an editor.");
		const brief = buildSequencePrompt(document, { range: { from: from_shot, to: to_shot }, profile: profile ?? null });
		const missing = brief.references.missing.map((row) => (row.subject ? `${row.role} for ${row.subject}` : row.role));
		return text(`${brief.text}\n\nreferences.json: ${brief.references.entries.length} stills by role${missing.length ? `; missing ${missing.join(", ")}` : ""}${live ? "" : " (memory: frames are exported by an editor's keyframe pack)"}.`);
	}

	return tool(
		"render_prompt",
		{
			title: "Render the AI prompt for this shot or the whole sequence",
			description:
				"Turn the current camera, cast and set into a prompt for an AI image or video model. " +
				"The prompt carries the real framing — shot size, lens, angle and level — so the " +
				"generated frame matches the blocking. scope sequence writes one brief for a range of shots: a header, the cast, " +
				"numbered beats with timecodes (the classifier's camera words, the measured move in m, m/s, deg/s and mm, size, angle, lens, " +
				"composition, coverage role, transition, story beats from motion) and a continuity line. profile shapes it for a video model " +
				"(its lengths, aspects and phrasing) and lists what breaks its limits with a fix.",
			inputSchema: {
				mode: z.enum(["image", "video"]).default("video").describe("still or moving (scope shot)"),
				scope: z.enum(["shot", "sequence"]).default("shot").describe("one shot, or a brief for a range of shots"),
				profile: z.enum(PROFILE_IDS).optional().describe(`video model profile: ${MODEL_PROFILES.map((row) => `${row.id} (${row.name})`).join(", ")}`),
				from_shot: z.number().int().min(1).optional().describe("scope sequence: first shot (1-based, time order)"),
				to_shot: z.number().int().min(1).optional().describe("scope sequence: last shot (inclusive)"),
				model: z.string().optional().describe(`target model id (scope shot). video: ${VIDEO_MODELS.map((m) => m.id).join(", ")}. image: ${IMAGE_MODELS.map((m) => m.id).join(", ")}`),
				environment: z.string().optional().describe('the real setting, e.g. "a rain-slicked Seoul side street at night"'),
				style: z.string().default("cinematic film still, natural light").describe('look and grade, e.g. "shot on 35mm film, warm practical light"'),
				camera_move: z.string().default(CAMERA_MOVES[0]).describe(`camera move (scope shot). Known: ${CAMERA_MOVES.filter((m) => m !== "Custom…").join(", ")}`),
				pose_phrase: z.string().default("").describe("what character A is doing"),
				pose2_phrase: z.string().default("").describe("what character B is doing"),
			},
		},
		async ({ mode, scope, profile, from_shot, to_shot, model, environment, style, camera_move, pose_phrase, pose2_phrase }) => {
			if (deps.isLive()) {
				try {
					await deps.refreshLiveDescription();
				} catch (error) {
					return liveError(error);
				}
			}
			if (scope === "sequence") return sequence({ environment, style, profile, from_shot, to_shot });
			// An applied camera technique speaks for a default camera_move, in the words its classifier proved.
			const live = deps.isLive(), st = deps.stage(), technique = promptTechnique(state, deps.scene(), live), byTechnique = Boolean(technique) && camera_move === CAMERA_MOVES[0];
			const known = CAMERA_MOVES.includes(camera_move);
			// composePrompt frames two subjects: the one the camera is on, then the next visible member of the cast.
			const framed = deps.findCharacter(state.focus) ?? st.characters[0];
			const other = st.characters.find((c) => c !== framed && !c.hidden) ?? null;
			const prompt = composePrompt({
				mode, model: modelById(model) ?? undefined, shot: deps.currentShot(), subject: framed.subject, subject2: other?.subject ?? null,
				posePhrase: pose_phrase, pose2Phrase: other ? pose2_phrase : "", environment: environment ?? "", style,
				cameraMove: known && !byTechnique ? camera_move : "Custom…", customMove: byTechnique ? technique.phrase : known ? "" : camera_move,
				hasCharSheet: st.hasCharSheet === true, hasEnvSheet: false,
			});
			const rig = promptCapabilities(state, deps.scene(), live).filter((words) => !technique?.phrase?.includes(words)); // roll, focus, shake, mount, speed, shutter the technique has not said
			// A profile checks the shot under the playhead (live) against the model's limits.
			const liveShot = live && profile ? shotAtFrame(deps.scene()?.shotDocument?.shots ?? [], state.timeline.currentFrame) : null;
			const checked = liveShot ? buildSequencePrompt(documentFor(true, environment, style), { range: { shotIds: [liveShot.id] }, profile }).warnings : [];
			const fit = profile ? `\nprofile ${profileById(profile).name}: ${checked.length ? `\n${warningLines(checked).join("\n")}` : liveShot ? "the shot fits" : "no editor shot to check"}` : "";
			return text(`${slateLine(deps.currentShot())}${technique ? `\ntechnique ${technique.label}: ${technique.phrase}` : ""}${rig.length ? `\nrig ${rig.join("; ")}` : ""}${fit}\n\n${prompt}${rig.length ? ` Camera: ${rig.join("; ")}.` : ""}`);
		},
	);
}
