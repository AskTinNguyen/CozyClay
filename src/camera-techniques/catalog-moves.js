// Camera moves and lens moves the studio keys on a shot: each recipe names a
// move the compiler lays as camera keys, and `expect` is the move the
// geometry classifier (camera-move.js classifyMove) must read back.
import { choice, degrees, lens, metres, size, speed, steps, technique } from "./entry.js";

const dolly = (value) => ({ speed: speed(value), steps: steps(2), from: size(), to: size() });

export const MOVE_TECHNIQUES = [
	technique("static-shot", "Static Shot", "move", "STATIC", {
		aliases: ["static", "still shot", "fixed shot", "no camera move"], moods: ["calm", "observational", "still", "patient", "contemplative"],
		description: "The camera holds one position and lens for the whole shot, letting the performance or the composition do the work.",
		params: { focalMm: lens(35) }, recipe: { move: "static" }, prompt: "a static camera", expect: "static" }),
	technique("locked-down-shot", "Locked-Down Shot", "move", "LOCKED", {
		aliases: ["locked down", "locked off", "locked-off", "tripod shot", "lock-off"], moods: ["still", "observational", "deadpan", "clinical"],
		description: "A tripod-fixed frame with no adjustment at all, often used so action can enter and leave an unchanging picture.",
		params: { focalMm: lens(35) }, recipe: { move: "static" }, prompt: "a locked-off camera on a tripod", expect: "static" }),
	technique("push-in", "Push In", "move", "PUSH-IN", {
		aliases: ["push in", "push-in", "slow push", "creep in", "move in"], moods: ["tension", "realization", "intimate", "suspense", "focus", "dramatic"],
		description: "The camera creeps toward the subject, tightening the frame to build attention, tension or a dawning realization.",
		params: dolly("slow"), recipe: { move: "dolly", dir: "in" }, prompt: "a slow push-in", expect: "push-in" }),
	technique("pull-out", "Pull Out", "move", "PULL-OUT", {
		aliases: ["pull out", "pull back", "pull-back", "back out", "move out"], moods: ["reveal", "isolation", "lonely", "ending", "distance"],
		description: "The camera drifts back from the subject, revealing context or leaving them alone in a growing space.",
		params: dolly("slow"), recipe: { move: "dolly", dir: "out" }, prompt: "a pull-out revealing the space", expect: "pull-out" }),
	technique("dolly-in", "Dolly-In", "move", "DOLLY IN", {
		aliases: ["dolly in", "dolly forward", "track in", "truck in"], moods: ["intimate", "tension", "focus", "approach"],
		description: "A physical move on wheels toward the subject; the perspective deepens because the camera really travels.",
		params: dolly("medium"), recipe: { move: "dolly", dir: "in" }, prompt: "a dolly-in on the subject", expect: "push-in" }),
	technique("dolly-out", "Dolly-Out", "move", "DOLLY OUT", {
		aliases: ["dolly out", "dolly back", "track out", "truck out"], moods: ["reveal", "release", "distance", "ending"],
		description: "A physical move on wheels away from the subject, with the room's perspective opening up as the lens retreats.",
		params: dolly("medium"), recipe: { move: "dolly", dir: "out" }, prompt: "a dolly-out away from the subject", expect: "pull-out" }),
	technique("zoom-shot", "Zoom Shot", "lens", "ZOOM", {
		aliases: ["zoom", "zoom in", "zoom out", "lens zoom"], moods: ["observational", "documentary", "retro", "emphasis"],
		description: "The lens changes focal length while the camera stays put, magnifying or widening the view without any parallax.",
		params: { direction: choice(["in", "out"]), speed: speed("medium"), steps: steps(2) }, recipe: { move: "zoom" }, prompt: "an optical zoom", expect: "zoom-in" }),
	technique("crash-zoom", "Crash Zoom", "lens", "CRASH ZOOM", {
		aliases: ["crash zoom", "snap zoom", "smash zoom", "zip zoom"], moods: ["shock", "comedic", "sudden", "emphasis", "energetic"],
		description: "A sudden, very fast zoom onto a face or object that slams emphasis on it, at constant speed with no easing, for shock or comedy.",
		params: { steps: steps(3), frames: { type: "number", min: 3, max: 16, default: 6, unit: "frames" } }, recipe: { move: "crash-zoom" },
		prompt: "a sudden crash zoom", expect: "zoom-in" }),
	technique("dolly-zoom", "Dolly Zoom", "lens", "DOLLY ZOOM", {
		aliases: ["dolly zoom", "zolly", "contra zoom", "trombone shot", "reverse tracking zoom"], moods: ["vertigo", "dread", "uneasy", "realization", "disorienting", "shock"],
		description: "The camera travels while the lens zooms the opposite way, holding the subject's size as the background warps around them.",
		params: { direction: choice(["in", "out"]), speed: speed("slow") }, recipe: { move: "dolly-zoom" }, prompt: "a dolly zoom", expect: "dolly-zoom" }),
	technique("vertigo-effect", "Vertigo Effect", "lens", "VERTIGO", {
		aliases: ["vertigo", "vertigo shot", "hitchcock zoom", "hitchcock shot"], moods: ["vertigo", "panic", "dread", "uneasy", "realization", "fear"],
		description: "The stomach-drop dolly zoom: the subject freezes in size while the world behind them lurches, for panic or a terrible realization.",
		params: { direction: choice(["out", "in"]), speed: speed("medium") }, recipe: { move: "dolly-zoom" }, prompt: "a vertigo effect", expect: "dolly-zoom" }),
	technique("pan-shot", "Pan Shot", "move", "PAN", {
		aliases: ["pan", "panning shot", "pan across", "swish"], moods: ["reveal", "scanning", "follow", "survey"],
		description: "The camera pivots left or right on a fixed head, scanning a space or arriving on the subject.",
		params: { direction: choice(["right", "left"]), degrees: degrees(45, 10, 170), speed: speed("medium") }, recipe: { move: "pan" },
		prompt: "a pan", expect: "pan-right" }),
	technique("tilt-shot", "Tilt Shot", "move", "TILT", {
		aliases: ["tilt", "tilt up", "tilt down", "tilting shot"], moods: ["reveal", "scale", "height", "awe"],
		description: "The camera pivots up or down on its head, travelling from feet to face or up the height of something tall.",
		params: { direction: choice(["up", "down"]), degrees: degrees(35, 5, 80), speed: speed("medium") }, recipe: { move: "tilt" },
		prompt: "a tilt", expect: "tilt-up" }),
	technique("whip-pan", "Whip Pan", "move", "WHIP PAN", {
		aliases: ["whip pan", "whip-pan", "flash pan", "swish pan", "zip pan"], moods: ["energetic", "kinetic", "transition", "frantic", "comedic"],
		description: "A pan so fast the image smears, used as an energetic transition or to snap from one subject to another.",
		params: { direction: choice(["right", "left"]), degrees: degrees(90, 30, 180), frames: { type: "number", min: 3, max: 12, default: 5, unit: "frames" }, shutterDeg: degrees(270, 90, 360) },
		recipe: { move: "whip-pan", shutter: true }, prompt: "a whip pan with heavy motion blur", expect: "pan-right" }),
	technique("pedestal-shot", "Pedestal Shot", "move", "PEDESTAL", {
		aliases: ["pedestal", "ped up", "ped down", "pedestal up", "elevator shot"], moods: ["reveal", "measured", "smooth", "rise"],
		description: "The whole camera rises or sinks straight up and down without tilting, sliding the frame vertically past the subject.",
		params: { direction: choice(["up", "down"]), rise: metres(1, 0.4, 3), speed: speed("medium") }, recipe: { move: "pedestal" },
		prompt: "a pedestal move", expect: "crane-up" }),
	technique("crane-shot", "Crane Shot", "move", "CRANE", {
		aliases: ["crane", "crane up", "crane down", "rising shot"], moods: ["epic", "reveal", "grand", "majestic", "ending", "uplifting"],
		description: "The camera sweeps up or down on a long arm, rising to reveal the scene or descending into it while the subject stays in view.",
		params: { direction: choice(["up", "down"]), rise: metres(2.5, 0.6, 8), speed: speed("slow") }, recipe: { move: "crane" },
		prompt: "a sweeping crane move", expect: "crane-up" }),
	technique("boom-shot", "Boom Shot", "move", "BOOM", {
		aliases: ["boom", "boom down", "boom up", "descending shot"], moods: ["arrival", "descend", "reveal", "intimate"],
		description: "A vertical move on a boom arm, by default a descent from above into the subject's space.",
		params: { direction: choice(["down", "up"]), rise: metres(1.8, 0.5, 6), speed: speed("medium") }, recipe: { move: "crane" },
		prompt: "a boom move", expect: "crane-down" }),
	technique("jib-shot", "Jib Shot", "move", "JIB", {
		aliases: ["jib", "jib up", "jib arm", "mini crane"], moods: ["elegant", "smooth", "reveal", "production value"],
		description: "A small arm lifts the camera in a gentle curve, adding lift and polish to an otherwise simple frame.",
		params: { direction: choice(["up", "down"]), rise: metres(1.2, 0.5, 3), speed: speed("medium") }, recipe: { move: "jib", arcDeg: 12 },
		prompt: "a gentle jib move", expect: "crane-up" }),
	technique("arc-shot", "Arc Shot", "move", "ARC", {
		aliases: ["arc", "arcing shot", "orbit", "orbit shot", "circle around"], moods: ["dynamic", "romantic", "tension", "heroic", "reveal"],
		description: "The camera travels on a curve around the subject, sliding the background behind them while they stay centred.",
		params: { direction: choice(["right", "left"]), degrees: degrees(60, 20, 180), speed: speed("medium") }, recipe: { move: "arc" },
		prompt: "an arc around the subject", expect: "orbit" }),
	technique("360-degree-shot", "360-Degree Shot", "move", "360", {
		aliases: ["360", "360 shot", "full circle", "spin around", "360 orbit", "circle shot"], moods: ["epic", "romantic", "triumphant", "dizzying", "heroic"],
		description: "A full circle around the subject at constant speed, the world spinning behind them for triumph, romance or confusion.",
		params: { direction: choice(["right", "left"]), degrees: degrees(360, 180, 720), speed: speed("slow") }, recipe: { move: "orbit" },
		prompt: "a full 360-degree orbit around the subject", expect: "orbit" }),
	technique("impossible-shot", "Impossible Shot", "move", "IMPOSSIBLE", {
		aliases: ["impossible", "impossible camera", "through the ceiling", "virtual camera move"], moods: ["surreal", "spectacular", "playful", "epic", "dreamlike"],
		description: "A move no physical rig could make: here one continuous rise from a close view straight up through the set to a bird's-eye, possible because the camera is virtual.",
		params: { height: metres(12, 4, 30), speed: speed("slow") }, recipe: { move: "rise-through" }, prompt: "an impossible continuous rise through the set", expect: "crane-up" }),
	technique("aerial-shot", "Aerial Shot", "move", "AERIAL", {
		aliases: ["aerial", "drone shot", "drone", "flyover", "fly over", "from the air"], moods: ["epic", "grand", "establishing", "majestic", "freedom", "reveal"],
		description: "A high airborne view gliding over the land toward the subject, the drone or plane shot that sets a grand scale.",
		params: { altitude: metres(22, 8, 120), speed: speed("slow") }, recipe: { move: "aerial" }, prompt: "a gliding aerial drone shot", expect: "push-in" }),
];
