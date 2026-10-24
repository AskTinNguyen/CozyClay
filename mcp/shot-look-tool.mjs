/**
 * shot-look-tool.mjs — shot looks and the colour script as one MCP tool.
 *
 * shot_look sets a shot's own look (a look recipe in story words, a partial
 * stage look, an intended palette, a nudge such as "colder", or another shot's
 * look) or, with nothing to change ("colour script for this scene", read:
 * true), reads the colour script: each shot's look, intended palette, palette
 * measured from its middle frame, and the colour change across each cut. With
 * an editor connected it runs shot.setLook / shot.colourScript; in memory it
 * works on the shots cover_scene planned (the look is stored on them, so render_prompt and
 * render_packet read it; planned tones only: nothing renders).
 * image: true adds the colour script as a PNG.
 */
import { resolveLookRequest } from "../src/colour-script/resolve.js";
import { editShotLook, LOOK_EDIT_KEYS, lookText } from "../src/colour-script/edit.js";
import { LOOK_ADJUSTMENTS, LOOK_RECIPE_IDS, LOOK_RECIPES } from "../src/colour-script/recipes.js";
import { colourCutWords, colourScript, colourScriptWords } from "../src/colour-script/script.js";
import { colourScriptImage } from "../src/colour-script/image.js";
import { resolvedLine } from "./camera-technique-tools.mjs";
import { encodePng } from "./image-file.mjs";

/** MCP annotations (tool-handlers.mjs TOOL_ANNOTATIONS). */
export const LOOK_TOOL_ANNOTATIONS = Object.freeze({
	shot_look: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
});
const KEYS = { shot_id: "shotId", same_as: "sameAs" };
const imageBlock = (script) => {
	const image = colourScriptImage(script);
	return { type: "image", data: encodePng(image.width, image.height, image.data).toString("base64"), mimeType: "image/png" };
};
const columnLine = (row) => `${row.index}. ${row.shotName}  f${row.startFrame}-${row.endFrame}  ${row.words || "stage look"}  ` +
	`${row.measured ? `measured ${row.measured.swatches.map((swatch) => `${swatch.hex} ${Math.round(swatch.share * 100)}%`).join(", ")} lum ${row.measured.meanLuminance} warmth ${row.measured.warmth}` : `planned lum ${row.planned.luminance} warmth ${row.planned.warmth}`}`;

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, refreshLiveDescription, runStudioCommand, isLive
 */
