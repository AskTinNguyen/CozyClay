#!/usr/bin/env node
// Sculpt comparison (#730): the reference becomes a mask, the recipe a fitted
// silhouette, and the score measures shape rather than framing. Synthetic
// references keep every expected number derivable by hand.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSculptRecipe } from "../src/sculpt-recipe.js";
import { bestViewForReference, compareSculptToReference, referenceMask, sculptViewPolygons } from "../src/sculpt-compare.js";

let failures = 0;
async function check(name, fn) {
	try {
		await fn();
		console.log(`PASS ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL ${name} - ${error.stack?.split("\n").slice(0, 3).join(" | ") ?? error.message}`);
	}
}
const recipe = (parts) => {
	const result = normalizeSculptRecipe({ parts });
	assert.equal(result.ok, true, result.error);
	return result.recipe;
};
/** A flat-backdrop image with a filled rectangle (fx, fy as fractions). */
function rectImage({ width = 200, height = 200, x0, x1, y0, y1, bg = [154, 220, 254], fg = [60, 120, 140], alpha = false } = {}) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const inside = x >= x0 * width && x < x1 * width && y >= y0 * height && y < y1 * height;
		const c = inside ? fg : bg, i = (y * width + x) * 4;
		data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = alpha && !inside ? 0 : 255;
	}
	return { width, height, data };
}
const box = (w, h, d) => recipe([{ id: "b", shape: "box", size: [w, h, d], roundness: 0, position: [0, h / 2, 0] }]);

await check("a flat backdrop and a transparent background both give the subject's mask", () => {
	const flat = referenceMask(rectImage({ x0: 0.3, x1: 0.7, y0: 0.2, y1: 0.9 }));
	assert.equal(flat.source, "border-colour");
	const cut = referenceMask(rectImage({ x0: 0.3, x1: 0.7, y0: 0.2, y1: 0.9, alpha: true }));
	assert.equal(cut.source, "alpha");
	const area = (m) => m.mask.reduce((s, v) => s + v, 0) / m.mask.length;
	assert.ok(Math.abs(area(flat) - 0.28) < 0.01 && Math.abs(area(cut) - 0.28) < 0.01, `${area(flat)} ${area(cut)}`);
});

await check("a reference with no subject is refused with the reason", () => {
	assert.throws(() => referenceMask(rectImage({ x0: 0, x1: 0, y0: 0, y1: 0 })), /No subject found/);
});

await check("a box sculpt of the reference's proportions scores ~1 wherever it is framed", () => {
	for (const frame of [{ x0: 0.3, x1: 0.7, y0: 0.1, y1: 0.9 }, { x0: 0.05, x1: 0.25, y0: 0.5, y1: 0.9 }]) {
		const aspect = (frame.x1 - frame.x0) / (frame.y1 - frame.y0);
		const { report } = compareSculptToReference(box(aspect, 1, 0.2), rectImage(frame));
		assert.ok(report.iou > 0.95, JSON.stringify(report));
		assert.ok(Math.abs(report.widthToHeight.delta) < 0.03);
	}
});

await check("a sculpt too wide reports extra on the part that sticks out, and a too-narrow one reports missing", () => {
	const ref = rectImage({ x0: 0.35, x1: 0.65, y0: 0.1, y1: 0.9 });
	const wide = compareSculptToReference(recipe([
		{ id: "body", shape: "box", size: [0.375, 1, 0.2], roundness: 0, position: [0, 0.5, 0] },
		{ id: "arm", shape: "box", size: [0.3, 0.2, 0.2], roundness: 0, position: [0.3, 0.6, 0] },
	]), ref).report;
	assert.equal(wide.extraByPart[0].id, "arm");
	assert.ok(wide.widthToHeight.delta > 0.2);
	const narrow = compareSculptToReference(box(0.2, 1, 0.2), ref).report;
	assert.ok(narrow.missingFraction > 0.4 && narrow.extraFraction < 0.02, JSON.stringify(narrow));
});

await check("missing pixels are reported by height band, so the agent knows where to add", () => {
	const ref = rectImage({ x0: 0.3, x1: 0.7, y0: 0.1, y1: 0.9 });
	const pear = recipe([
		{ id: "base", shape: "box", size: [0.5, 0.33, 0.2], roundness: 0, position: [0, 0.165, 0] },
		{ id: "top", shape: "box", size: [0.25, 0.67, 0.2], roundness: 0, position: [0, 0.665, 0] },
	]);
	const { missingByBand } = compareSculptToReference(pear, ref).report;
	// The narrow part spans the top two thirds; the wide base fills the bottom third.
	assert.ok(missingByBand.top > 0.05 && missingByBand.middle > 0.05 && missingByBand.bottom < 0.01, JSON.stringify(missingByBand));
});

await check("yaw moves the camera round to the subject's own left (+x)", () => {
	const r = recipe([{ id: "nose", shape: "box", size: [0.1, 0.1, 0.1], roundness: 0, position: [0, 0.5, 1] }]);
	const [front] = sculptViewPolygons(r, { yaw: 0 });
	const [left] = sculptViewPolygons(r, { yaw: 90 });
	const cx = (p) => p.polygon.reduce((s, [x]) => s + x, 0) / p.polygon.length;
	assert.ok(Math.abs(cx(front)) < 1e-6);
	assert.ok(cx(left) < -0.9, `from the subject's left the nose points to screen left (${cx(left)})`);
});

await check("a frame keeps its opening in the silhouette", () => {
	const ref = rectImage({ x0: 0.2, x1: 0.8, y0: 0.3, y1: 0.7 });
	const solid = compareSculptToReference(recipe([{ id: "f", shape: "box", size: [0.6, 0.4, 0.05], roundness: 0, position: [0, 0.2, 0] }]), ref).report;
	const ring = compareSculptToReference(recipe([{ id: "f", shape: "frame", size: [0.6, 0.4, 0.05], border: 0.05, position: [0, 0.2, 0] }]), ref).report;
	assert.ok(ring.missingFraction > solid.missingFraction + 0.3, `${ring.missingFraction} vs ${solid.missingFraction}`);
});

await check("the turtle against its own reference: best view is the 3/4 left, IoU above 0.8", () => {
	const turtle = normalizeSculptRecipe(JSON.parse(readFileSync(new URL("./fixtures/sculpt-nerd-turtle.json", import.meta.url), "utf8"))).recipe;
	const ref = JSON.parse(readFileSync(new URL("./fixtures/sculpt-turtle-mask.json", import.meta.url), "utf8"));
	const data = new Uint8Array(ref.width * ref.height * 4).fill(255);
	for (const [start, length] of ref.runs) for (let i = start; i < start + length; i += 1) data.set([60, 120, 140, 255], i * 4);
	const best = bestViewForReference(turtle, { width: ref.width, height: ref.height, data });
	assert.equal(best.report.view.yaw, 30);
	assert.ok(best.report.iou > 0.8, JSON.stringify(best.report));
	assert.equal(best.sheet.width, best.sheet.height * 2);
});

if (failures) {
	console.log(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nverify-sculpt-compare: all checks passed");
