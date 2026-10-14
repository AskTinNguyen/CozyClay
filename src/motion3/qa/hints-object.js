// Hints for object issues (C3, C6). Stub until lane C. A hint function takes the explain context
// X (qa/explain.js) and the group g and returns { cause, hint, fix? } (fix: see qa/patch.js),
// or null when it has nothing to say. Lane C: GRAB looks within +-24 frames for the frame where
// the hand is nearest and proposes fix { path: "/objects/<id>/grab", value: f }; failing that it
// moves the hand with moveHint (hints-contact.js). Hint wording is free until lane C ships it.

export const objectHints = {
	/** GRAB(X, g) -> { cause, hint, fix? } | null */
	GRAB(X, g) {
		const id = g.subject.split(":")[0];
		return { cause: `objects.${id}.grab`, hint: `${id}: move the hand to it by f${g.worstFrame}, or set objects.${id}.grab to the frame the hand arrives` };
	},
};
