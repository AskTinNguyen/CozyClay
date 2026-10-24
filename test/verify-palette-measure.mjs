#!/usr/bin/env node
// colour-script A2: measurePalette(rgba, w, h) on constructed buffers. Two
// colours in known shares come back as two swatches with those shares; the
// mean luminance, warmth and saturation follow their formulas; a grey frame is
// neutral; near shades merge into one swatch; the same pixels give the same
// bytes, whatever their row order (a WebGL read-back runs bottom-up).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measurePalette } from '../src/colour-script/palette.js';

/** A w x h buffer whose rows are painted by paint(y) -> [r, g, b]. */
function buffer(width, height, paint) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); data.set([r, g, b, 255], (y * width + x) * 4); }
  return data;
}
const flipRows = (data, width, height) => { const out = new Uint8Array(data.length), stride = width * 4; for (let y = 0; y < height; y++) out.set(data.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride); return out; };

test('A2 two colours: swatches, shares, luminance, warmth, saturation', () => {
  // Top quarter amber, the rest deep blue.
  const w = 80, h = 40, data = buffer(w, h, (x, y) => (y < 10 ? [240, 160, 64] : [32, 48, 128]));
  const p = measurePalette(data, w, h);
  assert.deepEqual(p.swatches, [{ hex: '#203080', share: 0.75 }, { hex: '#f0a040', share: 0.25 }]);
  assert.equal(p.dominant, '#203080');
  const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  assert.equal(p.meanLuminance, Math.round((0.25 * luma(240, 160, 64) + 0.75 * luma(32, 48, 128)) * 1000) / 1000);
  assert.equal(p.warmth, Math.round((0.25 * (240 - 64) + 0.75 * (32 - 128)) / 255 * 1000) / 1000);
  assert.equal(p.saturation, Math.round((0.25 * (176 / 240) + 0.75 * (96 / 128)) * 1000) / 1000);
  assert.equal(p.samples, w * h);
  console.log(`PASS A2 two colours: ${p.swatches.map((s) => `${s.hex} ${s.share}`).join(', ')}; lum ${p.meanLuminance}, warmth ${p.warmth}, sat ${p.saturation}`);
});

test('A2 grey is neutral; near shades merge; warm and cold read by sign', () => {
  const grey = measurePalette(buffer(32, 32, () => [128, 128, 128]), 32, 32);
  assert.deepEqual([grey.swatches.length, grey.warmth, grey.saturation, grey.dominant], [1, 0, 0, '#808080']);
  const shades = measurePalette(buffer(32, 32, (x) => [200 + (x % 4) * 4, 120, 60]), 32, 32);
  assert.equal(shades.swatches.length, 1, 'shades within a few levels are one swatch');
  const warm = measurePalette(buffer(16, 16, () => [255, 170, 90]), 16, 16), cold = measurePalette(buffer(16, 16, () => [90, 140, 255]), 16, 16);
  assert.ok(warm.warmth > 0.6 && cold.warmth < -0.6, `${warm.warmth} ${cold.warmth}`);
  const five = measurePalette(buffer(100, 10, (x) => [[250, 20, 20], [20, 250, 20], [20, 20, 250], [250, 250, 20], [20, 250, 250], [250, 20, 250]][Math.floor(x / 17) % 6]), 100, 10);
  assert.equal(five.swatches.length, 5, 'at most five swatches');
  assert.equal(five.swatches.reduce((sum, s) => sum + s.share, 0).toFixed(2), '1.00', 'shares cover every sample');
  console.log(`PASS A2 grey ${grey.dominant} warmth ${grey.warmth}; warm ${warm.warmth}, cold ${cold.warmth}; six colours -> ${five.swatches.length} swatches`);
});

test('A2 deterministic: the same buffer gives the same palette, rows in either order; large frames are sampled', () => {
  const w = 1920, h = 1080, data = buffer(w, h, (x, y) => [(x * 7) % 256, (y * 3) % 256, ((x + y) * 5) % 256]);
  const a = JSON.stringify(measurePalette(data, w, h)), b = JSON.stringify(measurePalette(data, w, h)), c = JSON.stringify(measurePalette(flipRows(data, w, h), w, h));
  assert.equal(a, b);
  assert.ok(JSON.parse(a).samples <= 60000, 'a 1080p frame is sampled on a grid');
  const small = buffer(64, 32, (x, y) => (y < 8 ? [250, 200, 10] : [10, 40, 90]));
  assert.equal(JSON.stringify(measurePalette(flipRows(small, 64, 32), 64, 32)), JSON.stringify(measurePalette(small, 64, 32)), 'row order does not matter');
  assert.equal(measurePalette(new Uint8Array(0), 0, 0).swatches.length, 0, 'an empty buffer has no palette');
  console.log(`PASS A2 deterministic; 1080p sampled at ${JSON.parse(a).samples} pixels; flipped rows ${a === c ? 'identical' : 'grid-shifted'}`);
});
