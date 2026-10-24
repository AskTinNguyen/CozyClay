// The sequence document the brief reads, built from studio state: the shots,
// the visible cast (with whether each has a character sheet), the set, the
// look, the delivery aspect and filmback, and per character with a motion v3
// take what the motion compiler reports about it (timeline, observations, the
// spec's objects) plus the body's heading per frame from the baked take.
// Pure: the caller hands in the compile answer (studio-motion-visual compiles
// a take the same way), so nothing here runs the compiler.

const DEG = 180 / Math.PI;

/** The hips' heading (degrees, 0 faces +Z, + toward +X) per frame of a baked take v3, or [] without one. */
function takeYaw(take) {
	const bones = take?.bones ?? [], frames = take?.frameCount ?? 0, at = Math.max(0, bones.indexOf("Hips"));
	if (!take?.rot || !bones.length) return [];
	const yaw = [];
	for (let f = 0; f < frames; f++) {
		const i = (f * bones.length + at) * 4, [x, y, z, w] = [take.rot[i], take.rot[i + 1], take.rot[i + 2], take.rot[i + 3]];
		yaw.push(Math.round(Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)) * DEG * 1000) / 1000);
	}
	return yaw;
}

/**
 * One character's motion entry for the brief.
 * @param {{ id, subject?, name? }} character
 * @param {object|null} take      the baked take v3 (rot, bones, frameCount)
 * @param {object|null} compiled  a compile answer for its spec ({ timeline, observations, expanded })
 * @param {number} [startFrame]   the timeline frame the take's frame 0 plays at
 */
export function motionEntry(character, take, compiled, startFrame = 0) {
	return {
		characterId: character.id, name: String(character.subject ?? character.name ?? character.id).split(",")[0].trim(), startFrame,
		timeline: compiled?.timeline ?? [], observations: compiled?.observations ?? {}, objects: compiled?.expanded?.objects ?? take?.spec?.objects ?? {}, yaw: takeYaw(take),
	};
}

/**
 * @param {object} state  { title, shots, characters, fps, aspect, filmback, frameCount, activeCharacterId, look, environment, environmentImage, motion, stage? }
 * @returns the document buildSequencePrompt reads
 */
export function sequenceDocument(state) {
	// The whole row: placements (walked paths, shot overrides) read their own fields.
	const cast = (state.characters ?? []).filter((row) => row && !row.hidden).map((row) => ({ ...row, subject: row.subject ?? row.name ?? row.id }));
	const look = [state.style, state.look].map((text) => (typeof text === "string" ? text.trim() : "")).filter(Boolean).join(", ");
	return {
		title: state.title || "Untitled", fps: state.fps ?? 24, aspect: state.aspect ?? null, filmback: state.filmback ?? {}, frameCount: state.frameCount,
		activeCharacterId: state.activeCharacterId ?? null, look, cast, shots: state.shots ?? [], motion: state.motion ?? [], storyBeats: state.storyBeats ?? [],
		set: { environment: typeof state.environment === "string" ? state.environment : "", ...(typeof state.environmentImage === "string" && state.environmentImage ? { image: state.environmentImage } : {}) },
		// The stage look the shots' own looks merge over (colour-script: the planned tone).
		...(state.stage ? { stage: { lighting: state.stage.lighting ?? null, keyLight: state.stage.keyLight ?? null } } : {}),
	};
}
