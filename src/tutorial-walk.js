// The camera tutorial's set dressing: a short compiled walk (take v3) for the starter scene's
// character, so the Shot / Rail / Play steps have somebody moving through the set. Built from
// the character's own bind skeleton and placement; null for a body motion3 cannot drive.
import { skeletonFor } from "./motion3/rigs/index.js";
import { add, apply, ry } from "./motion3/compiler/math.js";

const TUTORIAL_WALK_LABEL = "A person walks forward and stops.";

export function tutorialWalkSpec(character) {
	const sk = skeletonFor(character?.model);
	if (!sk) return null;
	const I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1], yaw = character.rot ?? 0;
	const at = (offset, y) => add([character.x ?? 0, character.y ?? 0, character.z ?? 0], apply(ry(yaw), [offset[0], y, offset[1]]));
	return { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 216, label: TUTORIAL_WALK_LABEL,
		keys: [{ f: 0, set: { root: at([0, 0], P[I.Hips][1] - 0.01), yaw, foot_l: at([0.09, -0.03], ank), foot_r: at([-0.09, 0.03], ank), fyaw_l: yaw, fyaw_r: yaw } }],
		generators: [{ type: "walk", f0: 6, steps: 8, heading: [yaw, yaw] }] };
}
