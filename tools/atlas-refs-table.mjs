// The curated table tools/atlas-refs.mjs reads: which atlas books may be
// cited (camera and directing titles only, D3), and, per technique, coverage
// pattern and cut rule, the atlas vocabulary that marks a page about it.
//
//   terms     matched exactly (lower case) against a page's atlas evidence terms
//   sections  matched as whole words against the title of the section a page sits in
//   tags      atlas camera tags that add weight when a page also carries them
//
// Only bibliographic fields leave the generator: book id, title, author,
// edition, year, pages. Edition is curated here because the atlas has no field for it.

/** Citable books, in tie-break order. edition: null when the atlas copy does not state one. */
export const BOOKS = [
	{ id: "film-directing-shot-by-shot", edition: "25th anniversary edition" },
	{ id: "film-directing-cinematic-motion", edition: "2nd edition" },
	{ id: "master-shots-advanced", edition: null },
	{ id: "master-shots-vol2", edition: null },
	{ id: "master-shots-vol3", edition: null },
	{ id: "shooting-the-scene", edition: null },
	{ id: "the-visual-story", edition: "3rd edition" },
	{ id: "real-time-cameras", edition: null },
];

const CU = ["close-up", "closeup", "close-ups", "closeups", "cu", "close up"];
const DOLLY = ["dolly", "dollies", "dollied", "truck moves"];
const TRACK = ["tracking shot", "tracking shots", "tracking move", "tracking movement", "camera tracks", "camera track"];
const CRANE = ["crane shot", "camera cranes", "crane move", "crane moves", "camera crane", "camera boom"];
const ZOOM = ["zoom lens", "zoom lenses", "zoom shot", "zoom shots", "camera zooms", "zoom movement"];
const LINE = ["line of action", "crossing the line", "cross the line", "180-degree line", "180-degree rule", "180 degree rule", "cross the axis"];
const row = (terms, sections = [], tags = []) => ({ terms, sections, tags });

