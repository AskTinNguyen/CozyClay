// shot-prompt-engine A2: each beat states its move with numbers measured from
// the sampled camera. Five shots through camera.applyTechnique (a push-in, a
// pan, a dolly zoom, a whip pan, a held shot); this file samples every frame
// with sampleAt itself and checks each number the brief states (distance,
// speed, pan and tilt rates, focal change, roll, focus) within its rounding.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { techniqueShots } from './sequence-fixture.mjs';
import { buildSequencePrompt } from '../../src/shot-prompt-engine/sequence.js';
import { engineScene } from '../../src/shot-prompt-engine/measure.js';
import { sampleAt } from '../../src/sample-at.js';
import { shortestArc } from '../../src/camera-move.js';

const DEG = 180 / Math.PI;
const near = (stated, actual, places, label) => assert.ok(Math.abs(stated - actual) <= 0.5 * 10 ** -places + 1e-9, `${label}: stated ${stated}, sampled ${actual}`);

/** The camera of a shot summed straight from sampleAt, frame by frame. */
function sampled(document, shot) {
  const scene = engineScene(document), poses = [];
  for (let frame = shot.startFrame; frame <= shot.endFrame; frame++) poses.push(sampleAt(scene, shot, frame).camera);
  let distance = 0, pan = 0, tilt = 0, first = -1, last = -1;
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1], b = poses[i], step = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
    distance += step; pan += shortestArc(a.yaw, b.yaw); tilt += b.pitch - a.pitch;
    if (step > 1e-4 || Math.abs(shortestArc(a.yaw, b.yaw)) > 1e-4 || Math.abs(b.pitch - a.pitch) > 1e-4 || Math.abs(b.focalMm - a.focalMm) > 1e-3) { if (first < 0) first = i; last = i; }
  }
  const seconds = first < 0 ? 0 : (last - first + 1) / 24;
  return { distance, speed: seconds ? distance / seconds : 0, pan: pan * DEG, panRate: seconds ? (pan * DEG) / seconds : 0, tilt: tilt * DEG, focal: [poses[0].focalMm, poses.at(-1).focalMm], seconds, roll: poses[0].rollDeg ?? 0, held: first < 0 };
}

const STACKS = {
  'push-in': [{ id: 'medium-shot' }, { id: 'push-in' }],
  pan: [{ id: 'medium-shot' }, { id: 'pan-shot' }],
  'dolly-zoom': [{ id: 'medium-shot' }, { id: 'dolly-zoom' }],
  'whip-pan': [{ id: 'medium-shot' }, { id: 'whip-pan' }],
  held: [{ id: 'medium-shot' }, { id: 'static-shot' }],
};

