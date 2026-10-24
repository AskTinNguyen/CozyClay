// depth-staging A1, A5, A6 through the command bus (shots-fixture.mjs): a pillar
// placed between a shot's camera and Mara is flagged by camera.checkShots (asked
// in words too), camera.fixShot applies the suggested camera change as one
// undo entry and the shot checks clean, undo puts the keys back; a rail shot is
// refused; the coverage patterns laid by camera.cover in the empty set check clean.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { createCharacterEntry } from '../../src/scenes.js';

const characters = [createCharacterEntry({ id: 'actor-a', model: 'y-bot-tpose', x: 0, z: 0, rot: 90, subject: 'Mara' }), createCharacterEntry({ id: 'actor-b', model: 'y-bot-tpose', x: 4, z: 0, rot: -90, subject: 'Joon' })];
const seed = (end = 95) => ({ ...createShot('Hero', 0, end, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' });
const keysOf = f => structuredClone(f.live.current.shots.find(row => row.id === 'shot-a').cameraKeys);
function fresh(f, end) { f.shots.load({ shots: [seed(end)], frameCount: 240, camera: f.actual.readStudioState().camera }); f.live.current.timeline.currentFrame = 10; }

test('a pillar between the camera and Mara: flagged, asked in words, fixed as one undo entry, undone', () => {
  const f = shotsFixture({ characters });
  try {
    fresh(f);
    assert.equal(f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: ['medium-shot'] }, 'agent').ok, true);
    const clean = f.run('camera.checkShots', {}, 'agent');
    assert.equal(clean.ok, true, JSON.stringify(clean).slice(0, 400));
    assert.equal(clean.checks.issues, 0, JSON.stringify(clean.output.shots));
    const pos = keysOf(f)[0].framing.pos;
    assert.equal(f.run('object.add', { kind: 'cylinder', placement: { x: pos.x * 0.5, z: pos.z * 0.5 }, name: 'Pillar' }, 'agent').ok, true);
    const pillar = f.actual.readStudioState().objects.find(row => row.name === 'Pillar').id;
    assert.equal(f.run('object.set', { id: pillar, set: { scale: { x: 0.4, y: 3, z: 0.4 } } }, 'agent').ok, true);
    // Asked in words on camera.applyTechnique, the router runs camera.checkShots (its receipt keeps the checks and warnings).
    const routed = f.run('camera.applyTechnique', { request: 'is anything blocking her face?' }, 'agent');
    assert.equal(routed.ok, true, JSON.stringify(routed).slice(0, 400));
    assert.deepEqual([routed.checks.issues, routed.checks.flagged, routed.checks.matched], [1, 1, ['blocking', 'her']]);
    assert.match(routed.summary, /checked for occluded: Hero: Pillar hides Mara's eyes/);
    assert.ok(routed.warnings.some(row => row.code === 'SHOT_OCCLUDED' && row.id === 'shot-a'));
    const asked = f.run('camera.checkShots', { request: 'is anything blocking her face?' }, 'agent');
    const [shot] = asked.output.shots, [issue] = shot.issues;
    assert.equal(asked.output.rule, 'occluded');
    assert.deepEqual([issue.rule, issue.severity, issue.by], ['occluded', 'high', [pillar]], JSON.stringify(issue));
    assert.equal(issue.frames.length, shot.frames, 'every sampled frame');
    assert.deepEqual(asked.output.matched, ['blocking', 'her']);
    assert.ok(issue.fix.delta && /^(slide|raise|lower)/.test(issue.fix.text), JSON.stringify(issue.fix));
    const before = keysOf(f);
    const fixed = f.run('camera.fixShot', { shotId: 'shot-a', rule: 'occluded' }, 'agent');
    assert.equal(fixed.ok, true, JSON.stringify(fixed).slice(0, 400));
    assert.ok(fixed.undo?.historyEntryId, 'one undo entry');
    assert.equal(fixed.checks.issues, 0, JSON.stringify(fixed).slice(0, 600));
    const moved = keysOf(f)[0].framing.pos;
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(moved[axis] - before[0].framing.pos[axis] - issue.fix.delta[axis]) < 1e-6, `${axis} moved by the fix`);
    assert.equal(f.run('camera.checkShots', { rule: 'occluded' }, 'agent').checks.issues, 0, 'checked again: clean');
    assert.equal(f.run('edit.undo', { receiptId: fixed.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(keysOf(f), before, 'undo puts the camera back');
    assert.equal(f.run('camera.checkShots', { shotIds: ['shot-a'] }, 'agent').checks.flagged, 1);
    const inside = f.run('camera.checkShots', { request: 'is the camera inside the wall?' }, 'agent');
    assert.equal(inside.output.rule, 'inside');
    assert.equal(inside.checks.issues, 0);
    assert.equal(f.run('camera.fixShot', { shotId: 'shot-a', rule: 'inside' }, 'agent').code, 'TARGET_NOT_READY', 'nothing to fix for a clean rule');
  } finally { f.dispose(); }
});

test('the coverage patterns laid by camera.cover check clean in the empty set; their receipts list the depth layers', () => {
  const f = shotsFixture({ characters });
  try {
    for (const pattern of ['shot-reverse-shot', 'master-coverage', 'dialogue-singles', 'action-coverage', 'establish-detail']) {
      fresh(f, 191);
      const laid = f.run('camera.cover', { pattern, cast: ['actor-a', 'actor-b'], shotId: 'shot-a' }, 'agent');
      assert.equal(laid.ok, true, `${pattern}: ${JSON.stringify(laid).slice(0, 300)}`);
      const report = f.run('camera.checkShots', {}, 'agent');
      assert.equal(report.checks.issues, 0, `${pattern}: ${JSON.stringify(report.output.shots.flatMap(row => row.issues.map(issue => `${row.name}: ${issue.message}`)))}`);
      assert.ok(report.output.shots.every(row => row.layers && Array.isArray(row.layers.foreground)), `${pattern}: layers per shot`);
    }
    fresh(f, 191);
    f.run('camera.cover', { pattern: 'shot-reverse-shot', cast: ['actor-a', 'actor-b'], shotId: 'shot-a' }, 'agent');
    const ots = f.run('camera.checkShots', {}, 'agent').output.shots.find(row => row.layers.foreground.includes('Joon'));
    assert.ok(ots && /Joon's shoulder soft in the foreground/.test(ots.layers.words), 'an over-the-shoulder lists the near shoulder in its foreground');
    const applied = f.run('camera.applyTechnique', { shotId: ots.shotId, subjectId: 'actor-a', stack: ['over-the-shoulder'] }, 'agent');
    assert.deepEqual(applied.output.layers.foreground, ['Joon'], 'camera.applyTechnique lists the layers too');
  } finally { f.dispose(); }
});

test('a cart on an authored path rolls onto the sight line mid-shot: camera.checkShots measures it through the editor bounds, timed over the timeline (PR #17 review)', () => {
  const f = shotsFixture({ characters });
  try {
    fresh(f);
    assert.equal(f.run('object.add', { kind: 'cube', placement: { x: -5, z: 2.5 }, name: 'Cart' }, 'agent').ok, true);
    const cart = f.actual.readStudioState().objects.find(row => row.name === 'Cart').id;
    const set = f.run('object.set', { id: cart, set: { scale: { x: 0.6, y: 3, z: 0.6 }, path: { points: [{ x: -5, y: 0, z: 2.5 }, { x: 0, y: 0, z: 2.5 }], speed: 2.5 } } }, 'agent');
    assert.equal(set.ok, true, JSON.stringify(set).slice(0, 300));
    const report = f.run('camera.checkShots', { shotIds: ['shot-a'] }, 'agent'), [issue] = report.output.shots[0].issues;
    assert.equal(issue?.rule, 'occluded', JSON.stringify(report.output.shots[0]));
    assert.deepEqual(issue.by, [cart]);
    assert.ok(issue.frames.includes(95) && !issue.frames.includes(0), `blocked once it arrives, clear at the start: ${issue.frames}`);
  } finally { f.dispose(); }
});
