// A shot's look (colour-script D1): a partial stage.lighting a shot carries,
// merged over the stage look while the shot plays, absent by default. The
// fields are the ones a director changes from shot to shot: a whole recipe
// (preset), the key's warmth or colour and brightness, exposure, fill, haze
// and the sky. A look may also carry the palette the shot is meant to read as
// (three to five swatches and a word), which nothing renders: it is the plan
// the measured palette is read against. A dissolve blends the two looks.
// Pure data and arithmetic, like stage-lighting.js: no three.js or React.
import { applyLightingRecipe, createKeyLight, LIGHTING_PRESETS, normalizeLighting } from "./stage-lighting.js";
import { elementByPath } from "./studio-elements.js";
import { shotAtFrame } from "./cuts.js";
import { transitionAt } from "./camera-coverage/transitions.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const RECIPE_ID = /^[a-z0-9-]{1,40}$/;
const plain = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hex = (value) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : null);
const range = (path) => elementByPath(path);
const clamp = (value, { min, max }) => Math.max(min, Math.min(max, value));
const r3 = (value) => Math.round(value * 1000) / 1000;

/** The numeric fields a look may set, each with the stage element whose limits clamp it. */
const NUMBERS = Object.freeze({ warmth: "stage.keyLight.warmth", keyIntensity: "stage.keyLight.intensity", exposure: "stage.lighting.exposure", fill: "stage.lighting.fill", fog: "stage.lighting.fog" });
const COLOURS = Object.freeze(["keyColor", "sky", "skyTop"]);
/** Every field a shot look may hold, in the order the receipts and the words list them. */
export const SHOT_LOOK_FIELDS = Object.freeze(["recipe", "preset", ...Object.keys(NUMBERS), ...COLOURS, "palette"]);

/** An intended palette: { swatches: 3-5 #rrggbb, word } or null. */
function repairPalette(value) {
	if (!plain(value) || !Array.isArray(value.swatches)) return null;
	const swatches = value.swatches.map(hex).filter(Boolean).slice(0, 5);
	const word = typeof value.word === "string" ? Array.from(value.word.trim()).slice(0, 40).join("") : "";
	return swatches.length >= 3 ? { swatches, word } : null;
}

/** A stored shot look with every field repaired; null when nothing in it is usable (then the shot has no look). */
export function repairShotLook(value) {
	if (!plain(value)) return null;
	const look = {};
	if (typeof value.recipe === "string" && RECIPE_ID.test(value.recipe)) look.recipe = value.recipe;
	if (LIGHTING_PRESETS.includes(value.preset)) look.preset = value.preset;
	for (const [key, path] of Object.entries(NUMBERS)) if (typeof value[key] === "number" && Number.isFinite(value[key])) look[key] = r3(clamp(value[key], range(path)));
	for (const key of COLOURS) if (hex(value[key])) look[key] = hex(value[key]);
	const palette = repairPalette(value.palette);
	if (palette) look.palette = palette;
	return Object.keys(look).length ? look : null;
}

/** Whether a look changes the picture (a palette or a recipe name alone does not). */
export const looksLit = (look) => !!look && SHOT_LOOK_FIELDS.some((key) => key !== "palette" && key !== "recipe" && look[key] !== undefined);

/**
 * The stage look while a shot with `look` plays: the stage's { lighting, keyLight },
 * through the look's preset recipe first (keeping the stage's HDR environment),
 * then each field it sets. A warmth clears the key colour (the colour wins over
 * warmth otherwise). Without a look the stage's own values come back as they are.
 */
export function mergeShotLook(stage, look) {
	const lighting = stage?.lighting ?? null, keyLight = stage?.keyLight ?? null;
	if (!looksLit(look)) return { lighting, keyLight };
	let base = { lighting: normalizeLighting(lighting), keyLight: createKeyLight(keyLight) };
	if (look.preset) base = applyLightingRecipe(base, look.preset, ["lighting.hdr"]);
	const key = { ...base.keyLight }, lit = { ...base.lighting };
	if (look.warmth !== undefined) Object.assign(key, { warmth: look.warmth, color: null });
	if (look.keyColor) key.color = look.keyColor;
	if (look.keyIntensity !== undefined) key.intensity = look.keyIntensity;
	for (const field of ["exposure", "fill", "fog", "sky", "skyTop"]) if (look[field] !== undefined) lit[field] = look[field];
	return { lighting: normalizeLighting(lit), keyLight: createKeyLight(key) };
}

