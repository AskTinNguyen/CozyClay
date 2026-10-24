// Rig moves laid as a camera rail, coverage framings built from the cast,
// and modifiers. Techniques whose `requires` names a planned capability
// apply as prompt words only (entry.js PLANNED_CAPABILITIES).
import { cast, choice, degrees, metres, side, speed, technique } from "./entry.js";

const rail = (value = "medium") => ({ direction: choice(["right", "left"]), speed: speed(value) });

export const RIG_TECHNIQUES = [
	technique("tracking-shot", "Tracking Shot", "move", "TRACK", {
		aliases: ["tracking", "track", "trucking shot", "truck shot", "travelling shot", "lateral track"], moods: ["follow", "energetic", "journey", "action", "pace"],
		description: "The camera travels beside the subject on a track, keeping pace so movement and the passing background read together.",
		params: rail(), recipe: { move: "rail", view: "profile", size: "full", lengthRatio: 0.25 }, prompt: "a lateral tracking shot alongside the subject", expect: "tracking" }),
	technique("smooth-tracking-shot", "Smooth Tracking Shot", "move", "SMOOTH TRACK", {
		aliases: ["smooth tracking", "smooth track", "glide", "gliding shot", "slider shot"], moods: ["elegant", "smooth", "dreamy", "luxurious", "calm"],
		description: "A long, glassy lateral glide with gentle starts and stops, the polished version of a tracking move.",
		params: rail("slow"), recipe: { move: "rail", view: "front three-quarter", size: "medium-wide shot", lengthRatio: 0.28, smooth: true },
		prompt: "a smooth, gliding tracking shot", expect: "tracking" }),
	technique("follow-shot", "Follow Shot", "move", "FOLLOW", {
		aliases: ["follow", "following shot", "chase cam", "from behind", "tail shot"], moods: ["pursuit", "journey", "immersive", "suspense", "chase"],
		description: "Stays with the subject from behind and slightly off to one side, pulling the audience along on their path.",
		params: rail(), recipe: { move: "rail", view: "rear three-quarter", size: "medium-wide shot", lengthRatio: 0.25 }, prompt: "a follow shot from behind the subject", expect: "tracking" }),
	technique("steadicam-shot", "Steadicam Shot", "move", "STEADICAM", {
		aliases: ["steadicam", "steadycam", "stabilized shot", "gimbal shot", "gimbal"], moods: ["immersive", "fluid", "intimate", "flowing", "dreamlike"],
		description: "A body-stabilized operator floats with the subject, fluid and human without the shake of handheld.",
		params: rail("slow"), recipe: { move: "rail", view: "rear three-quarter", size: "medium shot", lengthRatio: 0.22, height: 1.45, smooth: true },
		prompt: "a floating Steadicam shot", expect: "tracking" }),
	technique("dolly-shot", "Dolly Shot", "move", "DOLLY", {
		aliases: ["dolly", "dolly track", "dolly move", "track and dolly"], moods: ["smooth", "classic", "measured", "elegant"],
		description: "Any move made on a wheeled dolly running on track; here a measured lateral move across the front of the subject.",
		params: rail(), recipe: { move: "rail", view: "front three-quarter", size: "medium shot", lengthRatio: 0.25 }, prompt: "a dolly move on track", expect: "tracking" }),
	technique("helicopter-shot", "Helicopter Shot", "move", "HELI", {
		aliases: ["helicopter", "heli shot", "chopper shot", "airborne pass"], moods: ["epic", "grand", "sweeping", "majestic", "scale"],
		description: "A high, sweeping pass flown past the location, the subject a small point inside the scale of the land.",
		params: { ...rail("slow"), altitude: metres(12, 5, 80) }, recipe: { move: "rail", view: "front three-quarter", size: "extreme wide shot", lengthRatio: 0.3, altitude: true },
		prompt: "a sweeping helicopter shot", expect: "tracking" }),
	technique("oner", "One-er (Oner)", "modifier", "ONE-ER", {
		aliases: ["oner", "one-er", "one take", "long take", "single take", "unbroken take", "plan sequence"], moods: ["immersive", "virtuosic", "tension", "real time", "continuous"],
		description: "A single unbroken take that moves through the scene with no cuts; here a long continuous arc around the action on one rail.",
		params: { ...rail("slow"), degrees: degrees(120, 60, 200) }, recipe: { move: "rail", path: "arc", size: "medium-wide shot" },
		prompt: "one continuous unbroken take with no cuts", expect: "orbit" }),
];

