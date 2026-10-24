#!/usr/bin/env node
// colour-script A1: a shot look (stage-shot-look.js) is a partial stage look
// merged over the stage while the shot plays. The merge, the look sampled at
// timeline frames, the dissolve blend across a cut, shot.setLook through the
// command bus (recipe, partial, nudge, same-as, clear, request words, undo),
// and an older document: no look anywhere, so every frame plays the stage's
// own values (the same objects) and the shot document reads back byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendLooks, keyHex, mergeShotLook, repairShotLook, shotLookAt, shotLookWords } from '../src/stage-shot-look.js';
import { applyLightingRecipe, createKeyLight, normalizeLighting, stageLook } from '../src/stage-lighting.js';
import { createShot } from '../src/cuts.js';
import { createShotAuthoringDocument, loadShotAuthoring, serializeShotAuthoring } from '../src/shot-authoring.js';
import { lookRecipe } from '../src/colour-script/recipes.js';
import { shotsFixture, framing } from './bus/shots-fixture.mjs';

const stage = { lighting: { preset: 'studio' }, keyLight: { x: 6, y: 9, z: 4, intensity: 1.12, warmth: 0.5 } };
const shot = (id, start, end, extra = {}) => ({ ...createShot(id, start, end, [{ id: `key-${id}`, frame: start, framing }]), id, ...extra });

test('A1 merge: a partial look over the stage, its preset first, then each field', () => {
  assert.equal(repairShotLook({}), null, 'an empty look is no look');
  assert.deepEqual(repairShotLook({ exposure: 9, warmth: -1, sky: '#ABCDEF', preset: 'nope', palette: { swatches: ['#000000', '#ffffff'] } }), { warmth: 0, exposure: 3, sky: '#abcdef' }, 'clamped to the stage limits; a two-swatch palette and an unknown preset dropped');
  const night = mergeShotLook(stage, { preset: 'night', exposure: 0.8 }), recipe = applyLightingRecipe(stage, 'night', ['lighting.hdr']);
  assert.deepEqual(night.keyLight, recipe.keyLight, 'the preset recipe sets the key');
  assert.deepEqual(night.lighting, { ...recipe.lighting, exposure: 0.8 }, 'then the look\'s own fields');
  const warm = mergeShotLook({ ...stage, keyLight: { ...stage.keyLight, color: '#9db6e6' } }, { warmth: 0.9 });
  assert.equal(warm.keyLight.color, null, 'a warmth clears the key colour');
  assert.equal(keyHex(warm.keyLight), '#ffce95');
  assert.equal(mergeShotLook(stage, null).lighting, stage.lighting, 'no look: the stage values as they are');
  assert.equal(mergeShotLook(stage, { palette: { swatches: ['#000000', '#222222', '#444444'], word: 'grey' } }).lighting, stage.lighting, 'an intended palette alone renders nothing');
  assert.equal(shotLookWords(lookRecipe('night-menace').look, { label: 'night menace' }), "night menace: night preset, exposure 0.85, haze 0.55; intended palette 'moonlit threat' #020408, #0b1426, #34507f, #9db6e6");
  console.log(`PASS A1 merge: ${shotLookWords({ preset: 'night', exposure: 0.8 })}`);
});

test('A1 sampling: the look follows the shot under each frame; a dissolve blends the two looks', () => {
  const cold = lookRecipe('cold-isolation').look, shots = [shot('warm', 0, 47, { look: { warmth: 1, exposure: 1.2 } }), shot('cold', 48, 95, { look: cold, transition: { type: 'dissolve', frames: 12 } }), shot('plain', 96, 143)];
  const at = (frame) => shotLookAt(stage, shots, frame);
  assert.deepEqual([at(10).key, at(70).key, at(120).key], ['warm', 'cold', ''], 'each shot\'s own look; a shot with none plays the stage');
  assert.equal(at(120).lighting, stage.lighting, 'the plain shot gets the stage object itself');
  assert.deepEqual(at(10), { ...mergeShotLook(stage, shots[0].look), key: 'warm' });
  // The dissolve runs frames 42-53: 6 before the cut, 6 after (transitions.js).
  const before = at(41), first = at(42), mid = at(47), after = at(48), out = at(54);
  assert.equal(before.key, 'warm');
  assert.match(first.key, /^warm~cold@0\.042$/);
  assert.equal(after.key, 'cold~warm@0.458');
  assert.equal(out.key, 'cold');
  const exposures = [41, 42, 45, 47, 48, 50, 53, 54].map((frame) => Number(at(frame).lighting.exposure.toFixed(3)));
  assert.ok(exposures.every((value, i) => i === 0 || value <= exposures[i - 1] + 1e-9), `exposure falls through the dissolve: ${exposures.join(' ')}`);
  assert.equal(exposures[0], 1.2);
  assert.equal(exposures.at(-1), cold.exposure);
  assert.deepEqual(mid, { ...blendLooks(mergeShotLook(stage, shots[0].look), mergeShotLook(stage, cold), 0.458), key: 'warm~cold@0.458' }, 'mid-dissolve: the blend at the picture\'s weight');
  assert.equal(stageLook({ ...at(70) }).exposure, cold.exposure, 'the renderer reads the merged look');
  const keys = [41, 44, 47, 48, 51, 54].map((frame) => keyHex(at(frame).keyLight));
  console.log(`PASS A1 sampling: keys f41-54 ${keys.join(' ')}; exposure ${exposures.join(' ')}`);
});

