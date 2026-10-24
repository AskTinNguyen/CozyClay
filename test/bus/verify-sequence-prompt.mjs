// shot-prompt-engine A1: buildSequencePrompt writes one brief for a range of
// shots laid by camera.cover (master and coverage over 0-191, a push-in on the
// second shot, a dissolve into the third, a Dutch roll on the fourth). The
// brief has a header, the cast with stable descriptors, one numbered beat per
// shot with its timecodes and the camera words the classifier proved (the
// receipt's phrase, or moveSequencePhrase of the keys), the transitions, a
// closing continuity line, and the same bytes on every run. The shot-level
// prompt agrees with each beat.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coveredSequence, documentOf } from './sequence-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { buildSequencePrompt, shotsInRange, timecode } from '../../src/shot-prompt-engine/sequence.js';
import { classifyKeys } from '../../src/camera-techniques/readback.js';
import { currentTechnique } from '../../src/camera-techniques/storage.js';
import { moveSequencePhrase } from '../../src/camera-move.js';
import { shotCaptureMeta } from '../../src/shot-meta.js';
import { buildShotPrompt } from '../../src/shot-prompt.js';
import { transitionWords } from '../../src/camera-coverage/transitions.js';

test('a covered sequence becomes one brief with a beat per shot', () => {
  const { f, document } = coveredSequence();
  try {
    const shots = shotsInRange(document), out = buildSequencePrompt(document), lines = out.text.split('\n');
    assert.equal(shots.length, 5, 'master and coverage lays five shots');
    assert.match(lines[0], /^SEQUENCE: Rooftop: 5 shots, 8s at 24 fps, 16:9\.$/, lines[0]);
    assert.match(out.text, /^LOOK: night rain, sodium light, 35mm film\.$/m);
    assert.match(out.text, /^- A: Mara, a woman in a red raincoat\. The same person in every beat; the subject of beat 1, 2, 4\.$/m);
    assert.match(out.text, /^- B: Joon, a tall man in a grey suit\. The same person in every beat; the subject of beat 3, 5\.$/m);
    const heads = lines.filter((line) => /^\d+\. \d\d:\d\d:\d\d:\d\d-/.test(line));
    assert.equal(heads.length, shots.length, 'one numbered beat per shot');
    assert.equal(out.beats.length, shots.length);
    shots.forEach((shot, i) => {
      const from = timecode(shot.startFrame - shots[0].startFrame, 24), to = timecode(shot.endFrame - shots[0].startFrame, 24);
      assert.ok(heads[i].startsWith(`${i + 1}. ${from}-${to} `), `beat ${i + 1} timecodes ${from}-${to}: ${heads[i]}`);
      assert.ok(heads[i].endsWith(shot.name), `beat ${i + 1} names ${shot.name}`);
      const beat = out.beats[i], technique = currentTechnique(shot);
      // The camera words: the receipt's phrase while the stack still describes the camera, else the classifier on the keys.
      const subject = { ...document.cast.find((row) => row.id === beat.subjectId), height: 1.8 };
      const read = shot.cameraKeys.length > 1 ? classifyKeys(shot.cameraKeys, subject, { fps: 24, filmback: document.filmback }) : null;
      const moving = read ? read.segments.filter((segment) => segment.id !== 'static') : [];
      const expected = technique?.phrase ?? (moving.length > 1 ? moveSequencePhrase(moving) : read?.phrase ?? 'static, locked-off shot');
      assert.ok(out.text.includes(`   Camera: ${expected}.`), `beat ${i + 1} camera words: ${expected}`);
      if (read && read.id !== 'static') assert.ok(beat.camera.includes(read.phrase.replace(/^an? /, '')), `beat ${i + 1}: the receipt's phrase carries the classifier's move (${read.phrase})`);
      // The shot-level prompt agrees: its TECHNIQUE and TRANSITION lines say what the beat says.
      const shotPrompt = buildShotPrompt(shotCaptureMeta({ shot, fps: 24, cast: document.cast, aspectKey: '16:9' }), { target: 'video' });
      if (technique) assert.ok(shotPrompt.includes(technique.phrase) && beat.camera === technique.phrase, `beat ${i + 1} agrees with the shot prompt's TECHNIQUE line`);
      const into = transitionWords(shot.transition, 24);
      if (into) assert.ok(shotPrompt.includes(`TRANSITION: ${into}`) && out.text.includes(`   In: ${into}.`), `beat ${i + 1} transition agrees`);
      assert.match(out.beats[i].coverage, new RegExp(`^${shot.coverage.role} on (Mara|Joon) in Master and Coverage$`), `beat ${i + 1} coverage role`);
    });
    assert.match(out.text, /^ {3}In: opens the sequence\.$/m, 'the first beat opens the sequence');
    assert.match(out.text, /^ {3}In: a 12-frame dissolve from the previous shot \(0\.5s\)\.$/m, 'the dissolve into beat 3');
    assert.equal(lines.filter((line) => line === '   In: a straight cut from the previous shot.').length, 3, 'the other cuts are straight cuts');
    assert.match(out.text, /^ {3}Camera: a medium shot from the waist up; a fast push-in \(dolly in\) from a wide shot to a medium shot; 35mm lens\.$/m, 'the push-in in its receipt words');
    assert.match(out.text, /^ {3}Rig: a Dutch angle, the horizon tilted 12 degrees, falling to the right\.$/m, 'the roll capability');
    assert.match(out.text, /^ {3}Frame: .*; lens .* mm.*; (Mara|Joon) (centred|on the (left|right) third)/m, 'size, angle, lens and composition');
    const continuity = lines.find((line) => line.startsWith('CONTINUITY: '));
    assert.equal(continuity, 'CONTINUITY: Every camera stays on the left side of the Mara-Joon line (seen from Mara); Mara holds screen left and Joon screen right.');
    const again = buildSequencePrompt(structuredClone(document));
    assert.equal(again.text, out.text, 'byte-identical on a second run');
    assert.equal(Buffer.from(again.text).equals(Buffer.from(out.text)), true);
    console.log(`PASS A1 brief: ${heads.length} beats, ${out.text.length} characters; ${heads.map((line) => line.slice(0, 40)).join(' | ')}`);
  } finally { f.dispose(); }
});