export const COVERAGE_TECHNIQUES = [
	technique("two-shot", "Two-Shot", "coverage", "2-SHOT", {
		aliases: ["two shot", "2 shot", "2-shot", "two-shot", "duo shot"], moods: ["relationship", "conversation", "intimacy", "confrontation", "romance"],
		description: "Frames two people together so their relationship, distance and body language read in one picture.",
		params: { with: cast(), side: side() }, recipe: { group: 2 }, prompt: "a two-shot holding both characters" }),
	technique("three-shot", "Three-Shot", "coverage", "3-SHOT", {
		aliases: ["three shot", "3 shot", "3-shot", "trio shot"], moods: ["group", "ensemble", "tension", "balance"],
		description: "Holds three characters in one composition, balancing a group or a triangle of tension.",
		params: { side: side() }, recipe: { group: 3 }, prompt: "a three-shot holding all three characters" }),
	technique("over-the-shoulder", "Over-the-Shoulder Shot", "coverage", "OTS", {
		aliases: ["OTS", "over the shoulder", "over-shoulder", "over shoulder", "dirty single"], moods: ["conversation", "dialogue", "confrontation", "intimacy"],
		description: "Looks past one character's shoulder at another, anchoring the viewer inside a conversation from one side.",
		params: { over: cast(), side: side() }, recipe: { ots: true }, prompt: "over the shoulder of the foreground character" }),
	technique("shot-reverse-shot", "Shot-Reverse-Shot", "coverage", "SRS", {
		aliases: ["shot reverse shot", "shot/reverse shot", "shot countershot", "reverse coverage"], moods: ["conversation", "dialogue", "exchange"],
		description: "A dialogue pattern that alternates between two speakers' views; here it frames the first over-the-shoulder side and leaves the reverse to coverage.",
		params: { over: cast(), side: side() }, recipe: { ots: true }, requires: ["coverage-generator"], prompt: "the first side of a shot-reverse-shot exchange" }),
	technique("reverse-angle", "Reverse Angle", "coverage", "REVERSE", {
		aliases: ["reverse", "reverse shot", "opposite angle", "180 reverse"], moods: ["reveal", "answer", "contrast"],
		description: "Swings to the opposite side of the subject from the current camera, showing what the previous view was facing.",
		params: { side: side() }, recipe: { reverse: true }, prompt: "a reverse angle from the opposite side" }),
	technique("pov-shot", "P.O.V. Shot", "coverage", "POV", {
		aliases: ["POV", "point of view", "point-of-view", "subjective shot", "first person", "through her eyes", "through his eyes"],
		moods: ["subjective", "immersive", "voyeur", "suspense", "horror"],
		description: "Sees through a character's eyes, from their head height toward what they look at, putting the viewer in their place.",
		params: { of: cast(), target: cast() }, recipe: { pov: true }, prompt: "a point-of-view shot through the character's eyes" }),
	technique("master-shot", "Master Shot", "coverage", "MASTER", {
		aliases: ["master", "master wide", "cover shot", "safety wide"], moods: ["context", "geography", "ensemble", "coverage"],
		description: "A wide frame that holds every character in the scene for its whole length, the safety net the edit keeps returning to.",
		params: { side: side() }, recipe: { group: "all", size: "wide shot" }, prompt: "a master shot holding the whole scene" }),
	technique("establishing-shot", "Establishing Shot", "coverage", "ESTABLISH", {
		aliases: ["establishing", "est shot", "opening wide", "location shot"], moods: ["context", "opening", "geography", "epic", "location"],
		description: "Opens a scene with a wide, high look at the place, telling the audience where and when before anyone speaks.",
		params: { height: metres(6, 2, 40) }, recipe: { size: "establishing", level: "establish" }, prompt: "a high, wide establishing shot of the location" }),
	technique("insert-shot", "Insert Shot", "coverage", "INSERT", {
		aliases: ["insert", "cutaway", "detail insert", "hands shot"], moods: ["detail", "clue", "emphasis", "information"],
		description: "A tight cutaway to a detail, hands, a note, a key, that the story needs the audience to notice.",
		params: { focus: choice(["hands", "face", "feet"]) }, recipe: { size: "insert", level: "insert" }, prompt: "an insert on the detail" }),
];

export const MODIFIER_TECHNIQUES = [
	technique("handheld-shot", "Handheld Shot", "modifier", "HANDHELD", {
		aliases: ["handheld", "hand-held", "shaky cam", "shoulder cam", "documentary style"], moods: ["chaotic", "urgent", "raw", "documentary", "anxious"],
		description: "Operated on the shoulder with natural breathing and jolts, for urgency, chaos or documentary closeness.",
		params: { intensity: choice(["subtle", "strong"]) }, recipe: { shake: true }, prompt: "handheld camera with natural shake" }),
	technique("snorricam", "Snorricam", "modifier", "SNORRICAM", {
		aliases: ["snorri cam", "body mount", "body cam", "chest rig"], moods: ["disoriented", "drunk", "panic", "frantic", "uneasy"],
		description: "A rig strapped to the actor's body keeps their face locked in frame while the world lurches around them.",
		params: { mount: choice(["chest", "back"]) }, recipe: { mount: true }, prompt: "a Snorricam body-mounted camera locked on the face" }),
	technique("slow-motion", "Slow Motion", "modifier", "SLO-MO", {
		aliases: ["slow motion", "slow-mo", "slomo", "slo mo", "high frame rate"], moods: ["dramatic", "dreamy", "epic", "emotional", "impact"],
		description: "Plays the action slower than life to stretch a moment of beauty, impact or emotion.",
		params: { rate: choice(["half", "quarter"]) }, recipe: { speed: true }, prompt: "in slow motion" }),
	technique("rack-focus", "Rack Focus", "lens", "RACK", {
		aliases: ["rack focus", "focus pull", "pull focus", "focus shift"], moods: ["reveal", "attention", "suspense", "subtle"],
		description: "Shifts focus from one plane to another within the shot, steering attention without a cut.",
		params: { from: cast(), to: cast(), fStop: { type: "number", min: 1.4, max: 8, default: 1.4, unit: "f-stop" } }, recipe: { rack: true }, prompt: "a rack focus between foreground and background" }),
];
