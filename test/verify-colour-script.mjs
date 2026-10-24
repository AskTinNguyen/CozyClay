#!/usr/bin/env node
// colour-script A3 and A6: the colour script and the colour change at a cut.
// A3: one column per shot of a warm-to-cold sequence (master and coverage,
// test/bus/sequence-fixture.mjs) with its look in words, its intended palette
// and its measured palette, the story beats over it; the picture at 960 x 200;
// the director packet's colour check and packet/colour-script.png in the pack.
// A6: a constructed hard cut (warm to cold, bright to dark) and a soft one
// (two near greys) are told apart, measured and planned; the intensity curve
// gains its tone component once a shot has a look, and stays v1 without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coveredSequence, documentOf } from './bus/sequence-fixture.mjs';
import { colourCuts, colourScript, colourScriptWords, plannedTone } from '../src/colour-script/script.js';
import { colourScriptImage } from '../src/colour-script/image.js';
import { lookRecipe } from '../src/colour-script/recipes.js';
import { sequenceIntensity } from '../src/intensity-curve/curve.js';
import { INTENSITY_COMPONENT_IDS } from '../src/intensity-curve/weights.js';
import { directorPacket } from '../src/director-packet/packet.js';
import { packetFileNames, packetFiles } from '../src/director-packet/files.js';
import { editShotLook, paletteWithSwatch } from '../src/colour-script/edit.js';

const measured = (luminance, warmth, hex) => ({ swatches: [{ hex, share: 1 }], dominant: hex, meanLuminance: luminance, warmth, saturation: 0.4 });
const row = (index, extra) => ({ index, shotId: `s${index}`, startFrame: (index - 1) * 48, endFrame: index * 48 - 1, planned: { luminance: 0.5, warmth: 0 }, measured: null, ...extra });

test('A6 a hard and a soft colour cut, measured and planned', () => {
  const rows = [row(1, { measured: measured(0.62, 0.3, '#d0a070') }), row(2, { measured: measured(0.3, -0.25, '#40608a') }), row(3, { measured: measured(0.33, -0.22, '#46648c') }), row(4, { measured: measured(0.335, -0.22, '#47658c') })];
  const [hard, soft, matched] = colourCuts(rows);
  assert.deepEqual(hard, { cutFrame: 48, from: 's1', to: 's2', index: 2, luminance: -0.32, warmth: -0.55, kind: 'hard', source: 'measured' });
  assert.deepEqual([soft.kind, soft.luminance, soft.warmth], ['soft', 0.03, 0.03]);
  assert.equal(matched.kind, 'matched', 'a change under 0.05 in all reads as matched');
  const planned = colourCuts([row(1, { planned: plannedTone({ lighting: {}, keyLight: { warmth: 1 } }) }), row(2, { planned: plannedTone({ lighting: lookRecipe('cold-isolation').look, keyLight: { color: '#a9c4f0' } }) })]);
  assert.equal(planned[0].source, 'planned');
  assert.ok(planned[0].warmth < -0.25 && planned[0].kind === 'hard', JSON.stringify(planned[0]));
  assert.deepEqual(plannedTone({ lighting: null, keyLight: null }), { luminance: 0.511, warmth: 0 }, 'the studio rig plans a neutral mid tone');
  console.log(`PASS A6 hard ${hard.luminance}/${hard.warmth}, soft ${soft.luminance}/${soft.warmth}, matched; planned warm->cold ${planned[0].luminance}/${planned[0].warmth} ${planned[0].kind}`);
});

