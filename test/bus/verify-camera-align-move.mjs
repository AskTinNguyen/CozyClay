// camera-motivation A4: camera.alignMove { shotId, beat } retimes a move's
// camera keys (or rig keys) so it starts or settles on the beat, as one undo
// entry, and the re-check is clean. Also: the request form ("start the push on
// the reveal") through camera.applyTechnique, the settle edge squeezed at a
// shot edge, a roll on rig keys, a stored technique that still describes the
// camera, and the refusals (a rail, a hold, an unknown beat).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { createCharacterEntry } from '../../src/scenes.js';
import { currentTechnique } from '../../src/camera-techniques/storage.js';

const characters = [createCharacterEntry({ id: 'actor-a', model: 'y-bot-tpose', x: 0, z: 0, rot: 0, subject: 'Mara, a woman in a red raincoat' })];
const at = (z, extra = {}) => ({ pos: { x: 0, y: 1.6, z }, yaw: 0, pitch: 0, fovDeg: 40, ...extra });
const keyed = (id, start, end, keys, extra = {}) => ({ ...createShot(id, start, end, keys.map(([frame, framing], i) => ({ id: `${id}-k${i}`, frame, framing }))), id, ...extra });
const shotOf = (f, id) => f.live.current.shots.find(row => row.id === id);
function setup(shots) {
  const f = shotsFixture({ characters });
  f.shots.load({ shots, frameCount: 240, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 110;
  return f;
}
const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 500)); return receipt; };

