// shot-prompt-engine A5: model profiles shape the brief. Per profile: its limits
// (checked against public docs on 2026-10-24, findings F-1), the warnings with
// a fix when a range breaks them (split here, trim or extend to N s, deliver
// another aspect), its phrasing (Kling's shot labels, MiniMax's bracket tags,
// Veo's one clip per beat) and the aspect carried from the project (or a
// shot), never a hardcoded one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coveredSequence } from './sequence-fixture.mjs';
import { buildSequencePrompt } from '../../src/shot-prompt-engine/sequence.js';
import { MODEL_PROFILES, profileById, profileWarnings, clipsFor } from '../../src/model-profiles.js';

const codes = (out) => out.warnings.map((row) => row.code);
const beatsOf = (lengths) => { let at = 0; return lengths.map((frames, i) => { const row = { index: i + 1, title: `S${i + 1}`, startFrame: at, endFrame: at + frames - 1 }; at += frames; return row; }); };

test('every profile carries its limits, sources and phrasing', () => {
  assert.deepEqual(MODEL_PROFILES.map((row) => row.id), ['seedance-2.5', 'kling-3', 'veo-3.1', 'minimax-h3', 'minimax-h3-selfhosted']);
  for (const profile of MODEL_PROFILES) {
    assert.ok(profile.aspects.length && ['words', 'tags'].includes(profile.cameraStyle) && ['in-clip', 'per-clip'].includes(profile.cuts) && profile.tip, profile.id);
    assert.match(profile.checkedAt, /^2026-10-24$/, profile.id);
  }
  assert.equal(profileById('kling-2').id, 'kling-3', 'the stale Kling 2.0 id reads as Kling 3.0');
  assert.equal(profileById('veo-3').id, 'veo-3.1');
  assert.equal(profileById(null).id, null, 'no profile: the generic one');
  assert.equal(profileById('nope').name, 'Any model');
  console.log(`PASS A5 profiles: ${MODEL_PROFILES.map((row) => `${row.id} ${row.durationsSeconds.length ? row.durationsSeconds.join('/') : `${row.minSeconds ?? 0}-${row.maxSeconds}`}s ${row.aspects.join(',')}`).join(' | ')}`);
});

test('the limits warn with a fix, per profile', () => {
  const tc = (frames) => `f${frames}`;
  // Kling 3.0: 3-15 s clips, six shots a clip. 20 s in eight shots splits into two clips.
  const kling = profileById('kling-3'), eight = beatsOf([60, 60, 60, 60, 60, 60, 60, 60]);
  assert.deepEqual(clipsFor(eight, kling, 24).map((clip) => clip.length), [6, 2], 'six shots, then the rest');
  const split = profileWarnings(eight, kling, { fps: 24, aspect: '16:9', timecode: tc });
  assert.equal(split[0].code, 'SPLIT');
  assert.equal(split[0].fix, 'Split here: beat 7 (f360) (2 clips).');
  const long = profileWarnings(beatsOf([480]), kling, { fps: 24, aspect: '16:9', timecode: tc });
  assert.deepEqual(long.map((row) => [row.code, row.fix]), [['TOO_LONG', 'Trim to 15s (cut at f360) or split it in two.']]);
  // Veo 3.1: 4, 6 or 8 s, one clip per shot.
  const veo = profileById('veo-3.1'), grid = profileWarnings(beatsOf([120, 72, 240]), veo, { fps: 24, aspect: '16:9', timecode: tc });
  assert.deepEqual(grid.map((row) => row.fix), ['Trim to 4s or extend to 6s (cut at f96).', 'Extend to 4s.', 'Trim to 8s (cut at f384).']);
  // MiniMax H3: 4-15 whole seconds.
  const h3 = profileWarnings(beatsOf([108]), profileById('minimax-h3'), { fps: 24, aspect: '16:9', timecode: tc });
  assert.deepEqual(h3.map((row) => [row.code, row.fix]), [['WHOLE_SECONDS', 'Trim to 4s (cut at f96).']]);
  // Seedance 2.5: 4-30 s; a 2 s range is too short.
  assert.deepEqual(profileWarnings(beatsOf([48]), profileById('seedance-2.5'), { fps: 24, aspect: '16:9', timecode: tc }).map((row) => row.code), ['TOO_SHORT']);
  // Self-hosted H3: 10 s.
  assert.deepEqual(profileWarnings(beatsOf([264]), profileById('minimax-h3-selfhosted'), { fps: 24, aspect: '12:7', timecode: tc }).map((row) => row.code), ['TOO_LONG']);
  // Aspect: Veo does not make 2.39:1.
  const wide = profileWarnings(beatsOf([192]), veo, { fps: 24, aspect: '2.39:1', timecode: tc });
  assert.deepEqual(wide.map((row) => [row.code, row.fix]), [['ASPECT', 'Deliver 16:9 and reframe or letterbox to 2.39:1 in the edit.']]);
  assert.deepEqual(profileWarnings(beatsOf([192]), profileById(null), { fps: 24, aspect: '2.39:1', timecode: tc }), [], 'no profile, no limits');
  console.log('PASS A5 warnings: split, trim, extend, whole seconds, too short, too long, aspect');
});

