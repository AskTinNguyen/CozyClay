// A6: the seven techniques that used to be prompt words only now set a real
// camera capability through camera.applyTechnique (one undo entry), and the
// receipt reads back what they achieved: roll degrees, focus subjects and
// distances, shake amplitude, mount bone, speed and shutter. camera.set and
// camera.setKey reach the same fields directly, and a re-applied stack clears
// the capabilities its previous stack set.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { cameraCapabilities } from '../../src/camera-capabilities/fields.js';
import { PLANNED_CAPABILITIES } from '../../src/camera-techniques/entry.js';
import { describeTechnique } from '../../src/camera-techniques/index.js';
import { shotCaptureMeta } from '../../src/shot-meta.js';
import { buildShotPrompt } from '../../src/shot-prompt.js';

// Looking down +x from beside actor-a, so actor-b (4 m further along x) sits on another focal plane.
const sideways = { pos: { x: -4, y: 1.6, z: 0.3 }, yaw: -Math.PI / 2, pitch: -0.02, fovDeg: 40 };
const seed = () => ({ ...createShot('Hero', 0, 95, [{ id: 'key-a', frame: 0, framing: sideways }]), id: 'shot-a' });
const shotOf = f => f.live.current.shots.find(row => row.id === 'shot-a');
function apply(f, stack, extra = {}) {
  f.shots.load({ shots: [seed()], frameCount: 120, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 10;
  const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack, ...extra }, 'agent');
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.ok(!receipt.warnings.some(row => row.code === 'PROMPT_ONLY'), `${JSON.stringify(stack)}: no prompt-only part`);
  console.log(`  ${receipt.summary} checks=${JSON.stringify(Object.fromEntries(Object.entries(receipt.checks).filter(([key]) => !['derivedSize', 'screenFraction', 'clipped', 'behindCamera', 'occluded', 'cameraSide'].includes(key))))}`);
  return { receipt, shot: shotOf(f) };
}

test('the seven techniques apply their capability and the receipt reads it back', () => {
  const f = shotsFixture();
  try {
    const dutch = apply(f, ['dutch-angle']);
    assert.equal(dutch.receipt.checks.rollDeg, 20);
    assert.match(dutch.receipt.summary, /roll 20°/);
    assert.match(dutch.shot.technique.phrase, /a Dutch angle, the horizon tilted 20 degrees, falling to the right/);
    const canted = apply(f, [{ id: 'canted-frame', params: { side: 'left' } }]);
    assert.equal(canted.receipt.checks.rollDeg, -8);
    const rack = apply(f, ['rack-focus']);
    assert.equal(rack.receipt.checks.fStop, 1.4);
    assert.match(rack.receipt.checks.focus, /^.+ → .+$/, 'focus moves between two subjects');
    const [near, far] = rack.receipt.checks.focusDistances;
    assert.ok(Math.abs(near - far) > 0.5, `the rack pulls ${near} m to ${far} m`);
    assert.deepEqual(rack.shot.camera.rigKeys.map(key => key.offset), [29, 57]);
    assert.equal(apply(f, ['handheld-shot']).receipt.checks.shakeAmplitude, 0.25);
    assert.equal(apply(f, [{ id: 'handheld-shot', params: { intensity: 'strong' } }]).receipt.checks.shakeAmplitude, 0.8);
    const snorri = apply(f, ['snorricam']);
    assert.equal(snorri.receipt.checks.mountBone, 'chest');
    assert.equal(snorri.shot.camera.mount.characterId, 'actor-a');
    assert.match(snorri.receipt.summary, /mounted on .+'s chest/);
    assert.equal(apply(f, ['slow-motion']).receipt.checks.speed, 0.5);
    assert.equal(apply(f, [{ id: 'slow-motion', params: { rate: 'quarter' } }]).receipt.checks.speed, 0.25);
    const whip = apply(f, ['whip-pan']);
    assert.equal(whip.receipt.checks.shutterDeg, 270);
    assert.equal(whip.receipt.checks.moveVerified, true, 'the whip pan still verifies as a pan');
    assert.match(buildShotPrompt(shotCaptureMeta({ shot: whip.shot, fps: 24 })), /RIG: heavy motion blur \(270-degree shutter\)/);
    for (const id of ['dutch-angle', 'canted-frame', 'rack-focus', 'handheld-shot', 'snorricam', 'slow-motion', 'whip-pan']) assert.ok(describeTechnique(id).sets?.length && !describeTechnique(id).promptOnly, id);
    assert.deepEqual(Object.keys(PLANNED_CAPABILITIES), ['coverage-generator']);
  } finally { f.dispose(); }
});

test('a stack is one undo entry; re-applying clears what the old stack set and keeps the rest', () => {
  const f = shotsFixture();
  try {
    const before = (() => { f.shots.load({ shots: [seed()], frameCount: 120, camera: f.actual.readStudioState().camera }); return f.snapshot(); })();
    const { receipt } = apply(f, ['low-angle', 'push-in', 'dutch-angle', 'handheld-shot']);
    assert.equal(receipt.checks.move, 'push-in');
    assert.deepEqual(Object.keys(cameraCapabilities(shotOf(f).camera)).sort(), ['rollDeg', 'shake']);
    assert.equal(f.run('edit.undo', { receiptId: receipt.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), before, 'one undo takes keys, roll and shake back');
    apply(f, ['dutch-angle', 'handheld-shot']);
    assert.equal(f.run('camera.set', { shotId: 'shot-a', speed: 0.5 }, 'agent').ok, true, 'a hand-set speed');
    const again = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: ['dutch-angle'] }, 'agent');
    assert.equal(again.ok, true);
    const caps = cameraCapabilities(shotOf(f).camera);
    assert.equal(caps.shake, undefined, 'the shake the previous stack set is cleared');
    assert.equal(caps.rollDeg, 20);
    assert.equal(caps.speed, 0.5, 'a speed no stack set stays');
  } finally { f.dispose(); }
});

