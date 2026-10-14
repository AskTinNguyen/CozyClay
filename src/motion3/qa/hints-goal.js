// Hints for GOAL groups (C8, C6). Stub until lane G, which moves the hand channel with moveHint
// (hints-contact.js, read only) and returns a fix { channel, f, delta } (qa/patch.js).

export const goalHints = {
	/** GOAL(X, g) -> { cause, hint, fix? } | null */
	GOAL(X, g) {
		return { cause: `goal ${g.subject.split(":")[0]}`, hint: `change the keys around f${g.worstFrame} until the goal holds` };
	},
};
