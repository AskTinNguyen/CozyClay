/**
 * camera-capability-tools.mjs — the shot camera's capabilities as one MCP tool.
 *
 * set_camera_capabilities gives the shot camera roll, a lens (aperture and
 * focus), handheld shake, a body mount, a speed and a shutter. With an editor
 * connected it runs camera.set (or camera.setKey with at_frame, which keys roll
 * and focus); in memory it keeps them for render_prompt, which states them.
 */
import { cameraCapabilities, LIMITS, MOUNT_BONES, MOUNT_LOOKS, SHAKE_STYLES } from "../src/camera-capabilities/fields.js";
import { capabilityWords } from "../src/camera-capabilities/words.js";
import { shotAtFrame } from "../src/cuts.js";
// The coverage tools (cover_scene, check_cuts) ride the registry beside this one.
export { cameraCoverageTools, COVERAGE_TOOL_ANNOTATIONS } from "./camera-coverage-tools.mjs";

/** What render_prompt says the camera does: the live shot under the playhead, else the in-memory camera. */
export function promptCapabilities(state, scene, isLive) {
	const camera = isLive ? shotAtFrame(scene?.shotDocument?.shots ?? [], state.timeline.currentFrame)?.camera : state.cameraCapabilities;
	const cast = scene?.stage?.characters ?? [];
	return capabilityWords(camera, { castName: (id) => (cast.find((row) => row.id === id)?.subject ?? id).split(",")[0], fps: state.timeline.fps ?? 24 });
}

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, cast, findCharacter, refreshLiveDescription, runStudioCommand, isLive
 */
export function cameraCapabilityTools(deps) {
	const { tool, z, text, liveError, state } = deps;
	const range = ([min, max]) => z.number().min(min).max(max);
	const castId = (ref) => (ref === undefined || ref === null ? ref : deps.findCharacter(ref)?.id ?? ref);
	return [
		tool(
			"set_camera_capabilities",
			{
				title: "Set the shot camera's roll, focus, shake, mount, speed and shutter",
				description:
					"Unlike set_camera and frame_shot, which place the camera, this gives the shot camera what placement cannot: roll_deg (a Dutch angle; + turns the camera " +
					"counter-clockwise so the horizon falls to the right), f_stop with focus_on (a character, followed per frame) or focus_distance (m) for depth of field, " +
					"shake (handheld or vehicle, amplitude 0-1, deterministic per seed), mount (a Snorricam: the camera rides a character's chest, head, hips or back), " +
					"speed (0.5 = slow motion) and shutter_deg (motion blur; 180 natural, 270+ heavy). null clears a field. at_frame keys roll_deg and focus_on there " +
					"instead (two focus keys on different characters rack focus). With an editor connected it runs camera.set / camera.setKey on the shot " +
					"(shot_id, default the playhead's) and answers the sampled result; in memory render_prompt states them.",
				inputSchema: {
					roll_deg: range(LIMITS.rollDeg).nullable().optional().describe("camera roll in degrees"),
					f_stop: range(LIMITS.fStop).nullable().optional().describe("aperture: 1.4 shallow ... 16 deep; null turns depth of field off"),
					focus_on: z.string().nullable().optional().describe("character id, A/B/C letter or 1-based slot to hold focus on"),
					focus_distance: range(LIMITS.focusDistance).nullable().optional().describe("focus distance in metres"),
					shake: z.object({ style: z.enum(SHAKE_STYLES).optional(), amplitude: range(LIMITS.amplitude), frequency: range(LIMITS.frequency).optional(), seed: z.number().int().min(0).optional() }).nullable().optional(),
					mount: z.object({ character: z.string(), bone: z.enum(MOUNT_BONES).optional(), look: z.enum(MOUNT_LOOKS).optional() }).nullable().optional(),
					speed: range(LIMITS.speed).nullable().optional().describe("shot speed: 0.5 plays the take at half speed"),
					shutter_deg: range(LIMITS.shutterDeg).nullable().optional().describe("shutter angle for motion blur"),
					at_frame: z.number().int().min(0).optional().describe("key roll_deg / focus_on at this timeline frame (live only)"),
					shot_id: z.string().optional().describe("editor shot id (live only)"),
				},
			},
			async ({ roll_deg, f_stop, focus_on, focus_distance, shake, mount, speed, shutter_deg, at_frame, shot_id, ...admission }) => {
				const lens = [f_stop, focus_on, focus_distance].some((value) => value !== undefined)
					? { ...(f_stop !== undefined ? { fStop: f_stop } : {}), ...(focus_on !== undefined ? { focusTarget: castId(focus_on) } : {}), ...(focus_distance !== undefined ? { focusDistance: focus_distance } : {}) } : undefined;
				const patch = Object.fromEntries(Object.entries({ rollDeg: roll_deg, lens, shake, speed, shutterDeg: shutter_deg,
					mount: mount === undefined || mount === null ? mount : { characterId: castId(mount.character), ...(mount.bone ? { bone: mount.bone } : {}), ...(mount.look ? { look: mount.look } : {}) } }).filter(([, value]) => value !== undefined));
				if (!Object.keys(patch).length) return text("Give at least one of roll_deg, f_stop, focus_on, focus_distance, shake, mount, speed or shutter_deg.");
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) {
						const shotArg = shot_id ? { shotId: shot_id } : {};
						if (at_frame !== undefined) {
							const focus = focus_on === undefined ? undefined : focus_on === null ? null : { targetId: castId(focus_on) };
							return await deps.runStudioCommand({ ...admission, action: "camera.setKey", args: { ...shotArg, frame: at_frame, ...(roll_deg !== undefined ? { rollDeg: roll_deg } : {}), ...(focus !== undefined ? { focus } : {}) } });
						}
						return await deps.runStudioCommand({ ...admission, action: "camera.set", args: { ...shotArg, ...patch } });
					}
					if (at_frame !== undefined) return text("at_frame keys a shot's rig keys; connect the editor (memory has one camera and no shots).");
					const current = state.cameraCapabilities ?? {};
					const merged = { ...current, ...patch, ...(patch.lens ? { lens: patch.lens === null ? null : { ...(current.lens ?? {}), ...patch.lens } } : {}) };
					state.cameraCapabilities = cameraCapabilities(Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)));
					const words = promptCapabilities(state, { stage: { characters: deps.cast() } }, false);
					return text(words.length ? `Camera: ${words.join("; ")}.\nrender_prompt states it.` : "Camera: no roll, focus, shake, mount, speed or shutter.");
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
	];
}
