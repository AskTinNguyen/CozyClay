// The smoking kits: a cigarette and a lighter sized and gripped like the smokeCigarette props, so
// the carried kit sits exactly in the fingers (src/motion3/skills/smoke.js props cig, lighter).
// Part positions are in the kit root's frame (metres), the base pivot of each part record; the
// root rides the prop origin with at [0, 0, 0] and the `along` below (docs/motion-api-v3.1.md C15).
//   cigarette: root between RightHandIndex2 and RightHandMiddle2; +Y runs along the palm normal
//              from the filter (y -0.026, prop point filter) to the tip (y 0.058, prop point tip):
//              8.4 cm x 7.8 mm.
//   lighter:   root between LeftHand and LeftHandMiddle1; +Y toward the thumb side; the flame sits
//              on the hood at the prop point flame [0.01, 0.036, 0] (d, l, n).

const PAPER = "#f3efe6", FILTER = "#d48a4c", ASH = "#4a3a33";
const D = 0.0078, FILTER_LEN = 0.022, LEN = 0.084, TIP = 0.058;

export const cigarette = {
	label: "Cigarette", prop: "cig", skill: "smokeCigarette",
	description: "8.4 cm cigarette held between the right index and middle fingers (smokeCigarette prop cig): paper and filter, a glowing ember with its faint light, and tip smoke",
	carry: { prop: "cig", at: [0, 0, 0], along: [0, 0, 1], visible: "cig_vis" },
	parts: [
		{ role: "body", kind: "sculpt", at: [0, TIP - LEN, 0], recipe: { version: 1, parts: [
			{ id: "filter", shape: "cylinder", size: [D, FILTER_LEN, D], position: [0, FILTER_LEN / 2, 0], color: FILTER },
			{ id: "paper", shape: "cylinder", size: [D, LEN - FILTER_LEN - 0.004, D], position: [0, (LEN + FILTER_LEN - 0.004) / 2, 0], color: PAPER }] } },
		// the burning end: a 1 cm ash sphere at the tip that glows (its level follows the drag)
		{ role: "ember", kind: "sphere", at: [0, TIP - 0.009, 0], scale: [0.01, 0.01, 0.01], color: ASH,
			glow: { color: "#ff5a1e", intensity: 5, halo: 3.5 }, switch: { visible: "ember_vis", level: "ember" } },
		// a glow lights nothing: the faint warm light on the fingers and the face, brighter on a drag
		{ role: "light", kind: "point-light", at: [0, TIP + 0.004, 0], light: { type: "point", color: "#ff6a2a", intensity: 0.04, range: 1.2, flicker: 0.2, shadow: false },
			switch: { visible: "ember_vis", level: "ember" } },
		{ role: "smoke", kind: "effect", at: [0, TIP + 0.002, 0], effect: { preset: "smoke" }, switch: { visible: "ember_vis" } },
	],
};

export const lighter = {
	label: "Lighter", prop: "lighter", skill: "smokeCigarette",
	description: "7.5 cm disposable lighter held in the left fist (smokeCigarette prop lighter): body and hood, a glowing flame and its flickering light",
	carry: { prop: "lighter", at: [0, 0, 0], along: [0, 1, 0], visible: "lit_vis" },
	parts: [
		{ role: "body", kind: "sculpt", at: [0.01, -0.062, 0], recipe: { version: 1, parts: [
			{ id: "body", shape: "box", size: [0.025, 0.075, 0.013], position: [0, 0.0375, 0], roundness: 0.5, color: "#c4372f" },
			{ id: "hood", shape: "box", size: [0.024, 0.013, 0.012], position: [0, 0.0815, 0], roundness: 0.25, color: "#aeb4b9" },
			{ id: "wheel", shape: "cylinder", size: [0.009, 0.006, 0.009], position: [-0.006, 0.0815, 0], rotation: [90, 0, 0], color: "#6d7378" }] } },
		{ role: "flame", kind: "sphere", at: [0.01, 0.027, 0], scale: [0.011, 0.028, 0.011], color: "#ffcf73",
			glow: { color: "#ff9a3c", intensity: 6, halo: 1.6 }, switch: { visible: "flame_vis" } },
		{ role: "light", kind: "point-light", at: [0.01, 0.045, 0], light: { type: "point", color: "#ffb35c", intensity: 0.5, range: 4, flicker: 0.6, shadow: false },
			switch: { visible: "flame_vis" } },
	],
};
