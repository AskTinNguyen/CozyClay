// director-packet A1 and A2: directorPacket over sequences laid by camera.cover.
// A1: the cast list, the story beats (only when there are any), one row per
// shot with its number, name, frames and timecode, duration, size, angle, lens
// mm, the move in measured words, the capabilities, composition, coverage role
// and transition in, and the flags of the checks that exist (cuts, coverage,
// motivation, the shot's model check), with the same bytes on every run.
// A2: the plan's primitives: a numbered camera with a frustum per shot, a path
// and arrow when it moves, the line of every pair, the cast's marks at each
// shot's start and their walks over the range, a legend, all on a landscape page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coveredSequence, triangleSequence } from './director-packet-fixture.mjs';
import { directorPacket } from '../src/director-packet/packet.js';
import { PACKET_CHECKS } from '../src/director-packet/checks.js';
import { PLAN_PAGE, primitivePoints, toPage } from '../src/director-packet/plan.js';
import { buildSequencePrompt, timecode } from '../src/shot-prompt-engine/sequence.js';
import { castAt } from '../src/camera-coverage/cut-geometry.js';

const kinds = (plan, kind) => plan.primitives.filter((row) => row.kind === kind);
/** Every primitive point lands on the page, left of the legend column. */
function assertFits(plan, label) {
  assert.ok(plan.page.width > plan.page.height && plan.page.orientation === 'landscape', `${label}: landscape`);
  assert.ok(Math.abs(plan.page.width / plan.page.height - Math.SQRT2) < 0.01, `${label}: A4 proportions`);
  for (const primitive of plan.primitives) for (const point of primitivePoints(primitive)) {
    const [x, y] = toPage(plan, point);
    assert.ok(x >= 0 && x <= plan.page.legend.x && y >= 0 && y <= plan.page.height, `${label}: ${primitive.kind} point ${JSON.stringify(point)} -> ${x.toFixed(1)},${y.toFixed(1)} is on the page`);
  }
}

test('A1: master and coverage: cast, shot rows and flags from the checks that exist, byte-identical', () => {
  const { f, document } = coveredSequence();
  try {
    const packet = directorPacket(document), brief = buildSequencePrompt(document);
    assert.deepEqual(packet.cast.map((row) => [row.letter, row.name, row.subjectOf]), [['A', 'Mara', [1, 2, 4]], ['B', 'Joon', [3, 5]]]);
    assert.equal(packet.beats, undefined, 'no story beats: no beats section');
    assert.equal(packet.shots.length, 5);
    assert.deepEqual(packet.range, { from: 1, to: 5, of: 5, startFrame: 0, endFrame: 191 });
    let delivered = 0;
    packet.shots.forEach((row, i) => {
      const shot = document.shots[i], beat = brief.beats[i];
      assert.equal(row.number, i + 1);
      assert.equal(row.name, shot.name);
      assert.deepEqual(row.frames, { start: shot.startFrame, end: shot.endFrame, count: shot.endFrame - shot.startFrame + 1 });
      assert.deepEqual(row.timecode, { in: timecode(delivered, 24), out: timecode(delivered + row.frames.count - 1, 24) });
      delivered += row.frames.count;
      assert.equal(row.durationSeconds, Math.round((row.frames.count / 24) * 100) / 100);
      for (const key of ['size', 'angle', 'lens', 'measured', 'composition', 'coverage']) assert.equal(row[key], beat[key], `shot ${i + 1} ${key}`);
      assert.equal(row.move, beat.camera);
      assert.equal(row.transitionIn, beat.transition);
      assert.ok(row.lensMm.length === 2 && row.lensMm.every((mm) => mm > 10 && mm < 200), `shot ${i + 1} lens mm ${row.lensMm}`);
      assert.match(row.coverage, /in Master and Coverage$/);
    });
    assert.match(packet.shots[1].measured, /^travels [\d.]+ m at [\d.]+ m\/s/, 'the push-in in measured words');
    assert.match(packet.shots[2].transitionIn, /12-frame dissolve/);
    assert.deepEqual(packet.shots[3].capabilities, ['a Dutch angle, the horizon tilted 12 degrees, falling to the right']);
    // Flags: the push-in has no beat (motivation); cut and coverage report clean; no shot aims at a model, so that check is left out.
    assert.deepEqual(packet.checks.map((row) => row.id), ['cuts', 'coverage', 'motivation', 'structure']);
    assert.deepEqual(packet.shots.flatMap((row) => row.flags.map((flag) => [row.number, flag.check, flag.rule])), [[2, 'motivation', 'unmotivated']]);
    // The intensity section (intensity-curve landed): the curve per shot, its words, and each row's combined value.
    assert.match(packet.intensity.words, /^intensity /);
    assert.deepEqual(packet.intensity.shots.map((row) => row.shotId), document.shots.map((shot) => shot.id));
    assert.ok(packet.shots.every((row, i) => row.intensity === packet.intensity.shots[i].combined && row.intensity >= 0 && row.intensity <= 1), 'each row carries its intensity');
    assert.equal(directorPacket(document, { range: { from: 2, to: 2 } }).intensity, undefined, 'one shot: no curve, the section is left out');
    assert.ok(packet.checks.every((row) => PACKET_CHECKS.some((check) => check.id === row.id)));
    const again = directorPacket(structuredClone(document));
    assert.equal(JSON.stringify(again), JSON.stringify(packet), 'the same document gives the same bytes');
    assert.equal(JSON.stringify(directorPacket(document)), JSON.stringify(packet), 'and on a third run');
    console.log(`PASS A1 ${packet.shots.length} rows; checks ${packet.checks.map((row) => `${row.id}: ${row.summary}`).join('; ')}`);
  } finally { f.dispose(); }
});

