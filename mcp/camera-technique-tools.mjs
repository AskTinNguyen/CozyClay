/**
 * camera-technique-tools.mjs — the camera technique library as two MCP tools.
 *
 * list_camera_techniques reads the catalog (src/camera-techniques); and
 * apply_camera_technique applies a stack: through the connected editor's own
 * camera.applyTechnique command when one is live, otherwise on the in-memory
 * camera, where the move's first framing becomes the marked A position and its
 * last the camera, so describe_camera_move names it and render_prompt says it.
 */
import { compileStack } from "../src/camera-techniques/compile.js";
import { describeTechnique, techniqueIndex } from "../src/camera-techniques/index.js";
import { parseRequest, searchTechniques } from "../src/camera-techniques/resolve.js";
import { classifyKeys, classifyRail, railTrack, techniquePhrase } from "../src/camera-techniques/readback.js";
import { PLANNED_CAPABILITIES, TECHNIQUE_KINDS } from "../src/camera-techniques/entry.js";
import { currentTechnique } from "../src/camera-techniques/storage.js";
import { shotAtFrame } from "../src/cuts.js";
import { SUBJECT_HEIGHT_M, focalMmToFov, fovToFocalMm } from "../src/shot.js";

const MEMORY_FRAMES = 72;
const cameraKey = (camera) => JSON.stringify([camera.x, camera.y, camera.z, camera.focalMm]);

/** The technique render_prompt states: the editor's stored stack on the shot under the playhead (while it still
 * describes that camera), else the in-memory one while the camera still stands where it put it. */
export function promptTechnique(state, scene, isLive) {
	if (isLive) return currentTechnique(shotAtFrame(scene?.shotDocument?.shots ?? [], state.timeline.currentFrame));
	return state.technique && state.technique.camera === cameraKey(state.camera) ? state.technique : null;
}

/**
 * @param {object} deps  the registry's own helpers: tool, z, text, liveError, state, cast, findCharacter,
 *   filmback, slateLine, currentShot, refreshLiveDescription, runStudioCommand, isLive
 */
