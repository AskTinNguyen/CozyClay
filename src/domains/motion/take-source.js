// What a saved take v3 is: the motion spec, the character placement and the scene as the
// compiler saw it (motionScene boxes), never the baked Float32 arrays. Compiling is
// deterministic, so compiling the source again rebuilds the same bones: this follows the
// motion.compile install path step for step (pipeline compileSpec, then bakeTake). Searched
// open parameters are already resolved in the stored spec, so no search runs again.
import { compileSpec } from "../../motion3/pipeline.js";
import { bakeTake } from "../../motion3/take.js";
import { motionScene } from "../../motion3/scene.js";
import { skeletonFor } from "../../motion3/rigs/index.js";
import { isTakeV3 } from "../../motion3/playback.js";

const TAKE_SCHEMA = "cozyclay.take.v3";
const SPEC_SCHEMA = "cozyclay.motion-spec.v1";
const TIMELINE_FPS = 24;
const plain = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** The JSON source of an installed take v3 (null for any other motion). Skills, anchors and
 * hinges may read any scene object, so the whole compile scene is kept. */
export function takeSource(take, sceneObjects = []) {
	if (!isTakeV3(take) || !plain(take.spec)) return null;
	return structuredClone({ schema: TAKE_SCHEMA, rig: take.rig, spec: take.spec,
		placement: { position: take.placement?.position ?? [0, 0, 0], yaw: take.placement?.yaw ?? 0 }, scene: motionScene(sceneObjects) });
}

/** A saved source (with the Studio take id it carried), checked and owned by the caller; null when it is not one. */
export function normalizeTakeSource(value) {
	if (!plain(value) || value.schema !== TAKE_SCHEMA || typeof value.rig !== "string") return null;
	if (!plain(value.spec) || value.spec.schema !== SPEC_SCHEMA || !Number.isFinite(value.spec.frames)) return null;
	if (!plain(value.placement) || !finite3(value.placement.position) || !Number.isFinite(value.placement.yaw)) return null;
	const objects = plain(value.scene?.objects) ? value.scene.objects : {};
	return structuredClone({ schema: TAKE_SCHEMA, rig: value.rig, spec: value.spec,
		placement: { position: value.placement.position, yaw: value.placement.yaw }, scene: { objects },
		...(typeof value.takeId === "string" && value.takeId ? { takeId: value.takeId } : {}) });
}

/** What a scene saves for a motion layer's take descriptor: its source and take id, or null. */
export const savedTakeSource = descriptor => descriptor?.source ? { ...descriptor.source, takeId: descriptor.studioTakeId } : null;

/** Compile a source back into the installed take (with `frames`, as motion.compile installs it). */
export function compileTakeSource(source) {
	const sk = skeletonFor(source?.rig);
	if (!sk || !plain(source.spec)) return null;
	const { out } = compileSpec({ fps: TIMELINE_FPS, ...source.spec }, { sk, scene: source.scene ?? { objects: {} } });
	const take = bakeTake(sk, out, source.placement, { spec: source.spec, prompt: source.spec.label ?? "" });
	return { ...take, frames: take.frameCount };
}
