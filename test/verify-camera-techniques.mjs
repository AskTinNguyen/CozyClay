// Camera technique library: the catalog holds every technique the intent
// names (docs/intent/camera-techniques/prompt.md), each entry is complete,
// and the resolver turns natural phrases into the right techniques.
import assert from "node:assert/strict";
import { TECHNIQUES, capabilityFields, describeTechnique, hasGeometry, techniqueById, techniqueIndex } from "../src/camera-techniques/index.js";
import { normalizePhrase, parseRequest, resolveTechnique, searchByMood, searchTechniques } from "../src/camera-techniques/resolve.js";
import { PLANNED_CAPABILITIES, TECHNIQUE_KINDS, resolveParams } from "../src/camera-techniques/entry.js";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("ok -", name); };

// The 65 names, as the intent lists them.
const NAMES = ["Aerial Shot", "Bird's Eye View", "Close-Up Shot", "Dutch Angle", "Dolly Shot", "Establishing Shot", "Extreme Close-Up", "Extreme Long Shot",
	"Eye-Level Shot", "Handheld Shot", "Head-On Shot", "Helicopter Shot", "High Angle Shot", "Insert Shot", "Long Shot", "Low Angle Shot", "Master Shot",
	"Medium Shot", "Over-the-Shoulder Shot", "Overhead Shot", "Pan Shot", "P.O.V. Shot", "Rack Focus", "Slow Motion", "Steadicam Shot", "Tracking Shot",
	"Vertigo Effect", "Crane Shot", "One-er (Oner)", "Tilt Shot", "Whip Pan", "Two-Shot", "Three-Shot", "Cowboy Shot", "Medium Close-Up", "Choker Shot",
	"Canted Frame", "Zoom Shot", "Push In", "Pull Out", "360-Degree Shot", "Static Shot", "Crash Zoom", "Snorricam", "Locked-Down Shot", "Worm's Eye View",
	"Impossible Shot", "Arc Shot", "Boom Shot", "Dolly-In", "Dolly-Out", "Dolly Zoom", "Follow Shot", "Jib Shot", "Pedestal Shot", "Smooth Tracking Shot",
	"American Shot", "Full Shot", "Head Shot", "Italian Shot", "Profile Shot", "Reverse Angle", "Shot-Reverse-Shot", "Trunk Shot", "Wide Shot"];
// The capability each Non-Goal technique waits for (prompt.md Non-Goals).
// The camera capabilities these techniques used to wait for exist now (camera-capabilities intent): each sets its field.
const SETS = { "Dutch Angle": "rollDeg", "Canted Frame": "rollDeg", "Rack Focus": "lens+focus keys", "Handheld Shot": "shake", "Snorricam": "mount",
	"Slow Motion": "speed", "Whip Pan": "shutterDeg" };

check("the catalog holds exactly the 65 named techniques", () => {
	assert.equal(NAMES.length, 65);
	assert.equal(TECHNIQUES.length, 65);
	for (const name of NAMES) assert.ok(TECHNIQUES.some((entry) => entry.name === name), `missing ${name}`);
});

check("every name resolves to its own entry", () => {
	for (const name of NAMES) assert.equal(techniqueById(resolveTechnique(name)?.id)?.name, name, name);
});

check("ids, names and aliases are unique across the catalog", () => {
	assert.equal(new Set(TECHNIQUES.map((entry) => entry.id)).size, 65);
	const seen = new Map();
	for (const entry of TECHNIQUES) {
		for (const key of new Set([entry.name, entry.id, ...entry.aliases].map(normalizePhrase))) {
			assert.ok(!seen.has(key) || seen.get(key) === entry.id, `"${key}" names both ${seen.get(key)} and ${entry.id}`);
			seen.set(key, entry.id);
		}
	}
});

check("every entry has every field, well formed", () => {
	for (const entry of TECHNIQUES) {
		assert.match(entry.id, /^[a-z0-9-]+$/);
		assert.ok(TECHNIQUE_KINDS.includes(entry.kind), `${entry.id} kind`);
		assert.ok(entry.tag && entry.tag === entry.tag.toUpperCase() && entry.tag.length <= 14, `${entry.id} tag`);
		assert.ok(entry.aliases.length >= 2, `${entry.id} aliases`);
		assert.ok(entry.moods.length >= 3, `${entry.id} moods`);
		const sentences = entry.description.split(/[.!?](\s|$)/).filter((part) => part.trim()).length;
		assert.ok(entry.description.length >= 60 && entry.description.length <= 240 && sentences <= 2, `${entry.id} description`);
		assert.ok(Object.keys(entry.params).length >= 1, `${entry.id} params`);
		for (const [key, schema] of Object.entries(entry.params)) assert.ok("default" in schema && schema.type, `${entry.id}.${key}`);
		assert.equal(typeof entry.recipe, "object");
		assert.ok(entry.prompt?.length > 4, `${entry.id} prompt`);
		assert.ok(Array.isArray(entry.requires));
		for (const need of entry.requires) assert.ok(PLANNED_CAPABILITIES[need], `${entry.id} requires ${need}`);
		assert.ok(hasGeometry(entry) || capabilityFields(entry).length || entry.requires.length, `${entry.id} has neither a recipe nor a capability it sets or waits for`);
	}
});

check("the capability techniques set their camera field; only the coverage generator is still waited for", () => {
	for (const [name, field] of Object.entries(SETS)) assert.deepEqual(capabilityFields(TECHNIQUES.find((entry) => entry.name === name)), [field], name);
	const waiting = TECHNIQUES.filter((entry) => entry.requires.length).map((entry) => entry.name).sort();
	assert.deepEqual(waiting, ["Shot-Reverse-Shot"]);
	assert.deepEqual(Object.keys(PLANNED_CAPABILITIES), ["coverage-generator"]);
});

