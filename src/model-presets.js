// Pure data + validation helpers for the video models CozyClay can target.
// No DOM, no imports: everything here runs in node tests and in the browser.
// Each preset says where its limits come from (`sources`, read on `checkedAt`);
// a limit no public page confirmed is listed in `unverified` rather than guessed.
// The words a brief uses for each model live in model-profiles.js.

const CHECKED = "2026-10-24";

export const VIDEO_MODEL_PRESETS = [
	{
		id: "seedance-2.5",
		name: "Seedance 2.5",
		vendor: "ByteDance",
		durationsSeconds: [],
		minSeconds: 4,
		maxSeconds: 30,
		fps: 24,
		aspects: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
		maxWidth: 1920,
		maxHeight: 1080,
		checkedAt: CHECKED,
		sources: ["https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"],
		unverified: ["cuts inside one clip"],
		notes: "Clips of 4-30 s at 24 fps, up to 1080p; up to 30 reference images and 10 reference videos (30 s in all). Reference videos for omni runs are 2-30 s each (docs.byteplus.com ModelArk 1520757, 2026-09-09).",
	},
	{
		id: "kling-3",
		name: "Kling 3.0",
		vendor: "Kuaishou",
		aliases: ["kling-2"],
		durationsSeconds: [],
		minSeconds: 3,
		maxSeconds: 15,
		maxShotsPerClip: 6,
		fps: 24,
		aspects: ["16:9", "9:16", "1:1"],
		maxWidth: 1920,
		maxHeight: 1080,
		checkedAt: CHECKED,
		sources: ["https://kling.ai/quickstart/klingai-video-3-model-user-guide", "https://kling.ai/blog/kling-3-15s-video-narrative-control-duration"],
		unverified: ["aspects", "fps"],
		notes: "Clips of 3-15 s at 720p or 1080p; Multi-Shot plans up to six shots in one clip whose lengths add up to the clip; start and end frames supported. Motion Control wants one character, one continuous take and no camera movement.",
	},
	{
		id: "veo-3.1",
		name: "Veo 3.1",
		vendor: "Google",
		aliases: ["veo-3"],
		durationsSeconds: [4, 6, 8],
		fps: 24,
		aspects: ["16:9", "9:16"],
		maxWidth: 1920,
		maxHeight: 1080,
		checkedAt: CHECKED,
		sources: ["https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate", "https://ai.google.dev/gemini-api/docs/veo"],
		unverified: ["cuts inside one clip"],
		notes: "Clips of 4, 6 or 8 s at 24 fps with generated sound; 1080p, reference images and extension need 8 s; first and last frame supported; landscape or portrait only. The Gemini API preview ids were shut down on 2026-10-22; Vertex AI serves the GA ids.",
	},
	{
		id: "minimax-h3",
		name: "MiniMax H3",
		vendor: "MiniMax",
		durationsSeconds: [],
		minSeconds: 4,
		maxSeconds: 15,
		wholeSeconds: true,
		fps: 24,
		aspects: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
		maxWidth: 2560,
		maxHeight: 1440,
		checkedAt: CHECKED,
		sources: ["https://platform.minimax.io/docs/guides/video-generation", "https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md"],
		unverified: ["fps", "cuts inside one clip"],
		notes: "Clips of 4-15 whole seconds at 768P or 2K; a first and a last frame, up to 9 reference images and 3 reference videos (2-15 s each).",
	},
	{
		id: "minimax-h3-selfhosted",
		name: "MiniMax H3 (self-hosted)",
		vendor: "MiniMax",
		durationsSeconds: [],
		maxSeconds: 10,
		fps: 24,
		aspects: ["12:7", "16:9", "9:16"],
		maxWidth: 1540,
		maxHeight: 900,
		checkedAt: CHECKED,
		sources: [],
		unverified: ["maxSeconds", "aspects"],
		notes: "Self-hosted weights: any clip length up to 10s on the studio's own setup; durationsSeconds is empty because the grid is continuous. The hosted API makes 15 s (see MiniMax H3).",
	},
];

const ASPECT_TOLERANCE = 1e-6;

/** A preset by id, or by an older id it replaced (kling-2, veo-3). */
export function presetById(id) {
	return VIDEO_MODEL_PRESETS.find((preset) => preset.id === id) ?? VIDEO_MODEL_PRESETS.find((preset) => preset.aliases?.includes(id));
}

function secondsText(seconds) {
	return `${Number(seconds.toFixed(2))}s`;
}

// shot = { frames, fps, aspect }, preset = one of VIDEO_MODEL_PRESETS.
// Returns { ok, warnings } with one warning per violated limit:
// a clip that is too long for the preset, and an unsupported aspect.
export function checkShotAgainstPreset(shot, preset) {
	const warnings = [];
	if (!preset) return { ok: false, warnings: ["unknown preset"] };

	const seconds = (shot.frames || 0) / (shot.fps || preset.fps);
	if (Array.isArray(preset.durationsSeconds) && preset.durationsSeconds.length > 0) {
		const onGrid = preset.durationsSeconds.some((allowed) => Math.abs(seconds - allowed) < ASPECT_TOLERANCE);
		if (!onGrid) {
			const allowed = preset.durationsSeconds.map(secondsText).join(" or ");
			warnings.push(`${seconds > Math.max(...preset.durationsSeconds) ? "too long" : "off grid"}: ${secondsText(seconds)} is not an allowed clip length for ${preset.name} (allowed: ${allowed})`);
		}
	} else if (Number.isFinite(preset.maxSeconds) && seconds > preset.maxSeconds + ASPECT_TOLERANCE) {
		warnings.push(`too long: ${secondsText(seconds)} exceeds the ${preset.maxSeconds}s limit for ${preset.name}`);
	}
	if (Number.isFinite(preset.minSeconds) && seconds < preset.minSeconds - ASPECT_TOLERANCE) {
		warnings.push(`too short: ${secondsText(seconds)} is under the ${preset.minSeconds}s minimum for ${preset.name}`);
	}

	if (!preset.aspects.includes(shot.aspect)) {
		warnings.push(`aspect ${shot.aspect} is not supported by ${preset.name} (allowed: ${preset.aspects.join(", ")})`);
	}

	return { ok: warnings.length === 0, warnings };
}
