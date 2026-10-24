// group-coverage A2: camera.cover with a cast of three or more through the
// real App wiring (shots-fixture.mjs). triangle-dialogue, group-singles (three
// and six people) and branching-dialogue each lay as ONE undo entry: the shot
// count and ranges the planner promises, each shot's stack and coverage
// record, each pair's authored line, every camera of a pair on one side of
// that pair's line (sides per pair), the same setup repeated camera for
// camera in every branch, zero cut flags, and one undo restores the document.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { createCharacterEntry } from '../../src/scenes.js';
import { coveragePattern } from '../../src/camera-coverage/patterns.js';
import { splitRange } from '../../src/camera-coverage/plan.js';
import { checkCuts } from '../../src/camera-coverage/cut-rules.js';
import { lineSide, shotCameraAt } from '../../src/camera-coverage/cut-geometry.js';
import { currentTechnique } from '../../src/camera-techniques/storage.js';
import { readShotAuthoring, serializeShotAuthoring } from '../../src/shot-authoring.js';

const toward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z) * 180 / Math.PI;
/** People on a circle of `radius`, each facing the centre. */
function circle(names, radius, centre = { x: 2, z: 1.2 }) {
  return names.map((name, i) => {
    const at = { x: centre.x + radius * Math.sin((i * 2 * Math.PI) / names.length), z: centre.z + radius * Math.cos((i * 2 * Math.PI) / names.length) };
    return createCharacterEntry({ id: `actor-${name.toLowerCase()}`, model: 'y-bot-tpose', ...at, rot: toward(at, centre), subject: name });
  });
}
// Mara, Joon and Sela stand in a triangle facing its middle; six for the larger group.
const TRIO = circle(['Mara', 'Joon', 'Sela'], 2.3), SIX = circle(['Mara', 'Joon', 'Sela', 'Ines', 'Kofi', 'Lior'], 3);
/** The fixture loads two rigs (actor-a, actor-b); the others borrow the first one's skeleton for their bounds. */
function fixtureFor(people) {
  const f = shotsFixture({ characters: people });
  for (const row of people) f.live.current.rigs[row.id] ??= f.live.current.rigs['actor-a'];
  return f;
}
const seed = (start = 0, end = 311) => ({ ...createShot('Scene', start, end, [{ id: 'key-a', frame: start, framing }]), id: 'shot-a' });
function load(f, shots = [seed()], frameCount = 400) {
  f.shots.load({ shots, frameCount, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 10;
}
const shotsOf = f => [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
const sceneOf = f => ({ cast: f.actual.readStudioState().characters.filter(row => !row.hidden), filmback: f.actual.readStudioState().filmback });

/** Lay a pattern and assert what every group pattern promises; answers { receipt, shots, scene }. */
function lay(f, args, expected) {
  const before = f.snapshot(), receipt = f.run('camera.cover', args, 'agent');
  assert.equal(receipt.ok, true, `${args.pattern}: ${JSON.stringify(receipt).slice(0, 700)}`);
  assert.ok(receipt.undo?.historyEntryId, `${args.pattern}: one undo entry`);
  const shots = shotsOf(f).filter(row => row.coverage?.pattern === args.pattern), scene = sceneOf(f);
  assert.equal(shots.length, expected.count, `${args.pattern}: ${expected.count} shots`);
  if (expected.ranges) assert.deepEqual(shots.map(row => [row.startFrame, row.endFrame]), expected.ranges, `${args.pattern}: the ranges`);
  shots.forEach((shot, i) => {
    const want = receipt.output.shots[i], stored = currentTechnique(shot);
    assert.equal(shot.id, want.id);
    assert.ok(stored, `${shot.name}: the stack is stored and describes the camera`);
    assert.deepEqual(stored.stack.map(row => row.id), expected.stacks(i), `${shot.name}: its stack`);
    assert.equal(shot.coverage.subjectId, want.subjectId);
    assert.deepEqual(shot.line?.between ?? null, want.line ?? null, `${shot.name}: the authored line`);
  });
  // Sides per pair: every camera of a pair's shots (both ends) on one side of that pair's line.
  const sides = new Map();
  for (const shot of shots.filter(row => row.line)) {
    const [a, b] = shot.line.between.map(castId => scene.cast.find(row => row.id === castId)), key = [...shot.line.between].sort().join('|');
    for (const at of [shot.startFrame, shot.endFrame]) sides.set(key, [...(sides.get(key) ?? []), lineSide(shotCameraAt(shot, at, scene).pos, a, { x: b.x - a.x, z: b.z - a.z })]);
  }
  for (const [key, values] of sides) assert.ok(values.every(value => Math.sign(value) === Math.sign(values[0]) || Math.abs(value) <= 0.2), `${args.pattern} ${key}: one side: ${values.map(v => v.toFixed(2)).join(' ')}`);
  const cuts = checkCuts(shots, scene);
  assert.equal(cuts.issueCount, 0, `${args.pattern}: zero cut flags: ${JSON.stringify(cuts.cuts.flatMap(cut => cut.issues.map(issue => issue.message)))}`);
  // The receipt also reads the seams with the shots around the pattern; between branches those are the old shot's unframed frames.
  if (!expected.seams) assert.equal(receipt.checks.issues, 0);
  console.log(`PASS ${args.pattern} (${scene.cast.length} visible): ${shots.length} shots, ${sides.size} pair line(s) ${[...sides].map(([key, values]) => `${key.replace(/actor-/g, '')} ${values[0] > 0 ? 'left' : 'right'}`).join(', ')}; ${cuts.cuts.length} cuts, 0 flags`);
  return { receipt, shots, scene, before };
}
const undo = (f, receipt, before) => {
  assert.equal(f.run('edit.undo', { receiptId: receipt.receiptId }, 'agent').status, 'undone');
  assert.deepEqual(f.snapshot(), before, 'one undo restores the document');
};

test('triangle-dialogue: a three-shot master, then OTS and singles for each pair, each pair on its own side', () => {
  const f = fixtureFor(TRIO);
  try {
    load(f);
    const rows = coveragePattern('triangle-dialogue').shots(3);
    const { receipt, shots, before } = lay(f, { pattern: 'triangle-dialogue', cast: ['actor-mara', 'actor-joon', 'actor-sela'], shotId: 'shot-a' },
      { count: 13, ranges: splitRange({ startFrame: 0, endFrame: 311 }, 13).map(row => [row.startFrame, row.endFrame]), stacks: i => rows[i].stack.map(row => row.id) });
    assert.equal(shots[0].name, 'TRI 1 · Master');
    assert.deepEqual(receipt.output.lines.map(row => row.between.length), [2, 2, 2], 'three pair lines');
    const pairs = new Set(shots.filter(row => row.line).map(row => [...row.line.between].sort().join('|')));
    assert.equal(pairs.size, 3, 'each speaking pair covered');
    for (const shot of shots.filter(row => row.coverage.role === 'OTS')) {
      const over = currentTechnique(shot).stack[0].params.over;
      assert.ok(shot.line.between.includes(over) && over !== shot.coverage.subjectId, `${shot.name}: over the other member of its pair`);
    }
    const reloaded = readShotAuthoring(serializeShotAuthoring({ shots: f.live.current.shots, frameCount: 400 })).state.shots;
    assert.deepEqual(reloaded.map(row => row.line ?? null), f.live.current.shots.map(row => row.line ?? null), 'the authored lines survive save and reload');
    undo(f, receipt, before);
  } finally { f.dispose(); }
});

test('group-singles: a wide, then a single of each member from inside the group (three and six)', () => {
  for (const [people, end] of [[TRIO, 191], [SIX, 335]]) {
    const f = fixtureFor(people);
    try {
      load(f, [seed(0, end)]);
      const cast = people.map(row => row.id), n = people.length;
      const { receipt, shots, scene, before } = lay(f, { pattern: 'group-singles', cast, shotId: 'shot-a' },
        { count: n + 1, ranges: splitRange({ startFrame: 0, endFrame: end }, n + 1).map(row => [row.startFrame, row.endFrame]), stacks: i => (i ? ['medium-close-up', 'head-on-shot'] : ['master-shot']) });
      assert.deepEqual(new Set(shots.slice(1).map(row => row.coverage.subjectId)), new Set(cast), 'a single of every member');
      const centre = { x: scene.cast.reduce((s, r) => s + r.x, 0) / n, z: scene.cast.reduce((s, r) => s + r.z, 0) / n };
      for (const shot of shots.slice(1)) {
        const member = scene.cast.find(row => row.id === shot.coverage.subjectId), camera = shotCameraAt(shot, shot.startFrame, scene).pos;
        assert.ok(Math.hypot(camera.x - centre.x, camera.z - centre.z) < Math.hypot(member.x - centre.x, member.z - centre.z), `${shot.name}: the camera stands inside the group`);
      }
      undo(f, receipt, before);
    } finally { f.dispose(); }
  }
});

test('branching-dialogue: one set of setups laid once and reused across three branch ranges', () => {
  for (const [people, cast] of [[TRIO.slice(0, 2), ['actor-mara', 'actor-joon']], [TRIO, ['actor-mara', 'actor-joon', 'actor-sela']]]) {
    const f = fixtureFor(people);
    try {
      load(f, [seed(0, 359)]);
      const k = cast.length, branches = [{ startFrame: 0, endFrameExclusive: 96 }, { startFrame: 120, endFrameExclusive: 216 }, { startFrame: 240, endFrameExclusive: 336 }];
      const ranges = branches.flatMap(row => splitRange({ startFrame: row.startFrame, endFrame: row.endFrameExclusive - 1 }, k + 1).map(r => [r.startFrame, r.endFrame]));
      const { receipt, shots, scene, before } = lay(f, { pattern: 'branching-dialogue', cast, shotId: 'shot-a', branches }, { count: 3 * (k + 1), ranges, seams: true, stacks: i => (i % (k + 1) ? (k === 2 ? ['medium-close-up'] : ['medium-close-up', 'head-on-shot']) : ['master-shot']) });
      assert.deepEqual(receipt.output.branches, branches.map(row => ({ startFrame: row.startFrame, endFrame: row.endFrameExclusive - 1 })));
      assert.deepEqual(shotsOf(f).filter(row => !row.coverage).map(row => [row.startFrame, row.endFrame]), [[96, 119], [216, 239], [336, 359]], 'the frames between branches keep their own shots');
      for (const setup of new Set(shots.map(row => row.coverage.setup))) {
        const same = shots.filter(row => row.coverage.setup === setup);
        assert.deepEqual(same.map(row => row.coverage.branch), [0, 1, 2], `${setup}: in every branch`);
        const poses = same.map(row => shotCameraAt(row, row.startFrame, scene));
        for (const pose of poses) assert.ok(Math.hypot(pose.pos.x - poses[0].pos.x, pose.pos.y - poses[0].pos.y, pose.pos.z - poses[0].pos.z) < 1e-6 && Math.abs(pose.fovDeg - poses[0].fovDeg) < 1e-6, `${setup}: the same camera in every branch`);
      }
      undo(f, receipt, before);
      load(f, [seed(0, 359)]);
      const counted = f.run('camera.cover', { request: 'branching dialogue, three branches', cast, shotId: 'shot-a' }, 'agent');
      assert.equal(counted.ok, true, JSON.stringify(counted).slice(0, 400));
      assert.equal(counted.output.branches.length, 3, 'words: three branches');
      assert.equal(counted.checks.shots, 3 * (k + 1));
    } finally { f.dispose(); }
  }
});

test('refusals: too few people, too many, and a two-person pattern still takes two', () => {
  const f = fixtureFor(TRIO.slice(0, 2));
  try {
    load(f);
    assert.equal(f.run('camera.cover', { pattern: 'triangle-dialogue', shotId: 'shot-a' }, 'agent').code, 'TARGET_NOT_READY', 'a triangle needs three');
  } finally { f.dispose(); }
  const g = fixtureFor(SIX);
  try {
    load(g);
    assert.equal(g.run('camera.cover', { pattern: 'triangle-dialogue', cast: SIX.slice(0, 4).map(row => row.id), shotId: 'shot-a' }, 'agent').code, 'INVALID_ARGUMENT', 'a triangle takes three');
    const srs = g.run('camera.cover', { pattern: 'shot-reverse-shot', cast: ['actor-mara', 'actor-joon', 'actor-sela'], shotId: 'shot-a' }, 'agent');
    assert.equal(srs.ok, true, JSON.stringify(srs).slice(0, 300));
    assert.deepEqual(srs.output.subjects, ['actor-mara', 'actor-joon'], 'a two-person pattern covers the first two');
    assert.ok(shotsOf(g).every(row => !row.line), 'two-person patterns author no line (their output is unchanged)');
  } finally { g.dispose(); }
});

test('camera.setLine stores the line a shot keeps, the cut check judges by it and names it, and one undo clears it', () => {
  const f = fixtureFor(TRIO);
  try {
    load(f, [seed(0, 95), { ...createShot('Next', 96, 191, [{ id: 'key-b', frame: 96, framing }]), id: 'shot-b' }]);
    const before = f.snapshot();
    const set = f.run('camera.setLine', { request: 'keep the line between Mara and Joon', all: true }, 'agent');
    assert.equal(set.ok, true, JSON.stringify(set).slice(0, 400));
    assert.ok(set.undo?.historyEntryId, 'one undo entry');
    const first = f.snapshot();
    assert.equal(f.run('edit.undo', { receiptId: set.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), before, 'one undo restores the document');
    assert.equal(f.run('camera.setLine', { request: 'keep the line between Mara and Joon', all: true }, 'agent').ok, true);
    assert.deepEqual(f.snapshot().shot ?? f.snapshot(), first.shot ?? first, 'set again');
    assert.deepEqual(shotsOf(f).map(row => row.line), [{ between: ['actor-mara', 'actor-joon'] }, { between: ['actor-mara', 'actor-joon'] }]);
    assert.deepEqual([set.output.matched, set.output.confidence], [['keep', 'line'], 'high']);
    assert.match(set.summary, /^The Mara–Joon line on 2 shots/);
    const cut = f.run('camera.checkCuts', {}, 'agent').output.cuts[0];
    assert.deepEqual([cut.measures.line.label, cut.measures.line.source, cut.measures.line.pair], ['Mara–Joon', 'authored', ['actor-mara', 'actor-joon']], JSON.stringify(cut.measures));
    const viaTechnique = f.run('camera.applyTechnique', { request: 'keep the line between Joon and Sela', shotId: 'shot-b' }, 'agent');
    assert.equal(viaTechnique.ok, true, JSON.stringify(viaTechnique).slice(0, 300));
    assert.deepEqual(shotsOf(f).find(row => row.id === 'shot-b').line, { between: ['actor-joon', 'actor-sela'] }, 'routed from camera.applyTechnique, on the shot named');
    const change = f.run('camera.checkCuts', {}, 'agent').output.cuts[0];
    assert.deepEqual(change.measures.line, { pair: null, change: ['Mara–Joon', 'Joon–Sela'] }, 'two authored pairs: a line change');
    assert.equal(f.run('camera.setLine', { between: ['actor-mara'], shotId: 'shot-a' }, 'agent').code, 'INVALID_ARGUMENT', 'a line needs two people');
    assert.equal(f.run('camera.setLine', { between: ['actor-mara', 'actor-nobody'], shotId: 'shot-a' }, 'agent').code, 'STALE_TARGET');
    assert.equal(f.run('camera.setLine', { between: [], shotId: 'shot-a' }, 'agent').ok, true);
    assert.equal(shotsOf(f)[0].line, undefined, '[] clears it');
    console.log(`PASS setLine: ${set.summary}`);
  } finally { f.dispose(); }
});

test('coverage laid over a shot with an authored line clears that line unless the new pattern sets one; undo restores it', () => {
  const f = fixtureFor(TRIO);
  try {
    load(f, [seed(0, 1299)], 1400);
    assert.equal(f.run('camera.cover', { pattern: 'triangle-dialogue', cast: TRIO.map(row => row.id), shotId: 'shot-a' }, 'agent').ok, true);
    const old = shotsOf(f).find(row => row.coverage?.role !== 'Master' && row.line), pair = old.line.between;
    const third = TRIO.find(row => !pair.includes(row.id)).id, before = f.snapshot();
    const receipt = f.run('camera.cover', { pattern: 'master-coverage', cast: [third, pair[0]], shotId: old.id }, 'agent');
    assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 400));
    const laid = shotsOf(f).filter(row => row.startFrame >= old.startFrame && row.endFrame <= old.endFrame);
    assert.ok(laid.length >= 2 && laid.every(row => row.coverage?.pattern === 'master-coverage'), laid.map(row => row.name).join());
    assert.deepEqual(laid.map(row => row.line), laid.map(() => undefined), 'no shot keeps the old pair\'s line');
    const cuts = f.run('camera.checkCuts', {}, 'agent').output.cuts.filter(cut => laid.some(row => row.id === cut.to) && laid.some(row => row.id === cut.from));
    assert.ok(cuts.length && cuts.every(cut => cut.measures.line?.source !== 'authored'), JSON.stringify(cuts.map(cut => cut.measures.line)));
    assert.equal(f.run('edit.undo', { receiptId: receipt.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), before, 'one undo restores the triangle shot and its line');
    assert.deepEqual(shotsOf(f).find(row => row.id === old.id).line, old.line);
    console.log(`PASS replaced line: ${old.name} (${pair.join('-')}) -> ${laid.length} master-coverage shots with no line`);
  } finally { f.dispose(); }
});
