// Bone names as the agent writes them -> the rig's bone. W0: an exact match, else a
// "did you mean" suggestion. Lane B widens the match (case-insensitive, a "mixamorig:" prefix,
// aliases such as pelvis/hips or hand_l) without changing this signature.
import { didYouMean } from "./compiler/vocab.js";

/**
 * @param {{ index: Record<string, number>, names: string[] }} sk  the rig (rigs/index.js skeletonFor)
 * @param {string} name
 * @returns {{ bone: string | null, hint: string }} bone = the rig's own name, or null; hint = the
 *   suffix for an error message when bone is null ('; did you mean "LeftHand"?' or "").
 */
export function resolveBone(sk, name) {
	if (sk.index[name] !== undefined) return { bone: name, hint: "" };
	return { bone: null, hint: didYouMean(String(name), sk.names) };
}
