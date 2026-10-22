/**
 * Optional sculpt part fields that any shape takes (its look, its surface
 * detail). Each entry is { key, read(raw, part, where) }: `read` runs only
 * when raw[key] is present, refuses a bad value with RecipeError
 * (sculpt-recipe-read.js) and writes the normalized value onto the part.
 * Pure: no three.js.
 */
import { SCULPT_OP_FIELD } from "./sculpt-cutters.js";

export const SCULPT_PART_FIELDS = Object.freeze([SCULPT_OP_FIELD]);
