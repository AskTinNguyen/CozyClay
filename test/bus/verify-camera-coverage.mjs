// A1: camera.cover through the real App wiring (shots-fixture.mjs). Every
// coverage pattern lays its shots over a range as ONE undo entry: the shot
// count and ranges the planner promises, each shot's technique stack and
// coverage record, every camera (at both ends of every shot) on one side of
// the line between the two speakers, no cut rule broken, and one undo that
// restores the document. Also: a range inside a shot splits its edges off, an
// empty timeline gets a shot, and a request in words picks the pattern.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { createCharacterEntry } from '../../src/scenes.js';
import { COVERAGE_PATTERNS, coveragePattern } from '../../src/camera-coverage/patterns.js';
import { splitRange } from '../../src/camera-coverage/plan.js';
import { checkCuts } from '../../src/camera-coverage/cut-rules.js';
import { lineSide, shotCameraAt } from '../../src/camera-coverage/cut-geometry.js';
import { currentTechnique } from '../../src/camera-techniques/storage.js';
import { readShotAuthoring, serializeShotAuthoring } from '../../src/shot-authoring.js';

// Mara (actor-a) and Joon (actor-b) face each other 4 m apart.
const characters = [createCharacterEntry({ id: 'actor-a', model: 'y-bot-tpose', x: 0, z: 0, rot: 90, subject: 'Mara' }), createCharacterEntry({ id: 'actor-b', model: 'y-bot-tpose', x: 4, z: 0, rot: -90, subject: 'Joon' })];
const seed = (start = 0, end = 191) => ({ ...createShot('Scene', start, end, [{ id: 'key-a', frame: start, framing }]), id: 'shot-a' });
function load(f, shots = [seed()], frameCount = 240) {
  f.shots.load({ shots, frameCount, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 10;
}
const shotsOf = f => [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
const sceneOf = f => ({ cast: f.actual.readStudioState().characters.filter(row => !row.hidden), filmback: f.actual.readStudioState().filmback });

test('every pattern lays its shots as one undo entry, on one side of the line, with clean cuts', () => {
  const f = shotsFixture({ characters });
  try {
    for (const pattern of COVERAGE_PATTERNS) {
      load(f);
      const before = f.snapshot();
      const receipt = f.run('camera.cover', { pattern: pattern.id, cast: ['actor-a', 'actor-b'], shotId: 'shot-a' }, 'agent');
      assert.equal(receipt.ok, true, `${pattern.id}: ${JSON.stringify(receipt).slice(0, 600)}`);
      assert.ok(receipt.undo?.historyEntryId, `${pattern.id}: one undo entry`);
      const shots = shotsOf(f), expected = pattern.shots();
      assert.equal(shots.length, expected.length, `${pattern.id}: ${expected.length} shots`);
      assert.deepEqual(shots.map(row => [row.startFrame, row.endFrame]), splitRange({ startFrame: 0, endFrame: 191 }, expected.length).map(row => [row.startFrame, row.endFrame]), `${pattern.id}: an even split of 0-191`);
      assert.equal(receipt.checks.shots, expected.length);
      const scene = sceneOf(f), a = scene.cast.find(row => row.id === 'actor-a'), b = scene.cast.find(row => row.id === 'actor-b');
      const sides = [];
      shots.forEach((shot, i) => {
        const stored = currentTechnique(shot);
        assert.ok(stored, `${pattern.id} ${shot.name}: the stack is stored and describes the camera`);
        const want = receipt.output.shots[i];
        assert.equal(shot.id, want.id);
        const stacks = [expected[i].stack, ...(expected[i].alternates ?? [])].map(stack => stack.map(row => row.id).join('+'));
        assert.ok(stacks.includes(stored.stack.map(row => row.id).join('+')), `${pattern.id} ${shot.name}: the pattern's stack (${stored.stack.map(row => row.id)})`);
        assert.deepEqual(shot.coverage, { pattern: pattern.id, index: i, role: expected[i].role, subjectId: expected[i].who === 1 ? 'actor-b' : 'actor-a' }, `${pattern.id}: coverage record`);
        assert.match(shot.name, new RegExp(`^${pattern.tag.replace(/[+]/g, '\\+')} ${i + 1} · ${expected[i].role}`), `${pattern.id}: shot name ${shot.name}`);
        for (const at of [shot.startFrame, shot.endFrame]) sides.push(lineSide(shotCameraAt(shot, at, scene).pos, a, { x: b.x - a.x, z: b.z - a.z }));
      });
      assert.ok(sides.every(value => Math.sign(value) === Math.sign(sides[0]) || Math.abs(value) <= 0.2), `${pattern.id}: every camera on one side of the line: ${sides.map(v => v.toFixed(2)).join(' ')}`);
      const cuts = checkCuts(shots, scene);
      assert.equal(cuts.issueCount, 0, `${pattern.id}: no rule broken: ${JSON.stringify(cuts.cuts.flatMap(cut => cut.issues.map(issue => issue.message)))}`);
      assert.equal(receipt.checks.issues, 0);
      console.log(`PASS ${pattern.id}: ${shots.map(row => `${row.name} [${row.startFrame}-${row.endFrame}] ${currentTechnique(row).label}`).join(' | ')}; sides ${sides.map(v => v.toFixed(1)).join(',')}`);
      assert.equal(f.run('edit.undo', { receiptId: receipt.receiptId }, 'agent').status, 'undone', `${pattern.id}: undo`);
      assert.deepEqual(f.snapshot(), before, `${pattern.id}: one undo restores the document`);
    }
  } finally { f.dispose(); }
});

test('a reverse pattern keeps each reverse on its side: OTS cameras alternate behind each speaker', () => {
  const f = shotsFixture({ characters });
  try {
    load(f);
    const receipt = f.run('camera.cover', { pattern: 'shot-reverse-shot', cast: ['actor-a', 'actor-b'], shotId: 'shot-a', shots: 6 }, 'agent');
    assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 400));
    const shots = shotsOf(f), scene = sceneOf(f);
    assert.equal(shots.length, 6);
    shots.forEach((shot, i) => {
      const camera = shotCameraAt(shot, shot.startFrame, scene), over = i % 2 ? { x: 0, z: 0 } : { x: 4, z: 0 };
      assert.ok(Math.hypot(camera.pos.x - over.x, camera.pos.z - over.z) < 1, `${shot.name}: the camera stands behind the listener`);
      assert.equal(shot.coverage.subjectId, i % 2 ? 'actor-b' : 'actor-a');
    });
    const reloaded = readShotAuthoring(serializeShotAuthoring({ shots: f.live.current.shots, frameCount: 240 })).state.shots;
    assert.deepEqual(reloaded.map(row => row.coverage), shots.map(row => row.coverage), 'the coverage record survives save and reload');
  } finally { f.dispose(); }
});

test('ranges: inside a shot the edges split off; an empty timeline gets a shot; words pick the pattern', () => {
  const f = shotsFixture({ characters });
  try {
    load(f);
    const inside = f.run('camera.cover', { pattern: 'dialogue-singles', range: { startFrame: 40, endFrameExclusive: 136 } }, 'agent');
    assert.equal(inside.ok, true, JSON.stringify(inside).slice(0, 400));
    assert.deepEqual(shotsOf(f).map(row => [row.startFrame, row.endFrame]), [[0, 39], [40, 87], [88, 135], [136, 191]], 'the edges of the old shot stay as shots');
    assert.equal(shotsOf(f)[0].id, 'shot-a', 'the shot before the range keeps its id');
    load(f, []);
    const empty = f.run('camera.cover', { request: 'give me master and coverage', cast: ['actor-b', 'actor-a'] }, 'agent');
    assert.equal(empty.ok, true, JSON.stringify(empty).slice(0, 400));
    assert.equal(empty.checks.pattern, 'master-coverage');
    assert.deepEqual([shotsOf(f)[0].startFrame, shotsOf(f).at(-1).endFrame], [0, 239], 'the whole timeline');
    assert.equal(shotsOf(f)[1].coverage.subjectId, 'actor-b', 'cast order: Joon first');
    load(f);
    const routed = f.run('camera.applyTechnique', { shotId: 'shot-a', request: 'cover this conversation' }, 'agent');
    assert.equal(routed.ok, true, JSON.stringify(routed).slice(0, 400));
    assert.equal(shotsOf(f).length, coveragePattern('shot-reverse-shot').shots().length, 'a coverage request to camera.applyTechnique lays the pattern');
    load(f, [seed(0, 7)]);
    const short = f.run('camera.cover', { pattern: 'master-coverage', shotId: 'shot-a' }, 'agent');
    assert.equal(short.code, 'INVALID_RANGE', 'too short a range is refused');
    load(f, [seed(0, 100), { ...createShot('Next', 101, 191), id: 'shot-b' }]);
    const across = f.run('camera.cover', { pattern: 'dialogue-singles', range: { startFrame: 50, endFrameExclusive: 150 } }, 'agent');
    assert.equal(across.code, 'INVALID_RANGE', 'a range that cuts across two shots is refused');
    load(f, [seed(0, 95), { ...createShot('Next', 96, 335), id: 'shot-b' }], 400);
    assert.equal(f.run('camera.cover', { pattern: 'shot-reverse-shot', cast: ['actor-a', 'actor-b'], shotId: 'shot-a', side: 'left' }, 'agent').ok, true);
    const next = f.run('camera.cover', { pattern: 'master-coverage', cast: ['actor-a', 'actor-b'], shotId: 'shot-b' }, 'agent');
    assert.equal(next.ok, true, JSON.stringify(next).slice(0, 300));
    assert.equal(checkCuts(shotsOf(f), sceneOf(f)).issueCount, 0, 'a pattern laid after another keeps its side of the line, so the seam between them cuts clean');
  } finally { f.dispose(); }
});

test('camera.checkCuts reads the laid cuts clean, then flags a camera moved across the line', () => {
  const f = shotsFixture({ characters });
  try {
    load(f);
    assert.equal(f.run('camera.cover', { pattern: 'shot-reverse-shot', cast: ['actor-a', 'actor-b'], shotId: 'shot-a' }, 'agent').ok, true);
    const clean = f.run('camera.checkCuts', {}, 'agent');
    assert.equal(clean.ok, true, JSON.stringify(clean).slice(0, 400));
    assert.deepEqual([clean.checks.cuts, clean.checks.issues], [3, 0]);
    assert.ok(!clean.undo, 'read only: no undo entry');
    const third = shotsOf(f)[2], key = third.cameraKeys[0];
    // Mirror the third shot's camera across the Mara-Joon line (z -> -z).
    const crossed = f.run('shot.frame', { shotId: third.id, subjectIds: ['actor-a'], framing: { exact: { position: { x: key.framing.pos.x, y: key.framing.pos.y, z: -key.framing.pos.z * 3 }, lookAt: { x: 0, y: 1.5, z: 0 }, focalMm: 60 } } }, 'agent');
    assert.equal(crossed.ok, true, JSON.stringify(crossed).slice(0, 400));
    const flagged = f.run('camera.checkCuts', { request: `is the cut at ${third.startFrame} crossing the line?` }, 'agent');
    assert.equal(flagged.ok, true);
    assert.equal(flagged.checks.cuts, 1, 'the one cut asked about');
    assert.equal(flagged.output.cuts[0].cutFrame, third.startFrame);
    assert.ok(flagged.output.cuts[0].issues.some(issue => issue.rule === 'line' && issue.severity === 'high' && issue.fix), JSON.stringify(flagged.output.cuts[0]));
    assert.ok(flagged.warnings.some(row => row.code === 'CUT_LINE' && row.id === third.id));
    const viaTechnique = f.run('camera.applyTechnique', { request: 'check my cuts' }, 'agent');
    assert.equal(viaTechnique.ok, true, JSON.stringify(viaTechnique).slice(0, 300));
    assert.ok(viaTechnique.checks.issues >= 1, 'a cut question to camera.applyTechnique runs camera.checkCuts');
    console.log(`PASS ${flagged.summary}`);
  } finally { f.dispose(); }
});
