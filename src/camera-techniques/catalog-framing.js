// Shot sizes and camera angles: the techniques that set where a single
// framing sits, not how it moves. Descriptions are CozyClay's own words.
import { lens, side, technique } from "./entry.js";

export const SIZE_TECHNIQUES = [
	technique("extreme-close-up", "Extreme Close-Up", "size", "ECU", {
		aliases: ["ECU", "XCU", "extreme closeup", "macro shot", "detail shot"], moods: ["intense", "intimate", "detail", "tension", "emotional"],
		description: "Fills the frame with a single feature, an eye, a mouth, a trembling hand, so the audience reads a feeling at the scale of skin.",
		params: { focalMm: lens(75) }, recipe: { size: "extreme close-up" }, prompt: "an extreme close-up" }),
	technique("close-up", "Close-Up Shot", "size", "CU", {
		aliases: ["CU", "close up", "closeup", "close shot", "tight shot"], moods: ["intimate", "emotional", "personal", "focus"],
		description: "Frames the face from about the chin to the top of the head; the face becomes the scene and every small change in expression lands.",
		params: { focalMm: lens(65) }, recipe: { size: "close-up" }, prompt: "a close-up on the face" }),
	technique("choker", "Choker Shot", "size", "CHOKER", {
		aliases: ["choker", "choker close-up", "tight close-up"], moods: ["tense", "claustrophobic", "intense", "confession", "pressure"],
		description: "A tighter close-up that crops from the throat to just above the eyebrows, squeezing the face for pressure or confession.",
		params: { focalMm: lens(70) }, recipe: { size: "choker" }, prompt: "a tight choker close-up from the throat to the brow" }),
	technique("head-shot", "Head Shot", "size", "HEAD", {
		aliases: ["headshot", "head and shoulders", "portrait shot"], moods: ["neutral", "portrait", "reaction", "interview"],
		description: "Keeps the whole head and a sliver of neck in frame, the neutral portrait size for reactions and interviews.",
		params: { focalMm: lens(60) }, recipe: { size: "head" }, prompt: "a head shot" }),
	technique("italian-shot", "Italian Shot", "size", "ITALIAN", {
		aliases: ["italian", "eyes shot", "leone shot", "extreme close-up on the eyes"], moods: ["standoff", "tense", "western", "duel", "suspense"],
		description: "An ultra-tight strip across the eyes alone, the duel-at-noon framing that turns a glance into a standoff.",
		params: { focalMm: lens(80) }, recipe: { size: "italian" }, prompt: "an Italian shot, an ultra-tight strip across the eyes" }),
	technique("medium-close-up", "Medium Close-Up", "size", "MCU", {
		aliases: ["MCU", "medium closeup", "bust shot", "chest up"], moods: ["conversational", "intimate", "dialogue", "emotional"],
		description: "From mid-chest up: close enough for emotion, wide enough to keep the shoulders and a hint of gesture.",
		params: { focalMm: lens(50) }, recipe: { size: "medium close-up" }, prompt: "a medium close-up from the chest up" }),
	technique("medium-shot", "Medium Shot", "size", "MS", {
		aliases: ["MS", "mid shot", "medium", "waist shot", "waist up"], moods: ["neutral", "conversational", "balanced", "dialogue"],
		description: "From the waist up, the workhorse size that balances the character's body language against the space around them.",
		params: { focalMm: lens(40) }, recipe: { size: "medium shot" }, prompt: "a medium shot from the waist up" }),
	technique("cowboy-shot", "Cowboy Shot", "size", "COWBOY", {
		aliases: ["cowboy", "mid-thigh shot", "medium long shot"], moods: ["confident", "western", "standoff", "swagger", "ready"],
		description: "Cuts at mid-thigh so a holstered hip stays in frame; posture and readiness read before the face does.",
		params: { focalMm: lens(35) }, recipe: { size: "cowboy" }, prompt: "a cowboy shot cut at mid-thigh" }),
	technique("american-shot", "American Shot", "size", "AMERICAN", {
		aliases: ["american", "plan americain", "knee shot", "three-quarter shot"], moods: ["classic", "group", "conversational", "theatrical"],
		description: "A three-quarter figure from the knees up, the studio-era size for actors standing and talking in a group.",
		params: { focalMm: lens(35) }, recipe: { size: "american" }, prompt: "an American shot from the knees up" }),
	technique("full-shot", "Full Shot", "size", "FS", {
		aliases: ["FS", "full body", "full figure", "head to toe"], moods: ["physical", "body language", "action", "costume"],
		description: "Head to toe with a little headroom and floor, so the whole body performs and costume and stance carry the moment.",
		params: { focalMm: lens(32) }, recipe: { size: "full" }, prompt: "a full shot, head to toe" }),
	technique("long-shot", "Long Shot", "size", "LS", {
		aliases: ["LS", "long", "wide long shot"], moods: ["context", "isolation", "distance", "observational"],
		description: "Shows the figure small against a readable slice of the location, placing the character inside their world.",
		params: { focalMm: lens(28) }, recipe: { size: "long" }, prompt: "a long shot, the figure small in the location" }),
	technique("wide-shot", "Wide Shot", "size", "WS", {
		aliases: ["WS", "wide", "wide angle shot"], moods: ["geography", "context", "open", "staging"],
		description: "Opens out so the setting shares the frame equally with the people in it, good for geography and staging.",
		params: { focalMm: lens(24) }, recipe: { size: "wide shot" }, prompt: "a wide shot" }),
	technique("extreme-long-shot", "Extreme Long Shot", "size", "ELS", {
		aliases: ["ELS", "XLS", "EWS", "extreme wide shot", "extreme wide", "very long shot"], moods: ["epic", "isolation", "vast", "lonely", "grand", "scale"],
		description: "The figure becomes a speck inside a vast landscape or city; scale, solitude or spectacle become the subject.",
		params: { focalMm: lens(20) }, recipe: { size: "extreme wide shot" }, prompt: "an extreme long shot, the figure tiny in a vast space" }),
];