check("descriptions are written fresh: none repeats a technique's name as a dictionary gloss", () => {
	for (const entry of TECHNIQUES) assert.ok(!/^(a|an|the)\s+[a-z -]+ (is|refers to)\b/i.test(entry.description), entry.id);
});

check("params resolve with defaults and clamp to their range", () => {
	const pan = techniqueById("pan-shot");
	assert.deepEqual(resolveParams(pan, {}), { direction: "right", degrees: 45, speed: "medium" });
	assert.deepEqual(resolveParams(pan, { degrees: 900, direction: "left", speed: "warp" }), { direction: "left", degrees: 170, speed: "medium" });
});

check("the compact index fits one receipt and describeTechnique answers the rest", () => {
	const index = techniqueIndex(), bytes = Buffer.byteLength(JSON.stringify(index));
	assert.equal(index.techniques.length, 65);
	assert.ok(bytes < 6000, `${bytes} bytes`);
	const vertigo = describeTechnique("vertigo-effect");
	assert.equal(vertigo.expectedMove, "dolly-zoom");
	assert.equal(describeTechnique("dutch-angle").promptOnly, undefined);
	assert.deepEqual(describeTechnique("whip-pan").sets, ["shutterDeg"]);
	assert.equal(describeTechnique("shot-reverse-shot").promptOnly, "partly");
	assert.equal(techniqueIndex({ kind: "size" }).count, 13);
	console.log(`  index ${bytes} bytes`);
});

// Phrase -> technique: exact names, aliases, spelling slips and moods.
const PHRASES = [
	["vertigo", "vertigo-effect"], ["zolly", "dolly-zoom"], ["Hitchcock zoom", "vertigo-effect"], ["god's eye", "birds-eye-view"],
	["OTS", "over-the-shoulder"], ["POV", "pov-shot"], ["p.o.v.", "pov-shot"], ["worm's eye", "worms-eye-view"], ["oner", "oner"],
	["steadycam", "steadicam-shot"], ["drone shot", "aerial-shot"], ["locked off", "locked-down-shot"], ["ECU", "extreme-close-up"],
	["close up", "close-up"], ["360", "360-degree-shot"], ["dutch tilt", "dutch-angle"], ["snap zoom", "crash-zoom"], ["two shot", "two-shot"],
	["vertgo", "vertigo-effect"], ["dolly zom", "dolly-zoom"], ["hitchock zoom", "vertigo-effect"], ["trackng shot", "tracking-shot"],
	["over the sholder", "over-the-shoulder"], ["establising shot", "establishing-shot"], ["snoricam", "snorricam"],
	["uneasy", "dutch-angle"], ["epic reveal", "crane-shot"], ["intimate", "close-up"], ["make it feel vulnerable", "high-angle"],
	["something feels wrong", "dutch-angle"], ["heroic", "low-angle"], ["lonely ending", "pull-out"],
];
check(`the resolver maps ${PHRASES.length} phrases to the right technique`, () => {
	assert.ok(PHRASES.length >= 20);
	for (const [phrase, id] of PHRASES) assert.equal(resolveTechnique(phrase)?.id, id, `"${phrase}" -> ${JSON.stringify(resolveTechnique(phrase))}`);
});

check("mood search ranks by the strength of the mood", () => {
	const { moods, results } = searchByMood("make the reveal feel epic");
	assert.deepEqual(moods.sort(), ["epic", "reveal"]);
	assert.equal(results[0].id, "crane-shot");
});

check("a director's sentence becomes a stack with params", () => {
	const cast = [{ id: "actor-a", name: "Mara" }, { id: "actor-b", name: "Joon" }];
	const push = parseRequest("low-angle slow push-in on Mara", { cast });
	assert.deepEqual(push.stack, [{ id: "low-angle" }, { id: "push-in", params: { speed: "slow" } }]);
	assert.equal(push.subjectId, "actor-a");
	assert.deepEqual(parseRequest("give me a vertigo shot").stack, [{ id: "vertigo-effect" }]);
	assert.deepEqual(parseRequest("a fast 90 degree arc to the left around Joon", { cast }).stack, [{ id: "arc-shot", params: { speed: "fast", degrees: 90, direction: "left" } }]);
	assert.deepEqual(parseRequest("over the shoulder close-up").stack.map((row) => row.id), ["over-the-shoulder", "close-up"]);
	const epic = parseRequest("make the reveal feel epic");
	assert.equal(epic.stack[0].id, "crane-shot");
	assert.ok(epic.matched.every((row) => row.via === "mood"));
	const two = parseRequest("pan then tilt");
	assert.deepEqual(two.stack, [{ id: "pan-shot" }]);
	assert.equal(two.dropped[0].id, "tilt-shot");
	assert.deepEqual(parseRequest("handheld slow motion push in").stack.map((row) => row.id), ["handheld-shot", "slow-motion", "push-in"]);
});

check("the picker search ranks names over descriptions and filters by kind and mood", () => {
	assert.equal(searchTechniques("dolly")[0].id, "dolly-shot");
	assert.ok(searchTechniques("dolly").some((entry) => entry.id === "dolly-zoom"));
	assert.ok(searchTechniques("", { kind: "angle" }).every((entry) => entry.kind === "angle"));
	assert.ok(searchTechniques("", { mood: "uneasy" }).some((entry) => entry.id === "dutch-angle"));
	assert.equal(searchTechniques("hitchcock")[0].id, "vertigo-effect");
});

console.log(`\n${passed} checks passed`);
