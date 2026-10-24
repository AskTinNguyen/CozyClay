// The camera capabilities in words: one phrase per capability for the export
// prompt (shot-prompt.js RIG line, MCP render_prompt), the receipt of
// camera.set / camera.applyTechnique, and the per-frame camera record that
// camera.json carries. Pure strings.
import { cameraCapabilities } from "./fields.js";
import { rollWords } from "./roll.js";

const named = (castName, id) => castName?.(id) ?? id;
const strength = (amplitude) => (amplitude >= 0.6 ? "strong" : amplitude >= 0.3 ? "moderate" : "subtle");

/** Words for a capability set (cameraCapabilities of a camera block); [] when it carries none. */
export function capabilityWords(value, { castName = null, fps = 24 } = {}) {
	const caps = cameraCapabilities(value), keys = caps.rigKeys ?? [], words = [];
	const rolls = keys.filter((key) => Number.isFinite(key.rollDeg)).map((key) => key.rollDeg);
	if (rolls.length > 1 && Math.max(...rolls) - Math.min(...rolls) >= 1) words.push(`the camera rolls from ${Math.round(rolls[0])} to ${Math.round(rolls.at(-1))} degrees, ${rollWords(rolls.at(-1)) || "back to a level horizon"}`);
	else if (rolls.length || caps.rollDeg) words.push(`a Dutch angle, ${rollWords(rolls[0] ?? caps.rollDeg)}`);
	const focusKeys = keys.filter((key) => key.focus).map((key) => (key.focus.targetId ? named(castName, key.focus.targetId) : `${key.focus.distance} m`));
	const depth = caps.lens?.fStop ? `${caps.lens.fStop <= 2.8 ? "shallow" : caps.lens.fStop >= 8 ? "deep" : "moderate"} depth of field at f/${caps.lens.fStop}` : null;
	const held = caps.lens?.focusTarget ? named(castName, caps.lens.focusTarget) : caps.lens?.focusDistance ? `${caps.lens.focusDistance} m` : null;
	if (focusKeys.length > 1 && new Set(focusKeys).size > 1) words.push(`${depth ? `${depth}, ` : ""}a rack focus from ${focusKeys[0]} to ${focusKeys.at(-1)}`);
	else if (depth || held || focusKeys.length) words.push([depth, held || focusKeys[0] ? `focus on ${held ?? focusKeys[0]}` : null].filter(Boolean).join(", "));
	if (caps.shake) words.push(caps.shake.style === "vehicle" ? `vehicle-mounted camera vibration, ${strength(caps.shake.amplitude)}` : `handheld camera with ${strength(caps.shake.amplitude)} natural shake`);
	if (caps.mount) {
		const who = named(castName, caps.mount.characterId);
		words.push(caps.mount.look === "face" ? `a Snorricam: the camera rigged to ${who}'s ${caps.mount.bone}, the face locked in frame while the world moves around them` : `the camera rigged to ${who}'s ${caps.mount.bone}, looking forward over them`);
	}
	if (caps.speed) words.push(caps.speed < 1 ? `slow motion at ${Math.round(caps.speed * 100)}% speed (shot at ${Math.round(fps / caps.speed)} fps)` : `sped up ${Number(caps.speed.toFixed(2))}x`);
	if (caps.shutterDeg) words.push(caps.shutterDeg >= 270 ? `heavy motion blur (${caps.shutterDeg}-degree shutter)` : caps.shutterDeg >= 150 ? `natural motion blur (${caps.shutterDeg}-degree shutter)` : `a crisp ${caps.shutterDeg}-degree shutter, little motion blur`);
	return words;
}

/**
 * What a sampled camera says at one frame, in the camera key shape plus its
 * capabilities: { pos, yaw, pitch, fovDeg, rollDeg?, fStop?, focusDistance?,
 * shutterDeg? } (camera.json framing.start / framing.end).
 */
export function framingRecord(sampled) {
	if (!sampled) return null;
	const optional = ["rollDeg", "fStop", "focusDistance", "shutterDeg"].filter((key) => Number.isFinite(sampled[key]) && sampled[key] !== 0);
	return { pos: { x: sampled.pos.x, y: sampled.pos.y, z: sampled.pos.z }, yaw: sampled.yaw, pitch: sampled.pitch, fovDeg: sampled.fovDeg, ...Object.fromEntries(optional.map((key) => [key, sampled[key]])) };
}
