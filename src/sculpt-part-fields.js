/**
 * Optional sculpt part fields that any shape takes (its look, its surface
 * detail). Each entry is { key, read(raw, part, where) }: `read` runs only
 * when raw[key] is present, refuses a bad value with RecipeError
 * (sculpt-recipe-read.js) and writes the normalized value onto the part.
 * An edit that sets a field to null clears it. Pure: no three.js.
 */
import { SCULPT_OP_FIELD } from "./sculpt-cutters.js";

import { SURFACE_FIELDS } from "./sculpt-surface-fields.js";

export const SCULPT_PART_FIELDS = Object.freeze([...SURFACE_FIELDS, SCULPT_OP_FIELD]);
