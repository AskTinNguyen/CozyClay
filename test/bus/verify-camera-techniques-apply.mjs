// camera.applyTechnique through the real App wiring (shots-fixture.mjs):
// every technique the catalog can apply lands on the shot as one undo entry,
// and the camera-move classifier, run here on the stored result, names the
// move the technique promises. Rails are integrated exactly as the editor's
// rail follow does before they are classified.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { classifyMove, cameraMoveAt } from '../../src/camera-move.js';
import { TECHNIQUES, hasGeometry, techniqueById } from '../../src/camera-techniques/index.js';
import { railTrack } from '../../src/camera-techniques/readback.js';
import { currentTechnique } from '../../src/camera-techniques/storage.js';
import { readShotAuthoring, serializeShotAuthoring } from '../../src/shot-authoring.js';
import { focalMmToFov } from '../../src/shot.js';

const seed = () => ({ ...createShot('Hero', 0, 95, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' });
function fresh(f) {
  f.shots.load({ shots: [seed()], frameCount: 120, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 10;
}
const shotOf = f => f.live.current.shots.find(row => row.id === 'shot-a');
const subjectOf = f => { const row = f.actual.readStudioState().characters.find(entry => entry.id === 'actor-a'); return { x: row.x, z: row.z, rot: row.rot ?? 0 }; };
const filmbackOf = f => f.actual.readStudioState().filmback;

/** The move the stored camera makes, read with classifyMove alone. */
function readBack(f, shot) {
  const subject = subjectOf(f), filmback = filmbackOf(f), opts = (a, b) => ({ durationS: (b - a) / 24, sensorId: filmback.sensorId, aspectRatio: filmback.aspectRatio });
  if (shot.camera.mode === 'rail') {
    const track = railTrack({ points: shot.camera.cameraRail, height: shot.camera.craneHeight.points[0].height, aimHeight: shot.camera.aim?.height ?? 1.35, response: shot.camera.followCam.response }, subject, shot.endFrame - shot.startFrame + 1);
    const fovDeg = focalMmToFov(shot.camera.focalMm, filmback.sensorId, filmback.aspectRatio) * 180 / Math.PI;
    return { id: classifyMove({ ...track[0], fovDeg }, { ...track.at(-1), fovDeg }, subject, opts(0, track.length - 1)).id };
  }
  const keys = shot.cameraKeys;
  if (keys.length === 1) return { id: classifyMove(keys[0].framing, keys[0].framing, subject, opts(0, 1)).id };
  const segments = keys.slice(1).map((key, i) => classifyMove(keys[i].framing, key.framing, subject, opts(keys[i].frame, key.frame))).filter(row => row.id !== 'static');
  if (segments.length > 1) return { id: segments.every(row => row.id === 'orbit') ? 'orbit' : 'mixed', degrees: Math.abs(segments.reduce((sum, row) => sum + row.deltas.dAzDeg, 0)) };
  return { id: segments[0]?.id ?? 'static' };
}

test('every applicable technique lands as one undo entry and the classifier confirms its move', () => {
  const f = shotsFixture(), rows = [];
  try {
    for (const entry of TECHNIQUES) {
      fresh(f);
      const before = f.snapshot(), receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: [entry.id] }, 'agent');
      assert.equal(receipt.ok, true, `${entry.id}: ${JSON.stringify(receipt)}`);
      assert.ok(receipt.undo?.historyEntryId, `${entry.id}: one undo entry`);
      const shot = shotOf(f), stored = currentTechnique(shot);
      assert.equal(stored?.stack[0].id, entry.id, `${entry.id}: the stack is stored and still describes the camera`);
      if (!hasGeometry(entry)) {
        assert.deepEqual(shot.cameraKeys, before.shot.shots[0].cameraKeys, `${entry.id}: a prompt-only technique leaves the camera alone`);
        assert.ok(receipt.warnings.some(row => row.code === 'PROMPT_ONLY' && row.id === entry.id), `${entry.id}: the receipt says prompt only`);
      } else {
        const move = readBack(f, shot), expected = receipt.checks.expectedMove;
        if (entry.expect) assert.equal(expected, entry.expect, `${entry.id}: default params promise ${entry.expect}`);
        assert.equal(move.id, expected, `${entry.id}: classifyMove reads ${move.id}, the technique promises ${expected}`);
        assert.equal(receipt.checks.moveVerified, true, `${entry.id}: the receipt verified its own move`);
        rows.push(`${entry.id}=${move.id}`);
      }
      assert.equal(f.run('edit.undo', { receiptId: receipt.receiptId }, 'agent').status, 'undone', `${entry.id}: undo`);
      assert.deepEqual(f.snapshot(), before, `${entry.id}: one undo restores the shot`);
    }
    console.log(`PASS ${rows.length} techniques: ${rows.join(' ')}`);
  } finally { f.dispose(); }
});

test('moves follow their params: direction, degrees, speed and sizes', () => {
  const f = shotsFixture();
  const apply = (stack, extra = {}) => { fresh(f); const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack, ...extra }, 'agent'); assert.equal(receipt.ok, true, JSON.stringify(receipt)); return { receipt, shot: shotOf(f) }; };
  try {
    for (const [stack, id] of [[[{ id: 'pan-shot', params: { direction: 'left' } }], 'pan-left'], [[{ id: 'tilt-shot', params: { direction: 'down' } }], 'tilt-down'],
      [[{ id: 'crane-shot', params: { direction: 'down' } }], 'crane-down'], [[{ id: 'zoom-shot', params: { direction: 'out' } }], 'zoom-out'],
      [[{ id: 'pedestal-shot', params: { direction: 'down' } }], 'crane-down'], [['low-angle', 'close-up', 'push-in'], 'push-in'], [['high-angle', 'pull-out'], 'pull-out']]) {
      const { receipt, shot } = apply(stack);
      assert.equal(readBack(f, shot).id, id, JSON.stringify(stack));
      assert.equal(receipt.checks.moveVerified, true);
    }
    const push = apply(['low-angle', { id: 'push-in', params: { from: 'wide shot', to: 'close-up' } }]);
    assert.equal(push.receipt.checks.fromSize, 'wide shot');
    assert.equal(push.receipt.checks.toSize, 'close-up');
    assert.match(push.receipt.checks.technique, /^LOW · PUSH-IN · \d+mm$/);
    const slow = apply(['push-in'], { speed: 'slow' }).shot, fast = apply(['push-in'], { speed: 'fast' }).shot;
    assert.ok(fast.cameraKeys.at(-1).frame < slow.cameraKeys.at(-1).frame, 'a fast push-in arrives sooner');
    const orbit = apply([{ id: '360-degree-shot', params: { direction: 'left' } }]).shot;
    assert.equal(orbit.cameraKeys.length, 5);
    assert.ok(orbit.cameraKeys.slice(0, -1).every(key => key.ease === 'linear'), 'the 360 orbits at constant speed');
    assert.ok(Math.abs(readBack(f, orbit).degrees - 360) < 1, `a full circle: ${readBack(f, orbit).degrees}`);
    const arc = apply([{ id: 'arc-shot', params: { degrees: 120 } }]).shot;
    assert.ok(Math.abs(readBack(f, arc).degrees - 120) < 1);
  } finally { f.dispose(); }
});

test('crash zoom and whip pan run at constant speed between their keys', () => {
  const f = shotsFixture();
  try {
    for (const id of ['crash-zoom', 'whip-pan']) {
      fresh(f);
      assert.equal(f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: [id] }, 'agent').ok, true);
      const keys = shotOf(f).cameraKeys, [, hold, end] = keys, anchor = subjectOf(f), filmback = filmbackOf(f);
      assert.equal(keys.length, 3);
      assert.equal(hold.ease, 'linear');
      const mid = cameraMoveAt(keys, anchor, (hold.frame + end.frame) / 2, filmback), quarter = cameraMoveAt(keys, anchor, hold.frame + (end.frame - hold.frame) / 4, filmback);
      if (id === 'crash-zoom') {
        const mm = fov => 1 / Math.tan(fov * Math.PI / 360), at = [hold, end].map(key => mm(key.framing.fovDeg));
        assert.ok(Math.abs(mm(mid.fovDeg) - (at[0] + at[1]) / 2) < 1e-6 * at[1], 'the lens is halfway at the halfway frame');
        assert.ok(Math.abs(mm(quarter.fovDeg) - (at[0] * 0.75 + at[1] * 0.25)) < 1e-6 * at[1], 'and a quarter of the way at a quarter');
      } else assert.ok(Math.abs(Math.atan2(Math.sin(mid.yaw - hold.framing.yaw), Math.cos(mid.yaw - hold.framing.yaw)) * 2 - Math.atan2(Math.sin(end.framing.yaw - hold.framing.yaw), Math.cos(end.framing.yaw - hold.framing.yaw))) < 0.05);
      assert.ok(end.frame - hold.frame <= 6, 'the snap takes a handful of frames');
    }
  } finally { f.dispose(); }
});

