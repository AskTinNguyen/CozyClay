// The motion spec's channel vocabulary and sign conventions, shared by the validator (exact
// error messages) and QA hints. Degrees for angles, metres for points.

const sided = names => names.flatMap(n => [`${n}_l`, `${n}_r`]);

export const VEC_CHANNELS = new Set(["root", ...sided(["foot", "knee", "hand", "elbow"])]);
export const POLE_CHANNELS = new Set(sided(["knee", "elbow"]));
export const NUM_CHANNELS = new Set(["yaw", "pitch", "roll", "spine_yaw", "spine_pitch", "spine_roll", "head_yaw", "head_pitch", "head_roll", "arm_rest",
	...sided(["fyaw", "fpitch", "armw", "wtwist", "wflex", "aswing", "abend"])]);
export const MAP_CHANNELS = new Set(sided(["fingers"]));
export const FINGER_PRESETS = ["relaxed", "fist", "grip", "cigarette", "point"];

// [min, max, convention] for numeric channels whose values have a hard range.
const RANGES = [
	[/^(armw)_[lr]$/, 0, 1, "0 = FK arm, 1 = IK to the hand target"],
	[/^w_.+_[lr]$/, 0, 1, "a hand-target weight; the weights of one hand add up to at most 1"],
	[/^wtwist_[lr]$/, -85, 85, "wrist twist about the forearm in degrees"],
	[/^wflex_[lr]$/, -70, 70, "wrist flex about the knuckle line in degrees"],
	[/^fpitch_[lr]$/, -60, 90, "toe-down pitch in degrees: + lifts the heel (the toes stay flat), - lifts the toes"],
	[/^(pitch|spine_pitch|head_pitch)$/, -120, 120, "degrees, + bends forward"],
	[/^(roll|spine_roll|head_roll)$/, -90, 90, "degrees"],
];
export const rangeOf = ch => RANGES.find(([re]) => re.test(ch)) ?? null;

export const CONVENTIONS = {
	yaw: "yaw 0 faces +Z and + turns toward +X",
	fyaw: "foot heading in degrees, as yaw",
	pole: "a body-frame direction (turned by the root yaw only): +z forward, +x the character's left, +y up",
	foot: "the ANKLE target in world metres (standing: 0.087 X Bot, 0.105 Y Bot)",
	hand: "the WRIST target in world metres",
	root: "the hips joint in world metres (standing: 1.03 X Bot, 0.99 Y Bot)",
};

/** What each channel family means (a family drops the _l/_r side), for motion.describe "channels". */
export const CHANNEL_DOCS = {
	root: CONVENTIONS.root, yaw: `degrees; ${CONVENTIONS.yaw}`, pitch: "whole-body pitch, degrees", roll: "whole-body roll, degrees",
	spine_yaw: "degrees", spine_pitch: "degrees, + bends forward", spine_roll: "degrees", head_yaw: "degrees", head_pitch: "degrees, + looks down", head_roll: "degrees",
	arm_rest: "FK arms down from the T-pose (default 72)", foot: CONVENTIONS.foot, fyaw: CONVENTIONS.fyaw, fpitch: "toe-down pitch, degrees, + heel up",
	knee: `knee pole, ${CONVENTIONS.pole}`, armw: "0 = FK arm, 1 = IK to hand_* / the anchors", hand: CONVENTIONS.hand, elbow: `elbow pole, ${CONVENTIONS.pole}`,
	wtwist: "wrist twist, degrees", wflex: "wrist flex, degrees", aswing: "FK arm swing, degrees, + forward", abend: "FK elbow bend, degrees",
	fingers: "{ preset: weight 0..1 }",
};
export const channelFamily = ch => ch.replace(/_[lr]$/, "");

/** "; did you mean ..." for an unknown field: frame words point at the field that takes frames, distance words at the tolerance. */
const FIELD_ALIASES = [[["frames", "when", "range", "f", "from", "within", "during", "at"], ["when", "frames", "at", "f"]], [["max", "maxDist", "distance", "tolerance", "limit"], ["tol", "min"]]];
export function suggestField(name, fields) {
	for (const [words, targets] of FIELD_ALIASES) {
		const to = words.includes(name) && targets.find(t => fields.includes(t) && t !== name);
		if (to) return `; did you mean "${to}"?`;
	}
	return didYouMean(name, fields, Math.max(2, Math.floor(name.length / 3)));
}

export const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export const fmt = v => JSON.stringify(v)?.slice(0, 60);

/** Levenshtein distance, for "did you mean" suggestions. */
function editDistance(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[a.length][b.length];
}

export function didYouMean(name, options, maxD = Math.max(3, Math.floor(name.length / 3))) {
	let best = null, bestD = Infinity;
	for (const o of options) { const d = editDistance(name, o); if (d < bestD) { best = o; bestD = d; } }
	return best && bestD <= maxD ? `; did you mean "${best}"?` : "";
}