const rgb = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const toHex = (channels) => `#${channels.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
/** Two #rrggbb mixed in sRGB: t 0 is a, 1 is b. */
export const mixHex = (a, b, t) => toHex(rgb(a).map((c, i) => c + (rgb(b)[i] - c) * t));

/** The key's colour as a #rrggbb: its own colour, else the warmth slider's (room.jsx keyLightColor, mixed in sRGB). */
export function keyHex(keyLight) {
	const key = createKeyLight(keyLight);
	if (key.color) return key.color.toLowerCase();
	return key.warmth < 0.5 ? mixHex("#ffffff", "#e8f0ff", (0.5 - key.warmth) * 2) : mixHex("#ffffff", "#ffc27a", (key.warmth - 0.5) * 2);
}

/** Two merged looks blended: numbers and colours mix, a preset or an absent sky steps at the half. t 0 is a, 1 is b. */
export function blendLooks(a, b, t) {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const la = normalizeLighting(a.lighting), lb = normalizeLighting(b.lighting), ka = createKeyLight(a.keyLight), kb = createKeyLight(b.keyLight);
	const lerp = (x, y) => x + (y - x) * t, step = (x, y) => (t < 0.5 ? x : y);
	const lighting = Object.fromEntries(Object.keys(la).map((field) => {
		const x = la[field], y = lb[field];
		if (typeof x === "number" && typeof y === "number") return [field, lerp(x, y)];
		if (hex(x) && hex(y)) return [field, mixHex(x, y, t)];
		return [field, step(x, y)];
	}));
	const keyLight = { ...Object.fromEntries(["x", "y", "z", "intensity", "warmth"].map((axis) => [axis, lerp(ka[axis], kb[axis])])),
		color: ka.color || kb.color ? mixHex(keyHex(ka), keyHex(kb), t) : null };
	return { lighting: normalizeLighting(lighting), keyLight: createKeyLight(keyLight) };
}

/** What plays at a frame: { shot, other, weight } (other and weight only inside a dissolve or whip), or null with no look in play. */
function lookWindow(shots, frame) {
	const list = Array.isArray(shots) ? shots : [];
	if (!list.some((shot) => looksLit(shot?.look))) return null;
	const shot = shotAtFrame(list, Math.round(frame)), window = transitionAt(list, Math.round(frame));
	const other = window?.other && window.otherWeight > 0 ? window.other.shot : null;
	if (!looksLit(shot?.look) && !looksLit(other?.look)) return null;
	return { shot, other, weight: other ? r3(window.otherWeight) : 0 };
}

/** A cheap name for the look at a frame ("" with none): it changes exactly when shotLookAt's answer does, for one shot list. */
export function shotLookKey(shots, frame) {
	const at = lookWindow(shots, frame);
	return !at ? "" : at.other ? `${at.shot?.id ?? ""}~${at.other.id}@${at.weight}` : at.shot.id;
}

/**
 * The stage look at a timeline frame: the look of the shot under it, and inside a
 * dissolve or whip the two shots' looks blended by the picture's weights
 * (camera-coverage/transitions.js). `key` is shotLookKey's; with no look in play
 * it is "" and the stage's own { lighting, keyLight } come back unchanged (a
 * stage saved earlier renders as before).
 */
export function shotLookAt(stage, shots, frame) {
	const at = lookWindow(shots, frame), key = shotLookKey(shots, frame);
	if (!at) return { lighting: stage?.lighting ?? null, keyLight: stage?.keyLight ?? null, key };
	const own = mergeShotLook(stage, at.shot?.look);
	return at.other ? { ...blendLooks(own, mergeShotLook(stage, at.other.look), at.weight), key } : { ...own, key };
}

const n2 = (value) => Number(value.toFixed(2));
/** A shot look in words for the brief and the receipts ("night preset, key #9db6e6, exposure 0.85; palette 'moonlit threat' #020408, ..."), or "". */
export function shotLookWords(look, { label = null } = {}) {
	if (!look) return "";
	const parts = [
		look.preset ? `${look.preset} preset` : null,
		look.warmth !== undefined ? `${look.warmth < 0.45 ? "cool" : look.warmth > 0.55 ? "warm" : "neutral"} key (warmth ${n2(look.warmth)})` : null,
		look.keyColor ? `key ${look.keyColor}` : null, look.keyIntensity !== undefined ? `key brightness ${n2(look.keyIntensity)}` : null,
		look.exposure !== undefined ? `exposure ${n2(look.exposure)}` : null, look.fill !== undefined ? `fill ${n2(look.fill)}` : null,
		look.fog !== undefined ? `haze ${n2(look.fog)}` : null, look.sky ? `sky ${look.sky}${look.skyTop ? ` to ${look.skyTop}` : ""}` : null,
	].filter(Boolean);
	const name = label ?? look.recipe?.replaceAll("-", " ") ?? null;
	const lit = `${name ?? ""}${name && parts.length ? ": " : ""}${parts.join(", ")}`;
	const palette = look.palette ? `intended palette${look.palette.word ? ` '${look.palette.word}'` : ""} ${look.palette.swatches.join(", ")}` : "";
	return [lit, palette].filter(Boolean).join("; ");
}

// The shots an export draw lights from while a command renders (shot.colourScript):
// the document's, which lead the scene's props by a render of the 3D tree.
let drawShots = null;
/** Run fn with the export draw lit from these shots' looks (applyShotLookForDraw). */
export function withDrawShots(shots, fn) {
	const prior = drawShots;
	drawShots = shots;
	try { return fn(); } finally { drawShots = prior; }
}
/** The shots withDrawShots set, or null. */
export const currentDrawShots = () => drawShots;