test('A3 a warm-to-cold sequence: columns, beats, the picture and the packet', () => {
  const { f } = coveredSequence();
  try {
    const shots = () => [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
    for (const [i, recipe] of [[0, 'warm-safety'], [1, 'warm-safety'], [2, 'cold-isolation'], [3, 'cold-isolation'], [4, 'night-menace']]) {
      const receipt = f.run('shot.setLook', { shotId: shots()[i].id, recipe }, 'agent');
      assert.equal(receipt.ok, true, JSON.stringify(receipt));
    }
    f.run('story.addBeat', { frame: shots()[2].startFrame + 4, label: 'the door shuts', kind: 'event' }, 'agent');
    const stage = { lighting: null, keyLight: null }, document = { ...documentOf(f), stage };
    const tones = { [shots()[0].id]: measured(0.6, 0.32, '#c89060'), [shots()[1].id]: measured(0.58, 0.3, '#c48c5e'), [shots()[2].id]: measured(0.34, -0.2, '#506a88') };
    const script = colourScript(document, { measured: tones });
    assert.equal(script.shots.length, 5);
    assert.match(script.shots[0].words, /^warm safety: interior preset/);
    assert.deepEqual(script.shots[2].intended, lookRecipe('cold-isolation').look.palette);
    assert.deepEqual(script.cuts.map((cut) => cut.source), ['measured', 'measured', 'planned', 'planned'], 'measured where both sides were rendered');
    assert.deepEqual([script.cuts[0].kind, script.cuts[1].kind], ['matched', 'hard'], 'warm to warm matches; warm to cold is the hard cut');
    assert.deepEqual(script.beats.map((beat) => beat.label), ['the door shuts']);
    assert.equal(JSON.stringify(colourScript(document, { measured: tones })), JSON.stringify(script), 'byte-identical');
    const image = colourScriptImage(script);
    assert.deepEqual([image.width, image.height, image.data.length], [960, 200, 960 * 200 * 4]);
    assert.equal(image.layout.columns.length, 5);
    assert.deepEqual(image.layout.cuts.find((cut) => cut.kind === 'hard')?.x, 384, 'the warm-to-cold rule sits between columns 2 and 3');
    const px = (x, y) => [...image.data.subarray((y * 960 + x) * 4, (y * 960 + x) * 4 + 3)];
    assert.deepEqual(px(90, 50), [0xc8, 0x90, 0x60], 'column 1 shows its measured swatch');
    assert.deepEqual(px(390 + 20, 140), [0x2c, 0x3e, 0x50], 'column 3 shows its intended palette below');
    // The director packet: the colour check (a hard cut flagged on the incoming shot) and colour-script.png in the folder.
    const packet = directorPacket(document);
    assert.ok(packet.checks.some((check) => check.id === 'colour'), packet.checks.map((check) => check.id).join(','));
    assert.ok(packet.shots[2].flags.some((flag) => flag.check === 'colour' && flag.rule === 'hard-colour-cut'), JSON.stringify(packet.shots[2].flags));
    assert.equal(packet.colour.shots.length, 5);
    const names = packetFileNames({ plan: true, contactSheet: true, colourScript: true });
    assert.ok(names.includes('packet/colour-script.png'), names.join(', '));
    const files = packetFiles(packet, { plan: new Uint8Array([1]), contactSheet: new Uint8Array([2]), colourScript: new Uint8Array([3]) });
    assert.deepEqual(files.at(-1), { name: 'packet/colour-script.png', data: new Uint8Array([3]) });
    assert.match(files[0].data, /<h2>Colour script<\/h2>\n<figure><img src="colour-script\.png"/);
    const plain = directorPacket({ ...document, shots: document.shots.map(({ look, ...rest }) => rest) });
    assert.ok(!plain.checks.some((check) => check.id === 'colour') && plain.colour === undefined, 'no look: no colour check, the packet as before');
    console.log(`PASS A3 ${colourScriptWords(script)} image ${image.width}x${image.height}; packet ${names.filter((name) => name.endsWith('.png')).join(', ')}`);
  } finally { f.dispose(); }
});

test('A6 the tone component in the intensity curve', () => {
  const { f, document } = coveredSequence();
  try {
    const before = sequenceIntensity(document);
    assert.deepEqual(before.components, [...INTENSITY_COMPONENT_IDS], 'no look: the seven camera components only');
    assert.ok(before.shots.every((row) => !('tone' in row.components)));
    const shots = [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
    f.run('shot.setLook', { shotId: shots[2].id, recipe: 'night-menace' }, 'agent');
    const toned = sequenceIntensity(documentOf(f));
    assert.deepEqual(toned.components, [...INTENSITY_COMPONENT_IDS, 'tone']);
    assert.equal(toned.weights.tone, 0.1);
    assert.ok(toned.shots[2].components.tone > toned.shots[1].components.tone, 'the night shot is lower key');
    assert.ok(toned.cuts[1].contrast.tone > 0.3 && toned.cuts[0].contrast.tone === 0, JSON.stringify(toned.cuts.map((cut) => cut.contrast.tone)));
    assert.ok(toned.cuts[1].total > before.cuts[1].total, 'the colour change adds to the cut\'s contrast');
    const measuredTones = sequenceIntensity(document, { tones: Object.fromEntries(shots.map((shot, i) => [shot.id, { luminance: i % 2 ? 0.2 : 0.8, warmth: 0 }])) });
    assert.deepEqual(measuredTones.shots.map((row) => row.components.tone), [0.14, 0.56, 0.14, 0.56, 0.14], 'measured tones turn it on too');
    console.log(`PASS A6 tone: ${toned.shots.map((row) => row.components.tone).join(' ')}; cut contrast ${toned.cuts.map((cut) => cut.contrast.tone).join(' ')}`);
  } finally { f.dispose(); }
});

test('A7 a swatch edited on a shot with no palette keeps the edit (dense, 3-5 swatches)', () => {
  const fourth = paletteWithSwatch(null, 3, '#123456');
  assert.deepEqual(fourth, { swatches: ['#808080', '#808080', '#808080', '#123456'], word: '' }, 'no holes: a sparse array would map to undefined entries');
  assert.deepEqual(paletteWithSwatch({ swatches: ['#111111', '#222222', '#333333'], word: 'ash' }, 4, '#555555').swatches, ['#111111', '#222222', '#333333', '#808080', '#555555']);
  assert.deepEqual(paletteWithSwatch(null, 0, '#abcdef').swatches, ['#abcdef', '#808080', '#808080']);
  assert.deepEqual(editShotLook(null, { palette: fourth }).palette.swatches, fourth.swatches, 'the look stores it');
});
