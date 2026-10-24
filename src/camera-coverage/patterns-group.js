// Group and branching coverage patterns (group-coverage A2): scenes of three to
// six people, and a conversation cut several ways from the same setups. Each
// shot names whose shot it is by cast index (`who`), the pair whose line it
// keeps (`pair`, stored on the laid shot as its authored line), whom an
// over-the-shoulder looks past (`over`), and for a branching pattern the
// setup it repeats. plan-group.js lays them; descriptions are CozyClay's own.

/** One shot: a role word, whose shot (cast index), its stack, and its pair/over/setup. */
const shot = (role, who, stack, extra = {}) => ({ role, who, stack, ...extra });
// A single that cannot keep its pair's side at three-quarter tries it in profile.
const OTS = [{ id: "over-the-shoulder" }], SINGLE = [{ id: "medium-close-up" }], SIDE_ON = [[{ id: "medium-close-up" }, { id: "profile-shot" }]], INSIDE = [{ id: "medium-close-up" }, { id: "head-on-shot" }];

/** The speaking pairs of a triangle, each block starting on someone the last block did not end on. */
function triangleShots() {
	// The master keeps the first pair's side, so the exchange it opens on cuts in clean.
	const out = [shot("Master", 0, [{ id: "three-shot" }], { pair: [0, 1] })];
	let last = 0;
	for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
		const [a, b] = i === last ? [j, i] : [i, j], pair = [i, j];
		out.push(shot("OTS", a, OTS, { pair, over: b }), shot("OTS", b, OTS, { pair, over: a }), shot("Single", a, SINGLE, { pair, alternates: SIDE_ON }), shot("Single", b, SINGLE, { pair, alternates: SIDE_ON }));
		last = b;
	}
	return out;
}

export const GROUP_PATTERNS = Object.freeze([
	{
		id: "triangle-dialogue", name: "Triangle Dialogue", tag: "TRI", cast: 3, castMax: 3, moods: ["argument", "conversation", "group"],
		aliases: ["triangle dialogue", "triangle coverage", "three-way argument", "three way argument", "three-way conversation", "three way conversation", "three-way dialogue", "three way dialogue",
			"three person conversation", "three-person conversation", "three people talking", "three-hander", "argument between three", "conversation between three"],
		description: "A three-shot master of the triangle, then over-the-shoulders and singles for each speaking pair, every camera of a pair on its own side of that pair's line, outside the group.",
		shots: triangleShots,
	},
	{
		id: "group-singles", name: "Group Singles", tag: "GROUP", cast: 3, castMax: 6, moods: ["group", "meeting", "ensemble"],
		aliases: ["group singles", "group coverage", "cover the group", "cover this group", "round the table", "around the table", "singles for everyone", "single on everyone", "ensemble coverage", "table coverage"],
		description: "A master that holds the whole group, then a head-on single of each member from inside the circle, taken round the group so each cut moves to a neighbour.",
		shots: (n = 3) => [shot("Wide", 0, [{ id: "master-shot" }]), ...Array.from({ length: n }, (_, i) => shot("Single", i, INSIDE))],
	},
	{
		id: "branching-dialogue", name: "Branching Dialogue", tag: "BRANCH", cast: 2, castMax: 6, moods: ["branching", "interactive", "conversation"], branching: true,
		aliases: ["branching dialogue", "branching conversation", "dialogue branches", "conversation branches", "dialogue tree", "branching scene", "dialogue options", "branches of the conversation"],
		description: "One set of setups, a master and a single per speaker, laid once and repeated in every branch range, so each branch of an interactive conversation cuts from the same cameras.",
		// Two speakers keep the A-B line; three or more are taken head-on from inside the group.
		shots: (n = 2) => [shot("Master", 0, [{ id: "master-shot" }], { setup: "master", ...(n === 2 ? { pair: [0, 1] } : {}) }),
			...Array.from({ length: n }, (_, i) => shot("Single", i, n === 2 ? SINGLE : INSIDE, { setup: `single-${i + 1}`, ...(n === 2 ? { pair: [0, 1] } : {}) }))],
	},
]);

export const groupPattern = (id) => GROUP_PATTERNS.find((pattern) => pattern.id === id) ?? null;
