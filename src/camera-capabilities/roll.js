// Roll in film words. rollDeg turns the camera about its own lens axis; a
// positive roll turns it counter-clockwise (as the operator sees it from
// behind), so the horizon in the frame falls to the right.

const ROLL_DEG = 5;

/** "falling to the right" / "falling to the left" for a roll angle. */
const rollSide = (rollDeg) => (rollDeg >= 0 ? "falling to the right" : "falling to the left");

/** The prompt words for a held roll: "the horizon tilted 20 degrees, falling to the right". */
export function rollWords(rollDeg) {
	return Math.abs(rollDeg) < 0.5 ? "" : `the horizon tilted ${Math.round(Math.abs(rollDeg))} degrees, ${rollSide(rollDeg)}`;
}

/**
 * Name a roll change on a classified move (camera-move.js classifyMove): a
 * still camera that only rolls is a "roll"; any other move says it rolls too.
 * Framings carry `rollDeg` when a shot camera has roll (absent = level).
 */
export function withRoll(move, a, b) {
	const from = a?.rollDeg ?? 0, to = b?.rollDeg ?? 0, dRollDeg = to - from;
	const deltas = { ...move.deltas, dRollDeg };
	if (Math.abs(dRollDeg) < ROLL_DEG) return { ...move, deltas };
	const turn = `${Math.round(Math.abs(dRollDeg))} degrees`;
	const into = Math.abs(to) < 0.5 ? "back to level" : `until the horizon is ${rollSide(to)}`;
	if (move.id === "static") return { ...move, id: "roll", label: "Roll", phrase: `a roll, the camera turning ${turn} about the lens ${into}`, deltas };
	return { ...move, phrase: `${move.phrase}, rolling ${turn} ${into}`, deltas };
}