test('camera.alignMove starts a push on its story beat as one undo entry; the re-check is clean', () => {
  const f = setup([keyed('shot-push', 96, 191, [[100, at(5)], [140, at(2.5)]])]);
  try {
    ok(f.run('story.addBeat', { frame: 120, label: 'Mara makes her admission', kind: 'disclosure' }, 'agent'));
    const before = ok(f.run('camera.checkMotivation', {}, 'agent'));
    assert.deepEqual(before.output.shots[0].moves[0].issues.map(row => [row.rule, row.fix]), [['starts-off-beat', "start the push at f120 on 'Mara makes her admission'"]]);
    assert.equal(before.checks.issues, 1);
    const snapshot = f.snapshot();
    const aligned = ok(f.run('camera.alignMove', { shotId: 'shot-push', beat: 'story-beat-1' }, 'agent'));
    assert.ok(aligned.undo?.historyEntryId, 'one undo entry');
    assert.deepEqual(shotOf(f, 'shot-push').cameraKeys.map(key => key.frame), [120, 160], 'the keys keep their poses and length, moved 20 frames');
    assert.deepEqual(shotOf(f, 'shot-push').cameraKeys.map(key => key.framing.pos.z), [5, 2.5]);
    assert.equal(aligned.checks.issues, 0, 'the receipt carries the re-check');
    assert.match(aligned.summary, /Started the move in shot-push \[96, 192\) on 'Mara makes her admission' at f120: f100-140 -> f120-160; re-check clean\./);
    assert.equal(ok(f.run('camera.checkMotivation', {}, 'agent')).checks.issues, 0, 'a re-check is clean');
    assert.equal(f.run('edit.undo', { receiptId: aligned.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), snapshot, 'one undo restores the keys');
    console.log(`PASS A4 start: ${aligned.summary}`);
  } finally { f.dispose(); }
});

test('the request form, the settle edge, rig keys and a stored technique', () => {
  const f = setup([keyed('shot-push', 96, 191, [[100, at(5)], [140, at(2.5)]])]);
  try {
    ok(f.run('story.addBeat', { frame: 130, label: 'the letter', kind: 'reveal' }, 'agent'));
    const asked = ok(f.run('camera.applyTechnique', { request: 'start the push on the reveal' }, 'agent'));
    assert.equal(asked.action, 'camera.applyTechnique');
    assert.deepEqual(shotOf(f, 'shot-push').cameraKeys.map(key => key.frame), [130, 170], 'routed to camera.alignMove: the reveal is the beat of that kind');
    assert.match(asked.summary, /^Started the move in shot-push \[96, 192\) on 'the letter' at f130/);
    const settled = ok(f.run('camera.alignMove', { shotId: 'shot-push', beat: 'the letter', edge: 'settle' }, 'agent'));
    assert.deepEqual(shotOf(f, 'shot-push').cameraKeys.map(key => key.frame), [96, 130], 'it rests on the beat; the shot edge squeezes its start');
    assert.match(settled.summary, /^Settled the move .* f130-170 -> f96-130;/);
  } finally { f.dispose(); }

  const roll = keyed('shot-roll', 0, 95, [[0, at(4)]], { camera: { mode: 'keys', rigKeys: [{ offset: 10, rollDeg: 0 }, { offset: 40, rollDeg: 12 }] } });
  const g = setup([roll]);
  try {
    ok(g.run('story.addBeat', { frame: 20, label: 'the ground tilts', kind: 'event' }, 'agent'));
    const check = ok(g.run('camera.checkMotivation', { shotIds: ['shot-roll'] }, 'agent'));
    assert.deepEqual(check.output.shots[0].moves.map(row => [row.move, row.startFrame, row.endFrame]), [['roll', 10, 40]], 'a roll on rig keys is a move');
    const aligned = ok(g.run('camera.alignMove', { beat: 'the ground tilts' }, 'agent'));
    assert.deepEqual(shotOf(g, 'shot-roll').camera.rigKeys.map(key => key.offset), [20, 50], 'the rig keys move');
    assert.equal(aligned.checks.issues, 0);
  } finally { g.dispose(); }

  const h = setup([keyed('shot-a', 0, 191, [[0, at(5)]])]);
  try {
    ok(h.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: [{ id: 'medium-shot' }, { id: 'push-in' }] }, 'agent'));
    const stored = shotOf(h, 'shot-a');
    assert.ok(currentTechnique(stored), 'the push-in stack describes the camera');
    const first = stored.cameraKeys[0].frame;
    ok(h.run('story.addBeat', { frame: first + 30, label: 'the knock', kind: 'event' }, 'agent'));
    ok(h.run('camera.alignMove', { shotId: 'shot-a', beat: 'the knock' }, 'agent'));
    assert.equal(shotOf(h, 'shot-a').cameraKeys[0].frame, first + 30);
    assert.ok(currentTechnique(shotOf(h, 'shot-a')), 'and still does after the retime (its prompt words stay)');
    console.log('PASS A4 variants: request, settle squeezed at the shot edge, rig keys, technique kept');
  } finally { h.dispose(); }
});

