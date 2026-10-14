// frames: "auto" (lane A). Stub until lane A: the spec comes back unchanged.
// Lane A: frames "auto" becomes the largest of every skill end, generator end and key f, plus 1
// (open parameters counted at their upper bound); the result spec carries the number, so a saved
// take stores it.

/**
 * resolveFrames(spec, { sk, scene }) -> spec (a copy when frames was "auto", else spec itself)
 */
export function resolveFrames(spec /* , { sk, scene } */) {
	return spec;
}