test('A1: beats when present, a range, cut flags and the shot model check', () => {
  const { f, document } = coveredSequence();
  try {
    const shots = document.shots;
    // A story beat at the push-in's first frame motivates it; the beat is listed with its shot and timecode.
    const beat = { id: 'story-beat-1', frame: shots[1].startFrame, kind: 'disclosure', label: 'Mara makes her admission' };
    const withBeat = directorPacket({ ...document, storyBeats: [beat] });
    assert.deepEqual(withBeat.beats, [{ id: 'story-beat-1', frame: shots[1].startFrame, kind: 'disclosure', label: 'Mara makes her admission', shot: 2, timecode: withBeat.shots[1].timecode.in }]);
    assert.equal(withBeat.shots[1].flags.length, 0, 'the beat motivates the push-in');
    // A range: shots 2-4; the shot model check appears when a shot aims at a model.
    const aimed = shots.map((shot, i) => (i === 2 ? { ...shot, targetModel: 'veo-3.1' } : shot));
    const range = directorPacket({ ...document, shots: aimed }, { range: { from: 2, to: 4 } });
    assert.deepEqual(range.shots.map((row) => row.name), shots.slice(1, 4).map((shot) => shot.name));
    assert.deepEqual([range.range.from, range.range.to, range.shots[0].timecode.in], [2, 4, '00:00:00:00']);
    assert.deepEqual(range.checks.map((row) => row.id), ['cuts', 'coverage', 'motivation', 'shot', 'structure']);
    assert.ok(range.shots[1].flags.some((flag) => flag.check === 'shot' && /Veo 3\.1/.test(flag.message)), JSON.stringify(range.shots[1].flags));
    assert.equal(range.shots[1].targetModel, 'veo-3.1');
    // Mirror shot 3's camera across the Mara-Joon line: the cut into it and out of it cross the line.
    const mirrored = shots.map((shot, i) => (i !== 2 ? shot : { ...shot, cameraKeys: shot.cameraKeys.map((key) => ({ ...key, framing: { ...key.framing, pos: { ...key.framing.pos, z: -key.framing.pos.z }, yaw: Math.PI - key.framing.yaw } })) }));
    const crossed = directorPacket({ ...document, shots: mirrored });
    assert.ok(crossed.shots[2].flags.some((flag) => flag.check === 'cuts' && flag.rule === 'line'), JSON.stringify(crossed.shots[2].flags));
    assert.ok(crossed.shots[3].flags.some((flag) => flag.check === 'cuts' && flag.rule === 'line'), 'the cut back crosses too');
    console.log(`PASS A1 beats ${withBeat.beats.length}; range 2-4 with ${range.checks.length} checks; mirrored shot flags ${crossed.shots[2].flags.map((flag) => flag.rule).join(', ')}`);
  } finally { f.dispose(); }
});