test('group framing, over-the-shoulder and point of view', () => {
  const f = shotsFixture();
  const apply = stack => { fresh(f); const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack }, 'agent'); assert.equal(receipt.ok, true, JSON.stringify(receipt)); return { receipt, key: shotOf(f).cameraKeys[0].framing }; };
  try {
    const cast = f.actual.readStudioState().characters, a = cast.find(row => row.id === 'actor-a'), b = cast.find(row => row.id === 'actor-b');
    const two = apply(['two-shot']);
    assert.equal(two.receipt.checks.membersInFrame, 2);
    assert.equal(two.receipt.checks.members, 2);
    const three = apply(['three-shot']);
    assert.ok(three.receipt.warnings.some(row => row.code === 'TECHNIQUE_NOTE' && /wants 3/.test(row.message)), 'a three-shot of two says so');
    const ots = apply(['over-the-shoulder']).key, toA = Math.hypot(ots.pos.x - a.x, ots.pos.z - a.z), toB = Math.hypot(ots.pos.x - b.x, ots.pos.z - b.z);
    assert.ok(toB < 1 && toA > Math.hypot(a.x - b.x, a.z - b.z), 'the camera stands behind actor-b, looking at actor-a');
    const facingA = { x: -Math.sin(ots.yaw), z: -Math.cos(ots.yaw) }, dirA = { x: (a.x - ots.pos.x) / toA, z: (a.z - ots.pos.z) / toA };
    assert.ok(facingA.x * dirA.x + facingA.z * dirA.z > 0.97, 'and it aims at actor-a');
    const pov = apply(['pov-shot']).key;
    assert.ok(pov.pos.y > 1.45 && pov.pos.y < 1.85, `eye height ${pov.pos.y}`);
    assert.ok(Math.hypot(pov.pos.x - a.x, pov.pos.z - a.z) < 0.4, 'from actor-a\'s head');
    assert.ok(-Math.sin(pov.yaw) * (b.x - a.x) > 0, 'looking toward actor-b');
  } finally { f.dispose(); }
});