test('camera.set and camera.setKey write the fields directly, refuse strangers, and answer the sampled result', () => {
  const f = shotsFixture();
  try {
    f.shots.load({ shots: [seed()], frameCount: 120, camera: f.actual.readStudioState().camera });
    const set = f.run('camera.set', { shotId: 'shot-a', rollDeg: 12, lens: { fStop: 2, focusTarget: 'actor-b' }, shutterDeg: 180 }, 'agent');
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal(set.checks.rollDeg, 12);
    assert.equal(set.checks.fStop, 2);
    assert.ok(set.checks.focusDistances[0] > 0);
    assert.equal(set.checks.shutterDeg, 180);
    assert.ok(set.undo?.historyEntryId, 'one undo entry');
    assert.equal(f.run('camera.set', { shotId: 'shot-a', lens: { fStop: 4 } }, 'agent').checks.fStop, 4);
    assert.equal(shotOf(f).camera.lens.focusTarget, 'actor-b', 'a lens patch merges');
    assert.equal(f.run('camera.set', { shotId: 'shot-a', mount: { characterId: 'nobody' } }, 'agent').code, 'STALE_TARGET');
    assert.equal(f.run('camera.set', { shotId: 'shot-a', rollDeg: null, lens: null }, 'agent').ok, true);
    assert.equal(shotOf(f).camera.rollDeg, undefined);
    const a = f.run('camera.setKey', { shotId: 'shot-a', frame: 10, focus: { targetId: 'actor-a' } }, 'agent');
    const b = f.run('camera.setKey', { shotId: 'shot-a', frame: 50, focus: { targetId: 'actor-b' }, rollDeg: 15 }, 'agent');
    assert.equal(a.ok && b.ok, true, JSON.stringify(b));
    assert.deepEqual(shotOf(f).camera.rigKeys, [{ offset: 10, focus: { targetId: 'actor-a' } }, { offset: 50, rollDeg: 15, focus: { targetId: 'actor-b' } }]);
    assert.match(b.checks.focus, / → /);
    assert.equal(f.run('camera.setKey', { shotId: 'shot-a', frame: 50, remove: true }, 'agent').ok, true);
    assert.deepEqual(shotOf(f).camera.rigKeys, [{ offset: 10, focus: { targetId: 'actor-a' } }]);
    assert.equal(f.run('camera.setKey', { shotId: 'shot-a', frame: 300, rollDeg: 5 }, 'agent').code, 'TARGET_NOT_READY');
  } finally { f.dispose(); }
});
