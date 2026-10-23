// Natural phrases -> techniques. Exact names and aliases first, then a
// spelling-tolerant match, then moods ("uneasy", "epic reveal"). Pure: the
// UI picker, the agent command and the MCP tool all resolve the same way.
import { TECHNIQUES, techniqueById } from "./index.js";

/** Lowercase words only: "P.O.V." -> "pov", "God's-eye" -> "gods eye". */
export function normalizePhrase(text) {
	return String(text ?? "").toLowerCase().replace(/p\.o\.v\.?/g, "pov").replace(/['’]/g, "").replace(/°/g, " degrees ")
		.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Which one-per-stack slot a technique fills (index.js STACKING_RULE). */
export function slotOf(entry) {
	if (entry.recipe.move) return "move";
	if (entry.recipe.roll) return "roll"; // a tilted horizon stacks on any level: "low angle, Dutch"
	if (entry.kind === "size" || entry.kind === "angle" || entry.kind === "coverage") return entry.kind;
	return "modifier";
}

const KEYS = new Map();
for (const pass of ["name", "alias", "short"]) {
	for (const entry of TECHNIQUES) {
		const words = pass === "name" ? [entry.name, entry.id] : pass === "alias" ? entry.aliases : [entry.name, ...entry.aliases].map((key) => normalizePhrase(key).replace(/ (shot|view)$/, ""));
		for (const word of words) {
			const key = normalizePhrase(word);
			if (key && !KEYS.has(key)) KEYS.set(key, { id: entry.id, via: pass === "short" ? "name" : pass });
		}
	}
}

// Optimal string alignment distance: one swap of neighbours counts once.
function distance(a, b) {
	const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) rows[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
		}
	}
	return rows[a.length][b.length];
}
const tolerance = (length) => (length < 5 ? 0 : length <= 8 ? 1 : 2);
// Word by word, so a slip stays inside one word: "handheld slow" is not "handheld shot".
const wordsClose = (phrase, key) => {
	const a = phrase.split(" "), b = key.split(" ");
	return a.length === b.length && a.every((word, i) => distance(word, b[i]) <= (b[i].length < 4 ? 0 : b[i].length <= 8 ? 1 : 2));
};

function fuzzy(phrase) {
	// Numbers are never a spelling slip: "90 degree" is not "360 degree".
	if (phrase.length < 5 || /\d/.test(phrase)) return null;
	let best = null;
	for (const [key, hit] of KEYS) {
		if (Math.abs(key.length - phrase.length) > 2) continue;
		const d = distance(phrase, key);
		if (d <= tolerance(key.length) && wordsClose(phrase, key) && (!best || d < best.d)) best = { ...hit, via: "fuzzy", d };
	}
	return best && { id: best.id, via: best.via };
}

// Everyday words for the mood tags the catalog uses.
const MOOD_SYNONYMS = { unease: "uneasy", uncomfortable: "uneasy", creepy: "uneasy", unsettling: "uneasy", wrong: "uneasy", scary: "dread",
	frightening: "dread", terror: "panic", grand: "grand", huge: "epic", massive: "epic", heroic: "heroic", hero: "heroic", tender: "intimate",
	romance: "romantic", love: "romantic", tense: "tension", suspenseful: "suspense", sad: "lonely", alone: "isolation", lonely: "lonely",
	weak: "vulnerable", powerless: "vulnerable", strong: "powerful", power: "powerful", menace: "menacing", threatening: "menacing",
	dizzy: "dizzying", confused: "disoriented", drunk: "drunk", frantic: "frantic", chaos: "chaotic", calm: "calm", peaceful: "calm",
	revealing: "reveal", unveil: "reveal", realize: "realization", realisation: "realization", shocking: "shock", funny: "comedic", comedy: "comedic" };
const MOODS = new Set(TECHNIQUES.flatMap((entry) => entry.moods));
const moodWord = (word) => (MOODS.has(word) ? word : MOOD_SYNONYMS[word] ?? (MOODS.has(word.replace(/s$/, "")) ? word.replace(/s$/, "") : null));

/** Techniques ranked by how strongly their moods answer the words. */
export function searchByMood(text, { limit = 5 } = {}) {
	const moods = [...new Set(normalizePhrase(text).split(" ").map(moodWord).filter(Boolean))];
	const scored = TECHNIQUES.map((entry) => ({ entry, score: moods.reduce((sum, mood) => {
		const at = entry.moods.indexOf(mood);
		return at < 0 ? sum : sum + 1 + 1 / (1 + at);
	}, 0) })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
	return { moods, results: scored.slice(0, limit).map(({ entry, score }) => ({ id: entry.id, score: Math.round(score * 100) / 100 })) };
}

/** One phrase -> its best technique, or null. */
export function resolveTechnique(text) {
	const phrase = normalizePhrase(text);
	const hit = KEYS.get(phrase) ?? fuzzy(phrase);
	if (hit) return { id: hit.id, via: hit.via };
	const mood = searchByMood(phrase, { limit: 1 }).results[0];
	return mood ? { id: mood.id, via: "mood" } : null;
}

/** The picker's search box: name and alias prefixes rank above description words. */
export function searchTechniques(text, { kind = null, mood = null } = {}) {
	const phrase = normalizePhrase(text);
	const rows = TECHNIQUES.filter((entry) => (!kind || entry.kind === kind) && (!mood || entry.moods.includes(mood)));
	if (!phrase) return rows;
	const resolved = resolveTechnique(phrase), moods = new Set(searchByMood(phrase, { limit: 65 }).results.map((row) => row.id));
	const score = (entry) => {
		const names = [entry.name, ...entry.aliases].map(normalizePhrase);
		if (resolved?.id === entry.id && resolved.via !== "mood") return 100;
		if (names.some((name) => name.startsWith(phrase))) return 60;
		if (names.some((name) => name.includes(phrase))) return 40;
		if (moods.has(entry.id)) return 20;
		return normalizePhrase(entry.description).includes(phrase) ? 10 : 0;
	};
	return rows.map((entry) => ({ entry, s: score(entry) })).filter((row) => row.s > 0).sort((a, b) => b.s - a.s).map((row) => row.entry);
}

const SPEED_WORDS = { slow: "slow", slowly: "slow", gentle: "slow", gently: "slow", creeping: "slow", subtle: "slow", leisurely: "slow",
	medium: "medium", moderate: "medium", steady: "medium", fast: "fast", quick: "fast", quickly: "fast", rapid: "fast", snappy: "fast", sudden: "fast" };
const DIRECTIONS = new Set(["left", "right", "up", "down", "in", "out"]);

/**
 * A director's sentence -> a technique stack: "low-angle slow push-in on her"
 * becomes [low-angle, push-in { speed: slow }]. A sentence that names no
 * technique falls back to its moods ("make the reveal feel epic").
 * @param {string} text
 * @param {{cast?: Array<{id:string,name?:string}>}} [options]
 */
export function parseRequest(text, { cast = [] } = {}) {
	const words = normalizePhrase(text).split(" ").filter(Boolean), matched = [], dropped = [], used = new Set();
	for (let i = 0; i < words.length;) {
		let hit = null, span = 0;
		for (let n = Math.min(5, words.length - i); n >= 1 && !hit; n--) {
			const phrase = words.slice(i, i + n).join(" ");
			hit = KEYS.get(phrase) ?? (n <= 3 ? fuzzy(phrase) : null);
			span = n;
		}
		if (!hit) { i++; continue; }
		const entry = techniqueById(hit.id), slot = slotOf(entry), phrase = words.slice(i, i + span).join(" ");
		if (used.has(entry.id)) { i += span; continue; }
		if (slot !== "modifier" && matched.some((row) => slotOf(techniqueById(row.id)) === slot)) dropped.push({ id: entry.id, phrase, reason: `a stack holds one ${slot}` });
		else { matched.push({ id: entry.id, via: hit.via, phrase }); used.add(entry.id); }
		i += span;
	}
	const speedWord = words.map((word) => SPEED_WORDS[word]).find(Boolean);
	const degreeMatch = normalizePhrase(text).match(/(\d{2,3}) degrees?/);
	const direction = words.find((word, index) => DIRECTIONS.has(word) && !["in", "out"].includes(word) && words[index - 1] !== "look");
	let moods = [];
	if (!matched.length) {
		const found = searchByMood(text, { limit: 65 });
		moods = found.moods;
		const top = found.results[0] && techniqueById(found.results[0].id);
		if (top) matched.push({ id: top.id, via: "mood", phrase: moods.join(" ") });
		const second = top && found.results.map((row) => ({ ...row, entry: techniqueById(row.id) }))
			.find((row) => row.score >= 2 && slotOf(row.entry) === "angle" && slotOf(top) !== "angle");
		if (second) matched.push({ id: second.id, via: "mood", phrase: moods.join(" ") });
	}
	const stack = matched.map(({ id }) => {
		const params = techniqueById(id).params, own = {};
		if (speedWord && params.speed) own.speed = speedWord;
		if (degreeMatch && params.degrees) own.degrees = Number(degreeMatch[1]);
		if (direction && params.direction?.options.includes(direction)) own.direction = direction;
		return Object.keys(own).length ? { id, params: own } : { id };
	});
	const named = cast.find((member) => member.name && words.join(" ").includes(normalizePhrase(member.name)));
	return { stack, matched, dropped, moods, ...(named ? { subjectId: named.id } : {}) };
}
