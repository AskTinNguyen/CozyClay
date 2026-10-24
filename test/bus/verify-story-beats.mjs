// camera-motivation A1: story beats. A beat is { frame, label, kind } (kind one
// of disclosure, reveal, threat, decision, input, event). story.addBeat,
// story.moveBeat and story.removeBeat each make one undo entry; the beats
// persist on the shot document (absent while there are none, so an older body
// reads and writes back byte-identical), are written to OTIO as markers on the
// Shots track, and the sequence brief names them in the beats they fall in.
// (The timeline drawing is checked in test/verify-camera-motivation-browser.mjs.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture, seedShot } from './shots-fixture.mjs';
import { coveredSequence, documentOf } from './sequence-fixture.mjs';
import { createShotAuthoringDocument, readShotAuthoring, serializeShotAuthoring } from '../../src/shot-authoring.js';
import { shotsToOtio } from '../../src/otio.js';
import { buildSequencePrompt } from '../../src/shot-prompt-engine/sequence.js';
import { repairStoryBeats, STORY_BEAT_KINDS } from '../../src/camera-motivation/story-beats.js';

const beatsOf = f => f.shots.state().storyBeats;

test('story.addBeat, moveBeat and removeBeat each make one undo entry', () => {
  const f = shotsFixture();
  try {
    const empty = f.snapshot();
    const added = f.run('story.addBeat', { frame: 60, label: 'Mara makes her admission', kind: 'disclosure' }, 'agent');
    assert.equal(added.ok, true, JSON.stringify(added).slice(0, 400));
    assert.ok(added.undo?.historyEntryId, 'one undo entry');
    assert.deepEqual(beatsOf(f), [{ id: 'story-beat-1', frame: 60, label: 'Mara makes her admission', kind: 'disclosure' }]);
    assert.match(added.summary, /disclosure "Mara makes her admission" at f60/);
    const asked = f.run('story.addBeat', { request: "add a beat 'confession' at 30" }, 'agent');
    assert.equal(asked.ok, true, JSON.stringify(asked).slice(0, 400));
    assert.deepEqual(beatsOf(f)[0], { id: 'story-beat-2', frame: 30, label: 'confession', kind: 'disclosure' }, 'the request form: label, frame, and the kind its words imply; beats stay in frame order');
    const one = f.snapshot();
    const moved = f.run('story.moveBeat', { beat: 'confession', frame: 90 }, 'agent');
    assert.equal(moved.ok, true, JSON.stringify(moved).slice(0, 400));
    assert.ok(moved.undo?.historyEntryId);
    assert.deepEqual(beatsOf(f).map(row => [row.id, row.frame]), [['story-beat-1', 60], ['story-beat-2', 90]]);
    assert.equal(f.run('edit.undo', { receiptId: moved.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), one, 'one undo puts the beat back');
    const removed = f.run('story.removeBeat', { beat: 'story-beat-1' }, 'agent');
    assert.equal(removed.ok, true);
    assert.deepEqual(beatsOf(f).map(row => row.id), ['story-beat-2']);
    assert.equal(f.run('edit.undo', { receiptId: removed.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), one, 'one undo restores the removed beat');
    const refused = f.run('story.moveBeat', { beat: 'the letter', frame: 10 }, 'agent');
    assert.equal(refused.ok, false);
    assert.match(refused.message, /No story beat matches "the letter"; the beats are disclosure "confession" at f30, disclosure "Mara makes her admission" at f60/);
    assert.equal(f.run('story.addBeat', { frame: 500, label: 'too late' }, 'agent').code, 'INVALID_RANGE', 'a beat past the timeline is refused');
    for (const receipt of [asked, added]) assert.equal(f.run('edit.undo', { receiptId: receipt.receiptId }, 'agent').status, 'undone');
    assert.deepEqual(f.snapshot(), empty, 'undoing the adds leaves the document as it was');
    console.log(`PASS A1 actions: add (by args and by request), move, remove, one undo each; ${STORY_BEAT_KINDS.length} kinds`);
  } finally { f.dispose(); }
});

test('beats persist on the shot document; an older body reads and writes back unchanged', () => {
  const older = serializeShotAuthoring({ shots: [seedShot()], frameCount: 120 });
  assert.ok(!older.includes('storyBeats'), 'no beats, no field');
  assert.equal(serializeShotAuthoring(readShotAuthoring(older).state), older, 'an older body is a fixed point');
  assert.equal(readShotAuthoring(older).status, 'valid');
  const beats = [{ id: 'story-beat-1', frame: 40, label: 'the letter', kind: 'reveal' }, { frame: 12.4, label: '  a   threat ', kind: 'nonsense' }, { frame: 'x', label: 'bad' }, { frame: 8 }];
  const saved = serializeShotAuthoring({ shots: [seedShot()], frameCount: 120, storyBeats: beats });
  const back = readShotAuthoring(saved).state.storyBeats;
  assert.equal(back.length, 2, 'unreadable beats (no frame, no label) are dropped');
  assert.deepEqual(back.map(row => [row.frame, row.label, row.kind]), [[12, 'a threat', 'event'], [40, 'the letter', 'reveal']], 'frames rounded, labels trimmed, an unknown kind is an event, frame order');
  assert.equal(serializeShotAuthoring(readShotAuthoring(saved).state), saved, 'a body with beats is a fixed point too');
  assert.deepEqual(repairStoryBeats([{ id: 'a', frame: 400, label: 'past' }], 120)[0].frame, 119, 'a beat is clamped into the timeline');
  const f = shotsFixture();
  try {
    f.run('story.addBeat', { frame: 40, label: 'the letter', kind: 'reveal' }, 'agent');
    const document = createShotAuthoringDocument(f.shots.state());
    assert.deepEqual(document.storyBeats, [{ id: 'story-beat-1', frame: 40, label: 'the letter', kind: 'reveal' }], 'the scene snapshot carries them');
    f.shots.load(readShotAuthoring(JSON.stringify(document)).state);
    assert.deepEqual(beatsOf(f), document.storyBeats, 'and a scene load brings them back');
    f.shots.load(readShotAuthoring(older).state);
    assert.deepEqual(beatsOf(f), [], 'loading an older scene leaves none');
  } finally { f.dispose(); }
  console.log('PASS A1 storage: absent when empty, repaired, fixed points, scene snapshot and load');
});

test('OTIO writes each beat as a marker; the sequence brief names the beats', () => {
  const scene = { frameCount: 120, filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 }, characters: [] };
  const storyBeats = [{ id: 'story-beat-1', frame: 12, label: 'Mara makes her admission', kind: 'disclosure' }, { id: 'story-beat-2', frame: 20, label: 'the gun', kind: 'threat' }];
  const track = shotsToOtio({ ...scene, storyBeats }, [seedShot()]).tracks.children[0];
  assert.deepEqual(track.markers.map(row => [row.OTIO_SCHEMA, row.name, row.color, row.marked_range.start_time.value, row.marked_range.duration.value, row.marked_range.start_time.rate]),
    [['Marker.2', 'Mara makes her admission', 'PURPLE', 12, 0, 24], ['Marker.2', 'the gun', 'RED', 20, 0, 24]]);
  assert.deepEqual(track.markers[0].metadata.cozyclay.storyBeat, { id: 'story-beat-1', kind: 'disclosure', frame: 12 });
  assert.equal(track.markers[1].comment, 'threat: the gun');
  assert.deepEqual(shotsToOtio(scene, [seedShot()]).tracks.children[0].markers, [], 'no beats, no markers (older exports unchanged)');

  const { f } = coveredSequence({ push: false, roll: false, dissolve: false });
  try {
    const plain = buildSequencePrompt(documentOf(f)).text;
    assert.ok(!/^ {3}Story /m.test(plain), 'no beats, no story lines');
    for (const [frame, label, kind] of [[50, 'Mara makes her admission', 'disclosure'], [130, 'Joon decides to stay', 'decision']]) assert.equal(f.run('story.addBeat', { frame, label, kind }, 'agent').ok, true);
    const out = buildSequencePrompt(documentOf(f));
    assert.match(out.text, /^ {3}Story 00:00:02:02 \(f50\): disclosure, Mara makes her admission\.$/m, 'beat 2 (38-76) names the admission at its delivery timecode');
    assert.match(out.text, /^ {3}Story 00:00:05:10 \(f130\): decision, Joon decides to stay\.$/m, 'beat 4 (115-153) names the decision');
    assert.equal(out.text.split('\n').filter(line => line.startsWith('   Story ')).length, 2);
    assert.equal(buildSequencePrompt(structuredClone(documentOf(f))).text, out.text, 'byte-identical on a second run');
    console.log(`PASS A1 export: ${track.markers.length} OTIO markers; brief story lines: ${out.text.split('\n').filter(line => line.startsWith('   Story ')).map(line => line.trim()).join(' | ')}`);
  } finally { f.dispose(); }
});
