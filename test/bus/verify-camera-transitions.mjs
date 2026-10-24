// A4: transitions on a cut. camera.setTransition stores the transition on the
// incoming shot (one undo entry, survives save and reload, a plain cut stores
// nothing); OTIO writes a Transition.1 where OTIO has one (a dissolve as
// SMPTE_Dissolve, fades and the whip as Custom_Transition) and the clip
// metadata always carries it (match, J and L cuts there only); the prompt and
// the keyframe pack's prompt.txt state it; and the shot camera preview's lens
// plan blends the two cameras (or falls to black) across the window.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { shotsToOtio } from '../../src/otio.js';
import { readShotAuthoring, serializeShotAuthoring } from '../../src/shot-authoring.js';
import { shotCaptureMeta } from '../../src/shot-meta.js';
import { buildShotPrompt } from '../../src/shot-prompt.js';
import { keyframePackEntries } from '../../src/keyframe-pack.js';
import { transitionAt } from '../../src/camera-coverage/transitions.js';
import { withShotTransition, withTransition } from '../../src/shot-camera-apply.js';
import { lensPlan } from '../../src/camera-capabilities/lens-plan.js';
import { cameraMoveAt } from '../../src/camera-move.js';
import { sampleAt } from '../../src/sample-at.js';

const other = { pos: { x: 3, y: 1.6, z: 4 }, yaw: 0.6, pitch: 0, fovDeg: 30 };
const seed = () => [{ ...createShot('One', 0, 47, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' }, { ...createShot('Two', 48, 95, [{ id: 'key-b', frame: 48, framing: other }]), id: 'shot-b' }];
const shotOf = (f, id) => f.live.current.shots.find(row => row.id === id);
const load = f => { f.shots.load({ shots: seed(), frameCount: 120, camera: f.actual.readStudioState().camera }); f.live.current.timeline.currentFrame = 60; };

test('camera.setTransition stores, undoes, reloads and clears the transition into a shot', () => {
  const f = shotsFixture();
  try {
    load(f);
    const before = f.snapshot();
    const set = f.run('camera.setTransition', { cutFrame: 48, type: 'dissolve', frames: 12 }, 'agent');
    assert.equal(set.ok, true, JSON.stringify(set).slice(0, 300));
    assert.ok(set.undo?.historyEntryId, 'one undo entry');
    assert.deepEqual(shotOf(f, 'shot-b').transition, { type: 'dissolve', frames: 12 });
    assert.match(set.summary, /a 12-frame dissolve from the previous shot \(0\.5s\)/);
    const reloaded = readShotAuthoring(serializeShotAuthoring({ shots: f.live.current.shots, frameCount: 120 })).state.shots;
    assert.deepEqual(reloaded.find(row => row.id === 'shot-b').transition, { type: 'dissolve', frames: 12 }, 'survives save and reload');
    assert.equal(reloaded.find(row => row.id === 'shot-a').transition, undefined, 'absent where none was set');
    assert.equal(f.run('edit.undo', { receiptId: set.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), before, 'one undo restores the shots');
    assert.equal(f.run('camera.setTransition', { shotId: 'shot-b', type: 'l-cut', offsetFrames: 8, note: 'her line runs over his look' }, 'agent').ok, true);
    assert.deepEqual(shotOf(f, 'shot-b').transition, { type: 'l-cut', offsetFrames: 8, note: 'her line runs over his look' });
    assert.equal(f.run('camera.setTransition', { shotId: 'shot-b', type: 'cut' }, 'agent').ok, true);
    assert.equal(shotOf(f, 'shot-b').transition, undefined, 'a plain cut stores nothing');
    const first = f.run('camera.setTransition', { shotId: 'shot-a', type: 'dissolve' }, 'agent');
    assert.ok(first.warnings.some(row => row.code === 'NO_PREVIOUS_SHOT'), 'a dissolve into the first shot is flagged');
  } finally { f.dispose(); }
});

test('OTIO writes a transition where it has one and metadata always; the prompt and prompt.txt state it', () => {
  const scene = { frameCount: 120, filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 }, characters: [] };
  const withType = transition => seed().map(row => (row.id === 'shot-b' ? { ...row, transition } : row));
  const track = shots => shotsToOtio(scene, shots).tracks.children[0].children;
  const dissolve = track(withType({ type: 'dissolve', frames: 12 }));
  assert.deepEqual(dissolve.map(row => row.OTIO_SCHEMA), ['Clip.1', 'Transition.1', 'Clip.1']);
  assert.equal(dissolve[1].transition_type, 'SMPTE_Dissolve');
  assert.deepEqual([dissolve[1].in_offset.value, dissolve[1].out_offset.value, dissolve[1].in_offset.rate], [6, 6, 24]);
  assert.deepEqual(dissolve[2].metadata.cozyclay.transitionIn, { type: 'dissolve', frames: 12 });
  const fade = track(withType({ type: 'fade-to-black', frames: 10 }));
  assert.equal(fade[1].transition_type, 'Custom_Transition');
  assert.deepEqual([fade[1].in_offset.value, fade[1].out_offset.value], [10, 0]);
  assert.equal(fade[1].metadata.cozyclay.transition.type, 'fade-to-black');
  assert.equal(track(withType({ type: 'whip' }))[1].metadata.cozyclay.transition.frames, 6);
  for (const type of ['match-cut', 'j-cut', 'l-cut']) {
    const rows = track(withType({ type }));
    assert.deepEqual(rows.map(row => row.OTIO_SCHEMA), ['Clip.1', 'Clip.1'], `${type}: a picture cut, no Transition item`);
    assert.equal(rows[1].metadata.cozyclay.transitionIn.type, type, `${type}: in the clip metadata`);
  }
  assert.ok(!JSON.stringify(shotsToOtio(scene, seed())).includes('Transition'), 'no transition, no Transition item (older exports unchanged)');

  const shot = withType({ type: 'dissolve', frames: 12 })[1], meta = shotCaptureMeta({ shot, fps: 24 });
  assert.match(buildShotPrompt(meta), /^TRANSITION: a 12-frame dissolve from the previous shot \(0\.5s\)$/m);
  assert.match(buildShotPrompt(shotCaptureMeta({ shot: { ...shot, transition: { type: 'j-cut', offsetFrames: 12 } }, fps: 24 })), /TRANSITION: a J-cut: this shot's sound starts 12 frames \(0\.5s\) before its picture/);
  assert.ok(!/TRANSITION/.test(buildShotPrompt(shotCaptureMeta({ shot: seed()[1], fps: 24 }))), 'no line without a transition');
  const entries = keyframePackEntries({ shot: { title: 'Two', index: 2, startFrame: 48, endFrame: 95 }, fps: 24, firstFramePng: new Uint8Array(1), lastFramePng: null, clip: null, camera: meta, prompt: buildShotPrompt(meta, { target: 'video' }) });
  assert.match(entries.find(entry => entry.name.endsWith('/prompt.txt')).data, /TRANSITION: a 12-frame dissolve/);
});

test('the preview blends the two cameras across a dissolve and falls to black across a fade', () => {
  const shots = seed().map(row => (row.id === 'shot-b' ? { ...row, transition: { type: 'dissolve', frames: 12 } } : row));
  const windowed = Array.from({ length: 16 }, (_, i) => 40 + i).map(frame => [frame, transitionAt(shots, frame)]);
  assert.deepEqual(windowed.filter(([, at]) => at).map(([frame]) => frame), [42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53], 'twelve frames centred on the cut');
  for (const [, at] of windowed.filter(([, row]) => row)) assert.ok(Math.abs(at.selfWeight + at.otherWeight - 1) < 1e-9, 'a dissolve keeps full exposure');
  const mid = transitionAt(shots, 48);
  assert.equal(mid.other.shot.id, 'shot-a');
  assert.equal(mid.other.frame, 47, 'the outgoing camera holds its last frame');
  assert.ok(Math.abs(mid.selfWeight - 13 / 24) < 1e-9, `the incoming picture just past half at the cut (${mid.selfWeight})`);
  const sample = shot => ({ ...cameraMoveAt(shot.cameraKeys, { x: 0, z: 0 }, 0), focalMm: 35 });
  const camera = withTransition(sample(shots[1]), { shots, frame: 48, sampleShot: target => sample(target) });
  assert.deepEqual(camera.transition.other.pos, framing.pos, 'the far camera is shot One');
  const plan = lensPlan(camera);
  assert.equal(plan.samples.length, 2);
  assert.deepEqual(plan.samples.map(row => Math.round(row.weight * 1000) / 1000), [0.542, 0.458]);
  assert.deepEqual(plan.samples[1].pose.pos, framing.pos);
  assert.equal(withTransition(sample(shots[1]), { shots, frame: 60, sampleShot: sample }).transition, undefined, 'outside the window the camera is untouched');
  assert.equal(lensPlan(sample(shots[1])), null, 'and draws plainly');
  const faded = seed().map(row => (row.id === 'shot-b' ? { ...row, transition: { type: 'fade-to-black', frames: 8 } } : row));
  const fadePlan = lensPlan(withTransition(sample(faded[0]), { shots: faded, frame: 46, sampleShot: sample }));
  assert.deepEqual(fadePlan.samples.map(row => row.weight), [1 - 6.5 / 8], 'one camera, the rest black');
  const blurred = lensPlan({ ...camera, blur: [framing, framing] }, { samples: 4 });
  assert.ok(Math.abs(blurred.samples.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-9 && blurred.samples.length === 5, 'with motion blur the own samples share the incoming weight');
});

test('review #5: a fade from black opens the first shot; a fade to black ends the last one', () => {
  const single = [{ ...createShot('Only', 0, 47, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a', transition: { type: 'fade-from-black', frames: 8 } }];
  assert.ok(Math.abs(transitionAt(single, 0).selfWeight - 0.5 / 8) < 1e-9, 'the opening shot of a one-shot timeline fades in from black');
  assert.equal(transitionAt(single, 8), null, 'and is at full brightness after its frames');
  const sample = shot => ({ ...cameraMoveAt(shot.cameraKeys, { x: 0, z: 0 }, 0), focalMm: 35 });
  assert.deepEqual(lensPlan(withTransition(sample(single[0]), { shots: single, frame: 3, sampleShot: sample })).samples.map(row => row.weight), [3.5 / 8], 'the preview draws it as one camera over black');
  const gapped = [seed()[0], { ...seed()[1], startFrame: 60, endFrame: 95, cameraKeys: [{ id: 'key-b', frame: 60, framing: other }], transition: { type: 'fade-from-black', frames: 6 } }];
  assert.ok(transitionAt(gapped, 60)?.selfWeight < 0.1, 'a shot after a gap opens from black too');
  const ending = seed().map(row => (row.id === 'shot-b' ? { ...row, transitionOut: { type: 'fade-to-black', frames: 12 } } : row));
  assert.ok(Math.abs(transitionAt(ending, 95).selfWeight - 0.5 / 12) < 1e-9, 'the last shot ends on black');
  assert.equal(transitionAt(ending, 83), null);
  const f = shotsFixture();
  try {
    load(f);
    const set = f.run('camera.setTransition', { shotId: 'shot-b', type: 'fade-to-black', edge: 'out', frames: 12 }, 'agent');
    assert.equal(set.ok, true, JSON.stringify(set).slice(0, 300));
    assert.deepEqual(shotOf(f, 'shot-b').transitionOut, { type: 'fade-to-black', frames: 12 });
    assert.match(set.summary, /fades to black over its last 12 frames/);
    const refused = f.run('camera.setTransition', { shotId: 'shot-a', type: 'fade-to-black', edge: 'out' }, 'agent');
    assert.equal(refused.code, 'INVALID_ARGUMENT', 'a shot another cuts out of fades on that cut instead');
    const reloaded = readShotAuthoring(serializeShotAuthoring({ shots: f.live.current.shots, frameCount: 120 })).state.shots;
    assert.deepEqual(reloaded.find(row => row.id === 'shot-b').transitionOut, { type: 'fade-to-black', frames: 12 }, 'survives save and reload');
    const scene = { frameCount: 120, filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 }, characters: [] };
    assert.deepEqual(shotsToOtio(scene, f.live.current.shots).tracks.children[0].children.at(-1).metadata.cozyclay.transitionOut, { type: 'fade-to-black', frames: 12 });
    assert.match(buildShotPrompt(shotCaptureMeta({ shot: shotOf(f, 'shot-b'), fps: 24 })), /TRANSITION: this shot fades to black over its last 12 frames/);
    assert.equal(f.run('camera.setTransition', { shotId: 'shot-b', type: 'cut', edge: 'out' }, 'agent').ok, true);
    assert.equal(shotOf(f, 'shot-b').transitionOut, undefined, 'cut clears it');
  } finally { f.dispose(); }
});

test('review #5: a dissolve between a keyed shot and a rail shot blends two cameras both ways', () => {
  const railPose = { pos: { x: -3, y: 1.5, z: 2 }, yaw: -0.9, pitch: 0, fovDeg: 30 };
  const rail = { ...createShot('Rail', 48, 95), id: 'shot-b', camera: { mode: 'rail', cameraRail: [{ x: -3, z: 2 }, { x: -3, z: -2 }], railFollow: { mode: 'range', startFrame: 0, endFrame: 47 }, craneHeight: { points: [{ t: 0, height: 1.5 }, { t: 1, height: 1.5 }] } }, cameraKeys: [] };
  const keyed = { ...createShot('Keys', 0, 47, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' };
  // The playback scene carries the rail's camera track (useShotCameraTracks), timeline-indexed.
  const scene = { frameCount: 120, subject: { x: 0, z: 0 }, cameraTrack: Array.from({ length: 120 }, () => ({ ...railPose, pos: { ...railPose.pos } })), filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 } };
  for (const [label, shots] of [['keyed into rail', [keyed, { ...rail, transition: { type: 'dissolve', frames: 12 } }]],
    ['rail into keyed', [{ ...rail, startFrame: 0, endFrame: 47 }, { ...keyed, startFrame: 48, endFrame: 95, cameraKeys: [{ id: 'key-a', frame: 48, framing }], transition: { type: 'dissolve', frames: 12 } }]]]) {
    for (const frame of [45, 50]) {
      const own = sampleAt(scene, shots.find(row => frame >= row.startFrame && frame <= row.endFrame), frame).camera;
      assert.ok(own, `${label} @${frame}: the shot's own camera samples`);
      const blended = withShotTransition(own, scene, shots, frame);
      assert.ok(blended.transition?.other?.pos, `${label} @${frame}: the far camera samples too (not null): ${JSON.stringify(blended.transition)}`);
      assert.ok(Math.abs(blended.transition.selfWeight + blended.transition.otherWeight - 1) < 1e-9, `${label} @${frame}: full exposure, not a fade toward black`);
      const poses = lensPlan(blended).samples.map(row => row.pose.pos.x);
      assert.equal(poses.length, 2, `${label} @${frame}: two sub-renders`);
      assert.ok(poses.includes(railPose.pos.x) && poses.includes(framing.pos.x), `${label} @${frame}: one from the rail, one from the keys`);
    }
  }
});