export const TABLE = {
	techniques: {
		"extreme-close-up": row(["extreme close-up", "extreme closeup", "ecu"], [], ["extreme-close-up"]),
		"close-up": row(CU, [], ["close-up"]),
		"choker": row(["choker"]),
		"head-shot": row(["head shot", "headshot"]),
		"italian-shot": row(["italian shot"]),
		"medium-close-up": row(["medium close-up", "medium closeup", "mcu"]),
		"medium-shot": row(["medium shot", "medium shots", "ms"], [], ["medium-shot"]),
		"cowboy-shot": row(["cowboy shot"]),
		"american-shot": row(["american shot"]),
		"full-shot": row(["full shot", "full shots"]),
		"long-shot": row(["long shot", "long shots", "ls"], [], ["long-shot"]),
		"wide-shot": row(["wide shot", "wide shots", "ws", "wide framing"], ["wide spaces"], ["wide-shot"]),
		"extreme-long-shot": row(["extreme long shot", "extreme wide shot"]),
		"eye-level": row(["eye level", "eye-level"], [], ["camera-height"]),
		"high-angle": row(["high angle", "high-angle"], ["high angle", "raised camera"], ["camera-height", "camera-angle"]),
		"low-angle": row(["low angle", "low-angle"], ["low and close", "low slide"], ["camera-height", "camera-angle"]),
		"birds-eye-view": row(["bird’s-eye", "bird’s eye", "birds eye"]),
		"overhead-shot": row(["overhead shot"]),
		"worms-eye-view": row(["worm’s-eye", "worm’s eye", "worms eye"]),
		"dutch-angle": row(["dutch angle", "dutch tilt"]),
		"canted-frame": row(["canted frame", "canted angle"]),
		"head-on-shot": row(["head-on shot"], ["moving straight on"]),
		"profile-shot": row(["profile shot"], ["profile shots"]),
		"trunk-shot": row(["trunk shot"]),
		"static-shot": row(["static camera", "static shot"], ["underlining stillness", "solid camera"]),
		"locked-down-shot": row(["locked-off", "locked off"], ["solid camera"]),
		"push-in": row(["push in", "push-in"], ["push"], ["camera-movement"]),
		"pull-out": row(["pull out", "pull-out"], ["moving out", "backwards dolly"], ["camera-movement"]),
		"dolly-in": row(["push in", ...DOLLY], ["subtle dolly", "conversation dolly"], ["camera-movement"]),
		"dolly-out": row(["pull out", "pull-out"], ["backwards dolly"], ["camera-movement"]),
		"zoom-shot": row(ZOOM, [], ["lens-choice"]),
		"crash-zoom": row(["crash zoom", "snap zoom"]),
		"dolly-zoom": row(["dolly zoom", "zolly"]),
		"vertigo-effect": row(["vertigo effect", "dolly zoom"]),
		"pan-shot": row(["camera pans", "camera pan", "pan shot", "pan shots", "pan move", "pan moves"], ["pan"], ["camera-movement"]),
		"tilt-shot": row(["camera tilts", "camera tilt", "tilt move"], ["tilt reveal"], ["camera-movement"]),
		"whip-pan": row(["whip pan", "swish pan"]),
		"pedestal-shot": row(["pedestal"]),
		"crane-shot": row(CRANE, [], ["camera-movement"]),
		"boom-shot": row(["camera boom", ...CRANE], [], ["camera-movement"]),
		"jib-shot": row(["jib", "jib arm"]),
		"arc-shot": row(["camera arcs"], ["arc and push", "motion circle", "turns and curves"], ["camera-movement"]),
		"360-degree-shot": row(["360-degree shot"], ["complex spin", "motion circle"]),
		"impossible-shot": row(["impossible shot"]),
		"aerial-shot": row(["aerial shot", "aerial shots"]),
		"tracking-shot": row(TRACK, ["track", "parallel track"], ["camera-movement"]),
		"smooth-tracking-shot": row(["steadicam", ...TRACK], ["parallel track"], ["camera-movement"]),
		"follow-shot": row(["follow shot"], ["travel with subject", "track character", "character chase", "move with camera"], ["camera-movement"]),
		"steadicam-shot": row(["steadicam", "steadycam"], ["tethered camera"]),
		"dolly-shot": row(DOLLY, ["subtle dolly", "conversation dolly", "velocity dolly"], ["camera-movement"]),
		"helicopter-shot": row(["helicopter shot"]),
		"oner": row(["long take", "oner"]),
		"two-shot": row(["two-shot", "two shots", "two-shots"], ["frame share", "side by side"], ["two-shot"]),
		"three-shot": row(["three-shot", "three shot"], ["line of three"]),
		"over-the-shoulder": row(["ots", "over-the-shoulder", "over the shoulder"], [], ["over-the-shoulder"]),
		"shot-reverse-shot": row(["shot/reverse shot", "reverse angle"], ["hard reverse", "flat reverse"], ["shot-reverse-shot"]),
		"reverse-angle": row(["reverse angle", "reverse angles"], ["hard reverse", "flat reverse"]),
		"pov-shot": row(["pov shot", "pov shots", "point of view shot", "subjective camera"], ["point of view", "moving point of view"], ["point-of-view"]),
		"master-shot": row(["master shot"], [], ["master-shot"]),
		"establishing-shot": row(["establishing shot", "establishing shots"], [], ["establishing-shot"]),
		"insert-shot": row(["insert shot", "cutaway", "cutaways"], [], ["insert", "cutaway"]),
		"handheld-shot": row(["handheld", "hand-held"]),
		"snorricam": row(["snorricam"]),
		"slow-motion": row(["slow motion"]),
		"rack-focus": row(["rack focus", "focus pull"], ["focus in"], ["focus"]),
	},
	patterns: {
		"shot-reverse-shot": row(["ots", "over-the-shoulder", "over the shoulder", "two-person 180° coverage"], ["hard reverse", "angle exchange"], ["over-the-shoulder", "coverage"]),
		"master-coverage": row(["master shot", "camera coverage", "covering the scene"], [], ["master-shot", "coverage"]),
		"dialogue-singles": row(["dialogue coverage", ...CU], ["coupled angles", "offset angles"], ["coverage", "close-up"]),
		"walk-and-talk": row(["walking and talking"], ["walking and talking", "track character"], ["coverage"]),
		"action-coverage": row(["action coverage", "fight coverage", "chase coverage", "staging action"], ["dynamic action"], ["coverage"]),
		"establish-detail": row(["establishing shot", "establishing shots"], [], ["establishing-shot", "close-up"]),
	},
	cuts: {
		line: row(LINE, ["crossing lines", "line cross", "side switch"], ["axis-eyeline"]),
		jump: row(["jump cut", "jump cuts"]),
		screen: row(["screen direction"], ["direction shift", "change of direction"], ["axis-eyeline"]),
		eyeline: row(["eyeline", "eyelines"], ["staged glances"], ["axis-eyeline"]),
	},
};