export const ANGLE_TECHNIQUES = [
	technique("eye-level", "Eye-Level Shot", "angle", "EYE", {
		aliases: ["eye level", "eye-level angle", "neutral angle"], moods: ["neutral", "honest", "calm", "relatable"],
		description: "The lens sits at the subject's eye height, a neutral, honest vantage that neither flatters nor judges.",
		params: { side: side() }, recipe: { level: "eye" }, prompt: "at eye level" }),
	technique("high-angle", "High Angle Shot", "angle", "HIGH", {
		aliases: ["high angle", "high shot", "looking down", "from above"], moods: ["vulnerable", "weak", "small", "overwhelmed", "watched"],
		description: "The camera looks down from above eye height, making the subject seem smaller, watched or overwhelmed.",
		params: { side: side() }, recipe: { level: "high" }, prompt: "from a high angle looking down" }),
	technique("low-angle", "Low Angle Shot", "angle", "LOW", {
		aliases: ["low angle", "low shot", "looking up", "from below", "hero angle"], moods: ["powerful", "heroic", "menacing", "dominant", "epic", "imposing"],
		description: "The camera sits below the eyes and looks up, lending the subject size, authority or menace.",
		params: { side: side() }, recipe: { level: "low" }, prompt: "from a low angle looking up" }),
	technique("birds-eye-view", "Bird's Eye View", "angle", "BIRD'S EYE", {
		aliases: ["birds eye", "bird's-eye", "god's eye", "gods eye view", "god view", "top-down angle"], moods: ["detached", "omniscient", "epic", "isolation", "fate"],
		description: "A steep view from high above that maps the subject and the space around them like a diagram, cool and detached.",
		params: { side: side() }, recipe: { level: "birds" }, prompt: "a steep bird's-eye view from high above" }),
	technique("overhead-shot", "Overhead Shot", "angle", "OVERHEAD", {
		aliases: ["overhead", "top shot", "top down", "flat lay", "ceiling shot"], moods: ["graphic", "detached", "stylized", "clinical", "pattern"],
		description: "Straight down from directly above, flattening the action into a graphic pattern on the floor plane.",
		params: { side: side() }, recipe: { level: "overhead" }, prompt: "straight down from directly overhead" }),
	technique("worms-eye-view", "Worm's Eye View", "angle", "WORM'S EYE", {
		aliases: ["worms eye", "worm's-eye", "ground level shot", "floor shot", "from the ground"], moods: ["imposing", "menacing", "awe", "towering", "epic"],
		description: "From the floor itself, tilting steeply up, so even ordinary people and rooms loom like monuments.",
		params: { side: side() }, recipe: { level: "worm" }, prompt: "a worm's-eye view from the floor looking steeply up" }),
	technique("dutch-angle", "Dutch Angle", "angle", "DUTCH", {
		aliases: ["dutch", "dutch tilt", "oblique angle", "tilted shot"], moods: ["uneasy", "disoriented", "unstable", "tension", "madness"],
		description: "Rolls the horizon off level so the world feels tipped; it tells the audience that something is wrong.",
		params: { rollDeg: { type: "number", min: 5, max: 45, default: 20, unit: "deg" } }, recipe: { roll: true }, requires: ["roll"],
		prompt: "a Dutch angle, the horizon tilted about 20 degrees" }),
	technique("canted-frame", "Canted Frame", "angle", "CANTED", {
		aliases: ["canted", "canted angle", "slight tilt"], moods: ["uneasy", "nervous", "kinetic", "off-balance"],
		description: "A gentler tilt of the frame that adds a nervous edge or kinetic energy without a full Dutch lean.",
		params: { rollDeg: { type: "number", min: 3, max: 20, default: 8, unit: "deg" } }, recipe: { roll: true }, requires: ["roll"],
		prompt: "a slightly canted frame" }),
	technique("head-on-shot", "Head-On Shot", "angle", "HEAD-ON", {
		aliases: ["head on", "head-on", "straight on", "frontal shot"], moods: ["confrontational", "direct", "intense", "approach"],
		description: "The camera faces the subject squarely on their axis, so they meet the lens and confront the viewer.",
		params: { level: { type: "enum", options: ["eye", "low", "high"], default: "eye" } }, recipe: { view: "front" }, prompt: "head-on, the subject square to the lens" }),
	technique("profile-shot", "Profile Shot", "angle", "PROFILE", {
		aliases: ["profile", "side shot", "side angle", "side-on"], moods: ["contemplative", "observational", "detached", "silhouette"],
		description: "Sees the subject exactly side-on, a silhouette-like view that reads as observation or contemplation.",
		params: { side: side() }, recipe: { view: "profile" }, prompt: "in profile, side-on to the subject" }),
	technique("trunk-shot", "Trunk Shot", "angle", "TRUNK", {
		aliases: ["trunk", "boot shot", "car trunk shot", "inside the trunk"], moods: ["ominous", "menacing", "dark comedy", "crime", "suspense"],
		description: "A low, wide view up from inside an open car boot, with the people above peering down at whatever lies inside.",
		params: { focalMm: lens(20) }, recipe: { level: "trunk", view: "front", size: "medium-wide shot" }, prompt: "a trunk shot, looking up from inside an open car boot" }),
];