test('A2: master and coverage plan: five numbered cameras, the push-in path, one line, two marks, a legend, on the page', () => {
  const { f, document } = coveredSequence();
  try {
    const { plan } = directorPacket(document);
    assert.deepEqual(plan.counts, { cameras: 5, moving: 1, lines: 1, marks: 2, walks: 0, legendRows: 4 });
    const cameras = kinds(plan, 'camera');
    assert.deepEqual(cameras.map((row) => row.label), ['1', '2', '3', '4', '5']);
    assert.ok(cameras.every((row) => row.frustum.length === 2 && row.halfFovRad > 0), 'each camera has a frustum');
    const push = cameras[1];
    assert.ok(push.path.length >= 3 && push.travelM > 1 && push.arrow.to === push.path.at(-1), `the push-in draws its path and arrow (${push.travelM} m)`);
    const [line] = kinds(plan, 'line');
    assert.equal(line.label, 'Mara–Joon');
    assert.deepEqual([line.a, line.b], [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    assert.deepEqual(kinds(plan, 'mark').map((row) => [row.letter, row.shots]), [['A', [1, 2, 3, 4, 5]], ['B', [1, 2, 3, 4, 5]]], 'nobody moves: one mark each, every shot');
    assert.deepEqual(kinds(plan, 'legend')[0].rows.map((row) => row.kind), ['camera', 'cameraPath', 'line', 'mark']);
    assertFits(plan, 'master and coverage');
    // A walk: Mara crosses 3 m along z over the range; she starts each shot somewhere new.
    const walking = (row, shot, frame) => (row.id === 'actor-a' ? { ...castAt(row, shot, frame), z: (3 * frame) / 191 } : castAt(row, shot, frame));
    const walked = directorPacket(document, { placeAt: walking }).plan;
    assert.equal(walked.counts.walks, 1);
    assert.ok(Math.abs(kinds(walked, 'walk')[0].travelM - 3) < 0.05, `Mara walks 3 m (${kinds(walked, 'walk')[0].travelM})`);
    assert.equal(kinds(walked, 'mark').filter((row) => row.characterId === 'actor-a').length, 5, 'a mark per shot start');
    assert.deepEqual(kinds(walked, 'legend')[0].rows.map((row) => row.kind), ['camera', 'cameraPath', 'line', 'mark', 'walk']);
    assertFits(walked, 'walk');
    console.log(`PASS A2 master and coverage ${JSON.stringify(plan.counts)}; with a walk ${JSON.stringify(walked.counts)}; scale ${plan.scale} px/m on ${PLAN_PAGE.width}x${PLAN_PAGE.height}`);
  } finally { f.dispose(); }
});

test('A2: triangle dialogue plan: thirteen cameras, the three pair lines, three marks, on the page', () => {
  const { f, document } = triangleSequence();
  try {
    const packet = directorPacket(document), { plan } = packet;
    assert.equal(packet.shots.length, 13);
    assert.deepEqual(plan.counts, { cameras: 13, moving: 0, lines: 3, marks: 3, walks: 0, legendRows: 3 });
    assert.deepEqual(kinds(plan, 'line').map((row) => row.label).sort(), ['Joon–Sela', 'Mara–Joon', 'Sela–Mara'].sort());
    assert.ok(kinds(plan, 'line').every((row) => row.source === 'authored'), 'the lines the pattern authored');
    assert.equal(packet.shots.flatMap((row) => row.flags.filter((flag) => flag.check === 'cuts')).length, 0, 'the triangle cuts clean');
    assertFits(plan, 'triangle');
    assert.equal(JSON.stringify(directorPacket(structuredClone(document))), JSON.stringify(packet), 'byte-identical');
    console.log(`PASS A2 triangle ${JSON.stringify(plan.counts)}; lines ${kinds(plan, 'line').map((row) => row.label).join(', ')}`);
  } finally { f.dispose(); }
});