test('A1 older documents: no look anywhere, nothing changes', () => {
  const shots = [shot('a', 0, 47), shot('b', 48, 95, { transition: { type: 'dissolve', frames: 12 } })];
  for (const frame of [0, 44, 48, 90]) {
    const at = shotLookAt(stage, shots, frame);
    assert.ok(at.lighting === stage.lighting && at.keyLight === stage.keyLight && at.key === '', `frame ${frame}`);
  }
  const text = serializeShotAuthoring({ shots, frameCount: 120 });
  assert.ok(!text.includes('"look"'), 'no look field is written');
  assert.equal(serializeShotAuthoring(loadShotAuthoring(text)), text, 'reads back byte-identical');
  const looked = createShotAuthoringDocument({ shots: [{ ...shots[0], look: { preset: 'dusk', bogus: 1 } }, shots[1]], frameCount: 120 });
  assert.deepEqual(looked.shots[0].look, { preset: 'dusk' }, 'a stored look is repaired on read');
  assert.deepEqual(normalizeLighting(shotLookAt(stage, looked.shots, 10).lighting).preset, 'dusk');
  assert.deepEqual(createKeyLight(shotLookAt(stage, looked.shots, 60).keyLight), createKeyLight(stage.keyLight));
  console.log('PASS A1 older documents unchanged: same objects at every frame, byte-identical round trip');
});

test('A1 shot.setLook through the bus: recipe, partial, nudge, same-as, request, clear, one undo entry', () => {
  const f = shotsFixture();
  try {
    f.shots.load({ shots: [shot('shot-a', 0, 47, { name: 'Kitchen' }), shot('shot-b', 48, 95, { name: 'Confession' })], frameCount: 120, camera: f.actual.readStudioState().camera });
    const look = (id) => f.live.current.shots.find((row) => row.id === id).look;
    let receipt = f.run('shot.setLook', { shotId: 'shot-a', recipe: 'warm-safety' }, 'agent');
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.deepEqual(look('shot-a'), repairShotLook(lookRecipe('warm-safety').look));
    receipt = f.run('shot.setLook', { shotId: 'shot-a', look: { exposure: 1.3, fill: null } }, 'agent');
    assert.equal(look('shot-a').exposure, 1.3);
    assert.equal(look('shot-a').fill, undefined, 'null clears a field');
    receipt = f.run('shot.setLook', { request: 'the same look as shot 1', shot: 2 }, 'agent');
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.deepEqual(look('shot-b'), look('shot-a'));
    assert.match(receipt.summary, /^Look on Confession/);
    receipt = f.run('shot.setLook', { request: 'make the confession shot colder' }, 'agent');
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.deepEqual(receipt.affectedIds, ['shot-b'], 'the shot named by its name word');
    const before = mergeShotLook({}, look('shot-a')), after = mergeShotLook({}, look('shot-b'));
    const blue = (hex) => parseInt(hex.slice(5, 7), 16) - parseInt(hex.slice(1, 3), 16);
    assert.ok(blue(keyHex(after.keyLight)) > blue(keyHex(before.keyLight)), `colder: ${keyHex(before.keyLight)} -> ${keyHex(after.keyLight)}`);
    receipt = f.run('shot.setLook', { request: 'a sandwich please' }, 'agent');
    assert.equal(receipt.ok, false);
    assert.equal(receipt.code, 'INVALID_ARGUMENT');
    receipt = f.run('shot.setLook', { shotId: 'shot-b', clear: true }, 'agent');
    assert.equal(look('shot-b'), undefined, 'clear removes the look');
    assert.equal(receipt.undo?.canUndoDirect, true, 'one undo entry in the shot domain');
    console.log(`PASS A1 bus: ${receipt.summary}`);
  } finally { f.dispose(); }
});