test('every stated camera number matches sampleAt within its rounding', () => {
  const names = Object.keys(STACKS), { f, document } = techniqueShots(Object.values(STACKS));
  try {
    const out = buildSequencePrompt(document), rows = [];
    names.forEach((name, i) => {
      const shot = document.shots[i], beat = out.beats[i], line = out.text.split('\n').find((row) => row.startsWith('   Measured: ') && out.text.indexOf(row) > out.text.indexOf(`${i + 1}. `));
      assert.equal(line, `   Measured: ${beat.measured}.`, `${name}: the beat's Measured line`);
      const truth = sampled(document, shot), text = beat.measured;
      rows.push(`${name}: ${text}`);
      if (name === 'held') {
        assert.ok(truth.held, 'the held shot does not move');
        assert.match(text, /^the camera holds still for 2s \(locked off\), [\d.]+ mm$/, text);
        near(Number(text.match(/, ([\d.]+) mm$/)[1]), truth.focal[0], 1, 'held focal');
        return;
      }
      assert.ok(!truth.held, `${name} moves`);
      const travel = text.match(/travels ([\d.]+) m at ([\d.]+) m\/s/), panned = text.match(/pans (left|right) ([\d.]+)° at ([\d.]+)°\/s/), over = text.match(/over ([\d.]+)s$/);
      near(Number(over[1]), truth.seconds, 2, `${name} move time`);
      if (truth.distance >= 0.05) { near(Number(travel[1]), truth.distance, 2, `${name} distance`); near(Number(travel[2]), truth.speed, 2, `${name} speed`); } else assert.equal(travel, null, `${name}: no travel stated under 5 cm`);
      if (Math.abs(truth.pan) >= 1) {
        assert.equal(panned[1], truth.pan > 0 ? 'left' : 'right', `${name} pan direction`);
        near(Number(panned[2]), Math.abs(truth.pan), 1, `${name} pan degrees`); near(Number(panned[3]), Math.abs(truth.panRate), 1, `${name} pan rate`);
      } else assert.equal(panned, null, `${name}: no pan stated under 1 degree`);
      const zoom = text.match(/focal ([\d.]+) to ([\d.]+) mm \(([+-][\d.]+) mm\)/);
      if (Math.abs(truth.focal[1] - truth.focal[0]) >= 0.5) { near(Number(zoom[1]), truth.focal[0], 1, `${name} focal from`); near(Number(zoom[2]), truth.focal[1], 1, `${name} focal to`); near(Number(zoom[3]), truth.focal[1] - truth.focal[0], 1, `${name} focal change`); }
      else near(Number(text.match(/(?:^|, )([\d.]+) mm(?:,|$)/)[1]), truth.focal[0], 1, `${name} focal`);
    });
    const by = Object.fromEntries(names.map((name, i) => [name, out.beats[i]]));
    assert.equal(by['push-in'].moveId, 'push-in'); assert.ok(by['push-in'].measure.distanceM > 0.5, 'the push-in travels');
    assert.ok(Math.abs(by.pan.measure.panDeg) >= 10 && by.pan.measure.distanceM < 0.05, 'the pan turns in place');
    assert.ok(Math.abs(by['dolly-zoom'].measure.focalMm[1] - by['dolly-zoom'].measure.focalMm[0]) >= 5 && by['dolly-zoom'].measure.distanceM > 0.3, 'the dolly zoom travels and changes focal');
    assert.ok(Math.abs(by['whip-pan'].measure.panDps) > Math.abs(by.pan.measure.panDps) * 2, `the whip pan is much faster than the pan (${by['whip-pan'].measure.panDps.toFixed(1)} vs ${by.pan.measure.panDps.toFixed(1)} deg/s)`);
    assert.ok(by.held.measure.held, 'the held shot says so');
    console.log(`PASS A2 measured camera:\n  ${rows.join('\n  ')}`);
  } finally { f.dispose(); }
});

test('roll and focus are measured too: a Dutch roll key pair and a rack focus', () => {
  const { f, document } = techniqueShots([[{ id: 'medium-shot' }, { id: 'push-in' }], [{ id: 'medium-shot' }]]);
  try {
    const ok = (receipt) => assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 300));
    ok(f.run('camera.setKey', { shotId: 'shot-1', frame: 0, rollDeg: 0 }, 'agent'));
    ok(f.run('camera.setKey', { shotId: 'shot-1', frame: 47, rollDeg: 15 }, 'agent'));
    ok(f.run('camera.set', { shotId: 'shot-2', lens: { fStop: 2 } }, 'agent'));
    ok(f.run('camera.setKey', { shotId: 'shot-2', frame: 48, focus: { targetId: 'actor-a' } }, 'agent'));
    ok(f.run('camera.setKey', { shotId: 'shot-2', frame: 95, focus: { targetId: 'actor-b' } }, 'agent'));
    const doc = { ...document, shots: [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame) }, out = buildSequencePrompt(doc), scene = engineScene(doc);
    const rolled = out.beats[0].measured, rolls = [0, 47].map((frame) => sampleAt(scene, doc.shots[0], frame).camera.rollDeg ?? 0);
    const roll = rolled.match(/rolls ([-\d.]+)° to ([-\d.]+)°/);
    assert.ok(roll, rolled);
    near(Number(roll[1]), rolls[0], 1, 'roll from'); near(Number(roll[2]), rolls[1], 1, 'roll to');
    const focus = out.beats[1].measured.match(/focus pulls from ([\d.]+) m to ([\d.]+) m/), distances = [48, 95].map((frame) => sampleAt(scene, doc.shots[1], frame).camera.focusDistance);
    assert.ok(focus, out.beats[1].measured);
    near(Number(focus[1]), distances[0], 2, 'focus from'); near(Number(focus[2]), distances[1], 2, 'focus to');
    assert.match(out.beats[1].rig.join(' '), /a rack focus from Mara to Joon/, 'the rig line names the rack');
    console.log(`PASS A2 roll and focus: ${rolled} | ${out.beats[1].measured}`);
  } finally { f.dispose(); }
});