test('the holds around a retimed move stay holds: a forward and a backward shift, camera keys and rig keys', () => {
  const zs = shot => shotOf(...shot).cameraKeys.map(key => [key.frame, key.framing.pos.z]);
  // One push over f20-60 between holds; moved to start at f90, the hold at f70 it sweeps past goes.
  const f = setup([keyed('shot-hold', 0, 191, [[0, at(5)], [20, at(5)], [60, at(2.5)], [70, at(2.5)], [150, at(2.5)]])]);
  try {
    ok(f.run('story.addBeat', { frame: 90, label: 'the reveal', kind: 'reveal' }, 'agent'));
    const aligned = ok(f.run('camera.alignMove', { shotId: 'shot-hold', beat: 'the reveal' }, 'agent'));
    assert.deepEqual(zs([f, 'shot-hold']), [[0, 5], [90, 5], [130, 2.5], [150, 2.5]], 'hold, one push starting on the beat, hold');
    const moves = ok(f.run('camera.checkMotivation', {}, 'agent')).output.shots[0].moves;
    assert.deepEqual(moves.map(row => [row.move, row.startFrame, row.endFrame]), [['push-in', 90, 130]], 'one move, no reverse');
    assert.equal(aligned.checks.issues, 0);
  } finally { f.dispose(); }
  // Backward: a push over f80-120 moved to start at f30; the hold at f10 before the swept interval stays.
  const g = setup([keyed('shot-back', 0, 191, [[0, at(5)], [10, at(5)], [80, at(5)], [120, at(2.5)], [150, at(2.5)]])]);
  try {
    ok(g.run('story.addBeat', { frame: 30, label: 'the knock', kind: 'event' }, 'agent'));
    ok(g.run('camera.alignMove', { shotId: 'shot-back', beat: 'the knock' }, 'agent'));
    assert.deepEqual(zs([g, 'shot-back']), [[0, 5], [10, 5], [30, 5], [70, 2.5], [150, 2.5]]);
    assert.deepEqual(ok(g.run('camera.checkMotivation', {}, 'agent')).output.shots[0].moves.map(row => [row.move, row.startFrame, row.endFrame]), [['push-in', 30, 70]]);
  } finally { g.dispose(); }
  // The same forward case on rig keys: a roll over f20-60 between roll holds.
  const rolls = [[0, 0], [20, 0], [60, 12], [70, 12], [150, 12]].map(([offset, rollDeg]) => ({ offset, rollDeg }));
  const h = setup([keyed('shot-rollhold', 0, 191, [[0, at(4)]], { camera: { mode: 'keys', rigKeys: rolls } })]);
  try {
    ok(h.run('story.addBeat', { frame: 90, label: 'the ground tilts', kind: 'event' }, 'agent'));
    ok(h.run('camera.alignMove', { shotId: 'shot-rollhold', beat: 'the ground tilts' }, 'agent'));
    assert.deepEqual(shotOf(h, 'shot-rollhold').camera.rigKeys.map(key => [key.offset, key.rollDeg]), [[0, 0], [90, 0], [130, 12], [150, 12]]);
    console.log('PASS A4 holds: forward and backward shifts keep the surrounding holds (camera keys and rig keys)');
  } finally { h.dispose(); }
});

test('refusals: a rail, a hold, an unknown beat, a move with no room', () => {
  const rail = { ...createShot('Rail', 0, 95, [{ id: 'r', frame: 0, framing: at(5) }]), id: 'shot-rail', camera: { mode: 'rail', cameraRail: [{ x: -2, z: 4 }, { x: 2, z: 4 }] } };
  const f = setup([keyed('shot-held', 96, 191, [[96, at(5)]]), rail]);
  try {
    ok(f.run('story.addBeat', { frame: 120, label: 'the door', kind: 'event' }, 'agent'));
    const held = f.run('camera.alignMove', { shotId: 'shot-held', beat: 'the door' }, 'agent');
    assert.deepEqual([held.ok, held.code], [false, 'TARGET_NOT_READY']);
    assert.match(held.message, /holds still: there is no move to align/);
    const unknown = f.run('camera.alignMove', { shotId: 'shot-held', beat: 'the gun' }, 'agent');
    assert.deepEqual([unknown.ok, unknown.code], [false, 'STALE_TARGET']);
    assert.match(unknown.message, /the story beats are event "the door" at f120/);
    const railed = f.run('camera.alignMove', { shotId: 'shot-rail', beat: 40 }, 'agent');
    assert.equal(railed.ok, false);
    assert.match(railed.message, /rides a rail that travels with its subject/);
  } finally { f.dispose(); }
  const g = setup([keyed('shot-late', 96, 191, [[100, at(5)], [140, at(2.5)]])]);
  try {
    const late = g.run('camera.alignMove', { shotId: 'shot-late', beat: 191 }, 'agent');
    assert.deepEqual([late.ok, late.code], [false, 'INVALID_RANGE']);
    console.log(`PASS A4 refusals: ${late.message}`);
  } finally { g.dispose(); }
});