export function cameraTechniqueTools(deps) {
	const { tool, z, text, liveError, state } = deps;
	const item = z.union([z.string().min(1).max(40), z.object({ id: z.string().min(1).max(40), params: z.record(z.string(), z.any()).optional() })]);
	const rowOf = (character) => ({ id: character.id, name: character.subject ?? character.name, x: character.x, z: character.z, rot: character.rot ?? 0, height: SUBJECT_HEIGHT_M * (character.scale ?? 1) });

	/** In memory there is one camera and no shot: the move's ends become A and B. */
	function applyInMemory(stack, subjectRef, shared) {
		const visible = deps.cast().filter((row) => !row.hidden), subjectRow = deps.findCharacter(subjectRef) ?? visible[0];
		if (!subjectRow) return text("Add a character first; a technique frames a character.");
		const gate = deps.filmback(), subject = rowOf(subjectRow);
		const camera = { position: { x: state.camera.x, y: state.camera.y, z: state.camera.z }, lookAt: { x: subject.x, y: 1.3, z: subject.z }, focalMm: state.camera.focalMm };
		const plan = compileStack(stack, { subject, cast: visible.map(rowOf), shot: { startFrame: 0, endFrame: MEMORY_FRAMES - 1 }, filmback: gate, camera }, shared);
		const opts = { height: subject.height, filmback: gate };
		let ends = null, move = null;
		if (plan.keys) {
			ends = [plan.keys[0].framing, plan.keys.at(-1).framing].map((exact) => ({ ...exact.position, focalMm: exact.focalMm }));
			move = classifyKeys(plan.keys, subject, opts);
		} else if (plan.rail) {
			const track = railTrack(plan.rail, subject, MEMORY_FRAMES);
			ends = [track[0], track.at(-1)].map((row) => ({ ...row.pos, focalMm: plan.rail.focalMm }));
			move = classifyRail(plan.rail, subject, MEMORY_FRAMES, opts);
		}
		if (ends) {
			const [start, end] = ends, fovDeg = (mm) => (focalMmToFov(mm, gate.sensorId, gate.aspectRatio) * 180) / Math.PI;
			state.markedFraming = move?.id === "static" ? null : { pos: { x: start.x, y: start.y, z: start.z }, yaw: 0, pitch: 0, fovDeg: fovDeg(start.focalMm) };
			if (state.markedFraming) Object.assign(state.markedFraming, aim(start, subject));
			Object.assign(state.camera, { x: end.x, y: end.y, z: end.z, focalMm: Math.round(fovToFocalMm((fovDeg(end.focalMm) * Math.PI) / 180, gate.sensorId, gate.aspectRatio) * 100) / 100 });
		}
		state.focus = subject.id;
		// The camera capabilities the stack sets (roll, focus, shake, mount, speed, shutter) live on the in-memory camera.
		state.cameraCapabilities = plan.capabilities;
		state.technique = { label: plan.label, phrase: techniquePhrase(plan, move), stack: plan.stack.map((row) => row.id), camera: cameraKey(state.camera) };
		const verified = !plan.expectedMove || move?.id === plan.expectedMove;
		return text([
			`Applied ${plan.label} on ${subject.name ?? subject.id}.`,
			move ? `move      ${move.label}${plan.expectedMove ? (verified ? " (verified by the move classifier)" : ` (expected ${plan.expectedMove})`) : ""}` : "move      none (prompt words only)",
			ends ? `camera    ${deps.slateLine(deps.currentShot())}` : null,
			`prompt    ${state.technique.phrase}`,
			...(plan.capabilityWords.length ? [`camera    ${plan.capabilityWords.join("; ")} (set_camera_capabilities tunes it)`] : []),
			...plan.promptOnly.map((part) => `prompt-only ${part.name}: needs ${part.requires.map((need) => PLANNED_CAPABILITIES[need]).join(" and ")}`),
			...plan.notes.map((note) => `note      ${note}`),
			...(plan.members ? [`group     ${plan.members.filter((row) => row.inFrame).length} of ${plan.members.length} in frame`] : []),
			state.markedFraming ? "The move's first framing is marked as A; describe_camera_move names it, render_prompt states it." : "render_prompt states it.",
		].filter(Boolean).join("\n"));
	}
	const aim = (from, subject) => {
		const dx = subject.x - from.x, dy = 1.3 - from.y, dz = subject.z - from.z;
		return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
	};

	return [
		tool(
			"list_camera_techniques",
			{
				title: "List camera techniques",
				description:
					"Read the camera technique library: 65 film techniques (shot sizes, angles, camera moves, lens moves, coverage, modifiers) " +
					"as a compact index, the techniques matching a query (a name, alias, misspelling or mood such as \"uneasy\" or \"epic reveal\"), " +
					"or one technique in full by id. Apply them with apply_camera_technique.",
				inputSchema: {
					query: z.string().max(200).optional().describe("name, alias or mood to search"),
					kind: z.enum(TECHNIQUE_KINDS).optional().describe("only this kind"),
					id: z.string().max(80).optional().describe("one technique id (or phrase) to read in full"),
				},
			},
			async ({ query, kind, id }) => {
				if (id) {
					const full = describeTechnique(id) ?? describeTechnique(parseRequest(id).stack[0]?.id ?? "");
					return text(full ? JSON.stringify(full, null, 1) : `No technique matches "${id}".`);
				}
				const rows = query ? searchTechniques(query, { kind }) : null;
				if (rows) return text(rows.length ? rows.slice(0, 12).map((entry) => `${entry.id} — ${entry.kind} — ${entry.moods.slice(0, 3).join(", ")}`).join("\n") : `No technique matches "${query}".`);
				const index = techniqueIndex({ kind });
				return text([`${index.count} techniques [id, kind, moods, needs?]`, ...index.techniques.map((row) => row.join(" | ")), "", index.stacking].join("\n"));
			},
		),
		tool(
			"apply_camera_technique",
			{
				title: "Apply a camera technique",
				description:
					"Apply a camera technique stack to the shot: request is a director's sentence (\"low-angle slow push-in on her\", \"give me a vertigo shot\") " +
					"or stack lists technique ids with params (one size, angle, move and coverage, any modifiers). With an editor connected it runs the " +
					"editor's camera.applyTechnique (one undo entry; shot_id and subject default to the playhead's shot and the active character) and " +
					"answers its receipt; in memory it sets the camera and marks the move's start for describe_camera_move.",
				inputSchema: {
					request: z.string().min(1).max(300).optional().describe("what the shot should do, in words"),
					stack: z.array(item).min(1).max(8).optional().describe("technique ids or { id, params }"),
					subject: z.string().optional().describe("character id, A/B/C letter or 1-based slot"),
					speed: z.enum(["slow", "medium", "fast"]).optional().describe("how quickly the move happens"),
					focal_mm: z.number().min(8).max(300).optional().describe("lens for the stack"),
					shot_id: z.string().optional().describe("editor shot id (live only)"),
				},
			},
			async ({ request, stack, subject, speed, focal_mm, shot_id, ...admission }) => {
				if (!request && !stack) return text("Give request (words) or stack (technique ids).");
				const shared = { ...(speed ? { speed } : {}), ...(focal_mm ? { focalMm: focal_mm } : {}) };
				try {
					await deps.refreshLiveDescription();
					if (deps.isLive()) {
						const subjectId = subject === undefined ? undefined : deps.findCharacter(subject)?.id ?? subject;
						return await deps.runStudioCommand({ ...admission, action: "camera.applyTechnique",
							args: { ...(request ? { request } : {}), ...(stack ? { stack } : {}), ...(subjectId ? { subjectId } : {}), ...(shot_id ? { shotId: shot_id } : {}), ...shared } });
					}
					const castRows = deps.cast().map((row) => ({ id: row.id, name: row.subject ?? row.name }));
					const parsed = request ? parseRequest(request, { cast: castRows }) : null, resolved = stack ?? parsed.stack;
					if (!resolved.length) return text(`No camera technique in "${request}". Try list_camera_techniques { query }.`);
					return applyInMemory(resolved, subject ?? parsed?.subjectId, shared);
				} catch (error) {
					return error.code ? text(`Refused (${error.code}): ${error.message}`) : liveError(error);
				}
			},
		),
	];
}