export function shotLookTool(deps) {
	const { tool, z, text, liveError, state } = deps;
	// In memory a look lives on the planned shot itself (state.coverage.shots), which render_prompt and render_packet read too.
	const memoryShots = () => state.coverage?.shots ?? [];
	const withLook = (shot, look) => { const { look: _old, ...rest } = shot; return look ? { ...rest, look } : rest; };
	const find = (shots, ref) => (typeof ref === "number" ? shots[ref - 1] : shots.find((row) => row.id === ref || String(row.name ?? "").toLowerCase().includes(String(ref).toLowerCase()))) ?? null;
	const swatch = z.string().regex(/^#[0-9a-fA-F]{6}$/);
	return [
		tool(
			"shot_look",
			{
				title: "Set a shot look or read the colour script",
				description:
					`A shot's own look, merged over the stage look while it plays (preview, captures, video, keyframe packs; a dissolve blends two looks): recipe in story words (${LOOK_RECIPE_IDS.join(", ")}), ` +
					`look { preset, warmth, keyColor, keyIntensity, exposure, fill, fog, sky, skyTop } (null clears a field), palette { swatches 3-5 hex, word } it is meant to read as, adjust ${LOOK_ADJUSTMENTS.join(" | ")}, same_as another shot, or clear. ` +
					"request reads the words (\"make the confession shot colder\", \"the same look as shot 2\"). With nothing to change, or read: true, or \"colour script for this scene\", it reads the colour script: each shot's look, intended and measured palette, and the colour change across each cut. " +
					"image: true adds the colour script PNG. With an editor connected it runs shot.setLook / shot.colourScript; in memory it works on the shots cover_scene planned.",
				inputSchema: {
					request: z.string().max(300).optional().describe("the request in words"),
					shot_id: z.string().optional().describe("the shot to set (default the one under the playhead)"),
					shot: z.union([z.string().min(1).max(80), z.number().int().min(1)]).optional().describe("a shot by name word, story beat or 1-based number"),
					recipe: z.enum(LOOK_RECIPES.map((row) => row.id)).optional().describe("a look recipe in story words"),
					look: z.record(z.string(), z.any()).optional().describe("a partial look"),
					palette: z.object({ swatches: z.array(swatch).min(3).max(5), word: z.string().max(40).optional() }).optional().describe("the palette the shot is meant to read as"),
					adjust: z.enum(LOOK_ADJUSTMENTS).optional().describe("a nudge"),
					same_as: z.union([z.string().min(1).max(80), z.number().int().min(1)]).optional().describe("copy this shot's look"),
					clear: z.boolean().optional().describe("remove the shot's look"),
					read: z.boolean().optional().describe("read the colour script instead"),
					image: z.boolean().optional().describe("add the colour script PNG to a read"),
				},
			},
			async (args) => {
				const routed = args.request ? resolveLookRequest(args.request) : null, said = routed ? `\n${resolvedLine(routed)}` : "";
				const want = { ...(routed?.action === "shot.setLook" ? routed.args : {}) };
				for (const [key, value] of Object.entries(args)) if (value !== undefined && !["request", "read", "image"].includes(key)) want[KEYS[key] ?? key] = value;
				const reading = args.read || routed?.action === "shot.colourScript" || !LOOK_EDIT_KEYS.some((key) => want[key] !== undefined);
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) {
						if (reading) {
							const answer = await deps.runStudioCommand({ action: "shot.colourScript", args: { ...(args.request ? { request: args.request } : {}) } });
							const receipt = args.image ? JSON.parse(answer.content[0].text) : null;
							if (!receipt?.ok) return said ? { ...answer, content: [...answer.content, { type: "text", text: said.trim() }] } : answer;
							const rows = receipt.output.shots.map((row) => ({ ...row, startFrame: row.frames[0], endFrame: row.frames[1], measured: row.measured ?? null }));
							return { ...answer, content: [...answer.content, imageBlock({ shots: rows, cuts: receipt.output.cuts, beats: receipt.output.beats })] };
						}
						const answer = await deps.runStudioCommand({ action: "shot.setLook", args: { ...want, ...(args.request ? { request: args.request } : {}) } });
						return said ? { ...answer, content: [...answer.content, { type: "text", text: said.trim() }] } : answer;
					}
					const shots = memoryShots();
					if (!shots.length) return text(`No shots in memory: plan some with cover_scene, or connect an editor.${said}`);
					if (reading) {
						const script = colourScript({ shots, storyBeats: state.storyBeats ?? [] });
						const body = text([`Colour script (the ${state.coverage.pattern} plan, planned tones): ${colourScriptWords(script)}`, ...script.shots.map(columnLine), ...script.cuts.map(colourCutWords)].join("\n") + said);
						return args.image ? { ...body, content: [...body.content, imageBlock(script)] } : body;
					}
					const target = want.shotId || want.shot !== undefined ? find(shots, want.shotId ?? want.shot) : shots[0];
					if (!target) return text(`Refused (STALE_TARGET): no planned shot is "${want.shotId ?? want.shot}".${said}`);
					const next = editShotLook(target.look ?? null, want, { source: want.sameAs !== undefined ? find(shots, want.sameAs) : null });
					state.coverage = { ...state.coverage, shots: shots.map((shot) => (shot.id === target.id ? withLook(shot, next) : shot)) };
					return text(`Look on ${target.name ?? target.id} (in memory): ${lookText(next)}.${said}`);
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}${said}`) : liveError(error);
				}
			},
		),
	];
}
