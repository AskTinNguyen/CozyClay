/**
 * Readers shared by the sculpt recipe modules (sculpt-recipe.js, sculpt-shapes.js,
 * sculpt-part-fields.js). Each one refuses a bad value with the field's path
 * instead of clamping it. Pure: no three.js.
 */

export const tidy = (value) => {
	const rounded = Math.round(value * 1e4) / 1e4;
	return rounded === 0 ? 0 : rounded;
};
export const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export class RecipeError extends Error {
	constructor(path, message) {
		super(`${path}: ${message}`);
		this.path = path;
	}
}

export function readVector(value, path, fallback, check) {
	if (value === undefined && fallback) return [...fallback];
	if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
		throw new RecipeError(path, `must be three numbers [x, y, z], got ${JSON.stringify(value)}`);
	}
	value.forEach((component, axis) => check(component, `${path}[${axis}]`));
	return value.map(tidy);
}

export function readUnit(value, path, fallback, min, max) {
	if (value === undefined) return fallback;
	if (!isFiniteNumber(value) || value < min || value > max) {
		throw new RecipeError(path, `must be a number from ${min} to ${max}, got ${JSON.stringify(value)}`);
	}
	return tidy(value);
}
