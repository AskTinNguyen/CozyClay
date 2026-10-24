// shot-prompt-engine A3: the brief marks story beats from the cast's motion,
// read from the motion compiler's report (timeline, observations) and the baked
// take, never by editing the frozen files. Two takes with known actions:
//   Mara: stands, walks four steps of 14 frames from f10 (vary 0: the walk lifts
//         its first foot at f10 + 16 and is down at f10 + 16 + 4 x 14), turns
//         90 degrees left between keys at f110 and f130, jumps on keys (down at
//         f154, up at f160, landing by f166)
//   Joon: the cup scene's reach: grabs the cup at f34 and lets go at f80
// Each beat must land within +-2 frames, and the brief names each one with its
// frame in the beat (shot) that holds it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSpec } from '../../src/motion3/pipeline.js';
import { motionScene } from '../../src/motion3/scene.js';
import { skeletonFor } from '../../src/motion3/rigs/index.js';
import { bakeTake } from '../../src/motion3/take.js';
import { SCENE_OBJECTS, CUP } from '../motion3/fixtures/cup-scene.mjs';
import { motionBeats } from '../../src/shot-prompt-engine/motion-beats.js';
import { motionEntry, sequenceDocument } from '../../src/shot-prompt-engine/document.js';
import { buildSequencePrompt, timecode } from '../../src/shot-prompt-engine/sequence.js';
import { createShot } from '../../src/cuts.js';

const sk = skeletonFor('y-bot-tpose');
const L = [0.1, 0.105, 1.47], R = [-0.1, 0.105, 1.47], up = (p, h) => [p[0], p[1] + h, p[2]];
const WALK = { f0: 10, steps: 4, period: 14 };
const walkerSpec = { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 200,
  use: [{ skill: 'standIdle', f0: 0, args: { at: [0, 0], heading: 0 } }, { skill: 'walkTo', f0: WALK.f0, args: { heading: 0, steps: WALK.steps, period: WALK.period, vary: 0 } }],
  keys: [{ f: 110, set: { yaw: 0 } }, { f: 130, set: { yaw: 90 } },
    { f: 150, set: { root: [0, 0.98, 1.47], foot_l: L, foot_r: R } }, { f: 154, set: { root: [0, 0.85, 1.47], foot_l: L, foot_r: R } },
    { f: 160, set: { root: [0, 1.3, 1.47], foot_l: up(L, 0.35), foot_r: up(R, 0.35) } },
    { f: 166, set: { root: [0, 0.85, 1.47], foot_l: L, foot_r: R } }, { f: 172, set: { root: [0, 0.98, 1.47], foot_l: L, foot_r: R } }] };
// The cup reach of test/motion3/verify-motion3-grab.mjs: fingers to the handle, grab at 34, release at 80.
const cupSpec = { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 100,
  use: [{ skill: 'standIdle', args: { at: [0.15, 0.3], heading: 0 }, f0: 0 }],
  props: { grip: { hand: 'l', origin: ['LeftHandIndex2', 'LeftHandMiddle2'], points: { fingers: [0, 0, 0] } } },
  anchors: { cupHandle: { kind: 'object', object: 'cube-6', local: [0, 0.03, 0] } },
  fits: [{ side: 'l', anchor: 'cupHandle', effector: { prop: 'grip', point: 'fingers' } }],
  keys: [{ f: 10, set: { pitch: 0, armw_l: 0, w_cupHandle_l: 0 } }, { f: 30, set: { pitch: 25, armw_l: 1, w_cupHandle_l: 1, hand_l: [0.3, 1, 0.7] } },
    { f: 36, set: { w_cupHandle_l: 1, pitch: 25, hand_l: [0.3, 1, 0.7] } }, { f: 60, set: { w_cupHandle_l: 0, pitch: 10, hand_l: [0.3, 1.2, 0.6] } }, { f: 99, set: {} }],
  objects: { [CUP.group]: { prop: 'grip', grab: 34, release: 80 } } };

function take(character, spec, objects = []) {
  const compiled = compileSpec(spec, { sk, scene: motionScene(objects) }, { lenient: true });
  const baked = { ...bakeTake(sk, compiled.out, { position: [0, 0, 0], yaw: 0 }), spec };
  return motionEntry(character, baked, compiled);
}
const within = (beats, kind, frame, label) => {
  const found = beats.filter((beat) => beat.kind === kind);
  assert.ok(found.some((beat) => Math.abs(beat.frame - frame) <= 2), `${label}: ${kind} near f${frame}, got ${found.map((beat) => `f${beat.frame}`).join(', ') || 'none'}`);
  return found.find((beat) => Math.abs(beat.frame - frame) <= 2);
};