test('the profile shapes the brief and the aspect comes from the document', () => {
  const { f, document } = coveredSequence();
  try {
    const generic = buildSequencePrompt(document);
    assert.deepEqual(generic.warnings, [], 'no profile: no warnings');
    assert.match(generic.text, /^FOR: Any model \(no model limits applied\)\./m);
    const kling = buildSequencePrompt(document, { profile: 'kling-3' });
    assert.match(kling.text, /^FOR: Kling 3\.0 \(3-15 s clips, up to 6 shots; 16:9, 9:16, 1:1; checked 2026-10-24\)\./m);
    assert.match(kling.text, /^Shot 1, 1\.58s 00:00:00:00-00:00:01:13 /m, 'Kling labels each shot with its length');
    assert.match(kling.text, /^DELIVERY: 1 clip, cutting between beats/m);
    const veo = buildSequencePrompt(document, { profile: 'veo-3.1' });
    assert.match(veo.text, /^DELIVERY: one clip per beat \(5 clips\), each a single continuous shot\.$/m);
    assert.match(veo.text, /^CLIP 1 of 5 \(1\.58s\): generate on its own$/m);
    assert.deepEqual(codes(veo), ['LENGTH_GRID', 'LENGTH_GRID', 'LENGTH_GRID', 'LENGTH_GRID', 'LENGTH_GRID'], 'every 1.6 s beat is off Veo\'s grid');
    assert.match(veo.text, /^WARNINGS:\n- Beat 1 \(MASTER\+ 1 · Master\) runs 1\.58s; Veo 3\.1 makes 4, 6, 8 s clips\. Fix: Extend to 4s\.$/m);
    const h3 = buildSequencePrompt(document, { profile: 'minimax-h3' });
    assert.match(h3.text, /^ {3}Camera: \[Push in\] a medium shot from the waist up; a fast push-in/m, 'MiniMax leads with its bracket tag');
    assert.match(h3.text, /^ {3}Camera: \[Static\] /m);
    assert.ok(codes(h3).includes('TOO_SHORT') && codes(h3).includes('WHOLE_SECONDS'));
    // The aspect is the document's: portrait for a vertical cut, and a shot's own aspect wins for that shot.
    const portrait = buildSequencePrompt({ ...document, aspect: '9:16' }, { profile: 'veo-3.1' });
    assert.match(portrait.text, /^SEQUENCE: Rooftop: 5 shots, 8s at 24 fps, 9:16\.$/m);
    assert.equal(portrait.aspect, '9:16'); assert.ok(!codes(portrait).includes('ASPECT'));
    const scope = buildSequencePrompt({ ...document, aspect: '2.39:1' }, { profile: 'veo-3.1' });
    assert.match(scope.text, /^SEQUENCE: .*, 2\.39:1\.$/m);
    assert.equal(scope.warnings[0].code, 'ASPECT');
    const mixed = buildSequencePrompt({ ...document, shots: document.shots.map((shot, i) => (i === 4 ? { ...shot, aspect: '1:1' } : shot)) }, { profile: 'kling-3' });
    assert.ok(codes(mixed).includes('MIXED_ASPECT'), 'a shot with its own aspect is flagged');
    assert.ok(!/16:9/.test(buildSequencePrompt({ ...document, aspect: '4:3' }).text.split('\n')[0]), 'no hardcoded 16:9');
    console.log(`PASS A5 brief shaping: kling ${kling.text.length} chars, veo ${veo.warnings.length} warnings, h3 tags, aspect ${portrait.aspect}/${scope.aspect}`);
  } finally { f.dispose(); }
});