test('a range picks its shots and renumbers its beats from 1', () => {
  const { f, document } = coveredSequence();
  try {
    const shots = shotsInRange(document), out = buildSequencePrompt(document, { range: { from: 2, to: 4 } });
    assert.equal(out.beats.length, 3);
    assert.deepEqual(out.beats.map((beat) => beat.id), shots.slice(1, 4).map((shot) => shot.id));
    assert.match(out.text, new RegExp(`^1\\. 00:00:00:00-${timecode(shots[1].endFrame - shots[1].startFrame, 24)} \\(`, 'm'), 'timecodes start at the range');
    assert.match(out.text, /^ {3}In: a straight cut from the previous shot\.$/m, 'a range that starts mid-sequence comes in on a cut');
    const byId = buildSequencePrompt(document, { range: { shotIds: [shots[4].id] } });
    assert.equal(byId.beats.length, 1);
    assert.match(byId.text, /^SEQUENCE: Rooftop: 1 shot, /);
    assert.equal(buildSequencePrompt({ ...document, shots: [] }).text, 'SEQUENCE: no shots in this range.');
    console.log('PASS A1 ranges: from/to and shotIds');
  } finally { f.dispose(); }
});

test('review: timecodes are delivery time, so a gap between shots does not show up in them', () => {
  const { f, document } = coveredSequence();
  try {
    const framing = { pos: { x: 2, y: 1.6, z: 5 }, yaw: 0, pitch: 0, fovDeg: 40 };
    const shots = [{ ...createShot('A', 0, 23, [{ id: 'a', frame: 0, framing }]), id: 'g1' }, { ...createShot('B', 120, 143, [{ id: 'b', frame: 120, framing }]), id: 'g2' }];
    const out = buildSequencePrompt({ ...document, shots }, { profile: 'kling-3' });
    assert.match(out.text, /^SEQUENCE: Rooftop: 2 shots, 2s at 24 fps, 16:9\.$/m, 'the header sums the shots');
    assert.match(out.text, /^Shot 1, 1s 00:00:00:00-00:00:00:23 \(0s-1s, 24 frames\) A$/m);
    assert.match(out.text, /^Shot 2, 1s 00:00:01:00-00:00:01:23 \(1s-2s, 24 frames\) B$/m, 'the second shot follows the first in the delivered video');
    assert.equal(out.seconds, 2); assert.equal(out.clips.length, 1, 'one 2 s clip');
    assert.deepEqual(out.warnings.map((row) => row.message), ['Clip of beats 1-2 runs 2s, under the 3s Kling 3.0 minimum.'], 'the limits read the same 2 s');
    console.log(`PASS A1 review delivery timecodes: ${out.text.split('\n').filter((line) => line.startsWith('Shot ')).join(' | ')}`);
  } finally { f.dispose(); }
});

// camera-motivation A7: a motivated move states its reason; an unmotivated one states none.
test('camera-motivation: the brief states why a move happens', () => {
  const { f, document } = coveredSequence({ roll: false, dissolve: false });
  try {
    const shots = shotsInRange(document), pushed = shots[1], start = pushed.cameraKeys[0].frame;
    assert.ok(!/^ {3}Motive: /m.test(buildSequencePrompt(document).text), 'the push-in with no beat states no reason');
    assert.equal(f.run('story.addBeat', { frame: start, label: 'Mara makes her admission', kind: 'disclosure' }, 'agent').ok, true);
    const out = buildSequencePrompt(documentOf(f));
    assert.match(out.text, /^ {3}Motive: the camera pushes in as Mara makes her admission\.$/m, 'beat 2 says why it pushes in');
    assert.equal(out.text.split('\n').filter((line) => line.startsWith('   Motive: ')).length, 1, 'held shots state no motive');
    const walk = coveredSequence({ pattern: 'walk-and-talk', push: false, roll: false, dissolve: false });
    try { assert.match(buildSequencePrompt(walk.document).text, /^ {3}Motive: the camera tracks with Mara\.$/m, 'a tracking two-shot travels with its subject'); } finally { walk.f.dispose(); }
    assert.equal(buildSequencePrompt(structuredClone(documentOf(f))).text, out.text, 'byte-identical on a second run');
    console.log(`PASS A7 motive: ${out.text.split('\n').find((line) => line.startsWith('   Motive: ')).trim()}`);
  } finally { f.dispose(); }
});