test('a natural-language request resolves, applies, and is stored for save and reload', () => {
  const f = shotsFixture();
  try {
    fresh(f);
    const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', request: 'low-angle slow push-in with a dutch tilt' }, 'agent');
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.deepEqual(receipt.output.technique.stack.map(row => row.id), ['low-angle', 'push-in', 'dutch-angle']);
    assert.equal(receipt.output.technique.stack[1].params.speed, 'slow');
    assert.ok(receipt.warnings.some(row => row.code === 'PROMPT_ONLY' && row.id === 'dutch-angle'));
    assert.match(receipt.output.technique.phrase, /^from a low angle looking up; a (slow )?push-in \(dolly in\) from a .+ to a .+; \d+mm lens; a Dutch angle/);
    const reloaded = readShotAuthoring(serializeShotAuthoring({ shots: f.live.current.shots, frameCount: 120 })).state.shots[0];
    assert.deepEqual(reloaded.technique, shotOf(f).technique, 'the stack survives save and reload');
    assert.ok(currentTechnique(reloaded), 'and still describes the reloaded camera');
    const refused = f.run('camera.applyTechnique', { shotId: 'shot-a', stack: ['pan-shot', 'tilt-shot'] }, 'agent');
    assert.equal(refused.code, 'INVALID_ARGUMENT');
    assert.match(refused.message, /two move techniques/);
    assert.equal(techniqueById('pan-shot').kind, 'move');
  } finally { f.dispose(); }
});