test('beats from the motion report land within two frames of the known actions', () => {
  const mara = take({ id: 'actor-a', subject: 'Mara, a woman in a red raincoat' }, walkerSpec), joon = take({ id: 'actor-b', subject: 'Joon' }, cupSpec, SCENE_OBJECTS);
  const beats = motionBeats(mara), cup = motionBeats(joon);
  const lift = WALK.f0 + 16, down = WALK.f0 + 16 + WALK.steps * WALK.period;
  const rows = [within(beats, 'walk-start', lift, 'Mara'), within(beats, 'walk-end', down, 'Mara'), within(beats, 'turn', 110, 'Mara'), within(beats, 'jump', 155, 'Mara'), within(beats, 'land', 166, 'Mara'),
    within(cup, 'grab', 34, 'Joon'), within(cup, 'release', 80, 'Joon')];
  assert.match(beats.find((beat) => beat.kind === 'turn').words, /^Mara turns (8\d|9\d)° to the left \(until f1[23]\d\)$/, 'a 90-degree left turn');
  assert.equal(beats.filter((beat) => beat.kind === 'turn').length, 1, 'the walk\'s hip sway is not a turn');
  assert.equal(cup.find((beat) => beat.kind === 'grab').words, 'Joon grabs empty-2');
  assert.deepEqual(motionBeats({ ...mara, startFrame: 24 }).map((beat) => beat.frame), beats.map((beat) => beat.frame + 24), 'a take placed later shifts its beats');
  console.log(`PASS A3 motion beats: ${rows.map((beat) => `${beat.kind} f${beat.frame}`).join(', ')}`);
});

test('the brief names each motion beat with its frame inside the shot that holds it', () => {
  const mara = take({ id: 'actor-a', subject: 'Mara, a woman in a red raincoat' }, walkerSpec);
  const framing = { pos: { x: 3, y: 1.6, z: 1 }, yaw: 1.2, pitch: 0, fovDeg: 40 };
  const shots = [[0, 59], [60, 139], [140, 199]].map(([a, b], i) => ({ ...createShot(`S${i + 1}`, a, b, [{ id: `k${i}`, frame: a, framing }]), id: `s${i + 1}` }));
  const document = sequenceDocument({ title: 'Walk', shots, characters: [{ id: 'actor-a', subject: 'Mara, a woman in a red raincoat', model: 'y-bot-tpose', x: 0, z: 0, rot: 0 }], fps: 24, aspect: '16:9', filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 }, frameCount: 200, motion: [mara] });
  const out = buildSequencePrompt(document), text = out.text;
  for (const beat of motionBeats(mara)) {
    const line = `   Action ${timecode(beat.frame, 24)} (f${beat.frame}): ${beat.words}.`;
    assert.ok(text.includes(line), `the brief carries ${line}`);
    const shot = shots.findIndex((row) => beat.frame >= row.startFrame && beat.frame <= row.endFrame), head = text.indexOf(`${shot + 1}. `), next = shot + 1 < shots.length ? text.indexOf(`${shot + 2}. `) : text.length;
    assert.ok(text.indexOf(line) > head && text.indexOf(line) < next, `${beat.kind} f${beat.frame} sits in beat ${shot + 1}`);
  }
  assert.equal(buildSequencePrompt(document).text, text, 'the same take gives the same bytes');
  console.log(`PASS A3 brief actions: ${text.split('\n').filter((line) => line.startsWith('   Action ')).map((line) => line.trim()).join(' | ')}`);
});

test('review: a shot with a speed plays the beats of its take at the retimed timeline frame (0.5 and 2)', () => {
  const joon = take({ id: 'actor-b', subject: 'Joon' }, cupSpec, SCENE_OBJECTS);
  const framing = { pos: { x: 0.2, y: 1.4, z: 3 }, yaw: 0, pitch: 0, fovDeg: 40 };
  const briefAt = (speed, end) => buildSequencePrompt(sequenceDocument({ title: 'Cup', fps: 24, aspect: '16:9', filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 }, frameCount: 200,
    characters: [{ id: 'actor-b', subject: 'Joon', model: 'y-bot-tpose', x: 0, z: 0, rot: 0 }], motion: [joon],
    shots: [{ ...createShot('Slow', 0, end, [{ id: 'k', frame: 0, framing }], { mode: 'keys', speed }), id: 's1' }] })).text;
  const slow = briefAt(0.5, 99), fast = briefAt(2, 49);
  // At half speed frames 0-99 show take frames 0-49: the grab (take f34) plays at f68, the release (take f80) is never shown.
  assert.match(slow, /^ {3}Action 00:00:02:20 \(f68, take f34\): Joon grabs empty-2\.$/m, slow.split('\n').filter((line) => line.includes('Action')).join(' | '));
  assert.ok(!/lets go of empty-2/.test(slow), 'the release past the slowed window is left out');
  // At double speed frames 0-49 show take frames 0-99: grab at f17, release (take f80) at f40, both played.
  assert.match(fast, /^ {3}Action 00:00:00:17 \(f17, take f34\): Joon grabs empty-2\.$/m);
  assert.match(fast, /^ {3}Action 00:00:01:16 \(f40, take f80\): Joon lets go of empty-2\.$/m, fast.split('\n').filter((line) => line.includes('Action')).join(' | '));
  console.log(`PASS A3 review speed: ${[slow, fast].map((text) => text.split('\n').filter((line) => line.includes('Action')).map((line) => line.trim()).join(' ; ')).join(' | ')}`);
});
