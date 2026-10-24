// A2: composition through camera.applyTechnique and shot.frame (shots-fixture.mjs).
// Every option is measured independently of the code under test: the stored
// camera key becomes a three.js PerspectiveCamera (YXZ, the editor's own
// convention) and the subject's eye point is projected through it. The eyes
// must land on the chosen third or the centre and on the headroom's eye line
// within tolerance; lead room leaves the space ahead of the facing direction;
// the receipt reports the screen position it measured; the composition is
// stored with the stack and stated in the prompt.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { createCharacterEntry } from '../../src/scenes.js';
import { currentTechnique } from '../../src/camera-techniques/storage.js';
import { shotCaptureMeta } from '../../src/shot-meta.js';
import { buildShotPrompt } from '../../src/shot-prompt.js';
import { guideGeometry } from '../../src/shot-guides.js';

const TOL = 0.012;
// Mara (actor-a) faces +x (camera-right in a front-on view); Joon stands well away.
const characters = [createCharacterEntry({ id: 'actor-a', model: 'y-bot-tpose', x: 0, z: 0, rot: 90, subject: 'Mara' }), createCharacterEntry({ id: 'actor-b', model: 'y-bot-tpose', x: 4, z: 0, rot: -90, subject: 'Joon' })];
const seed = () => ({ ...createShot('Hero', 0, 95, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' });
const shotOf = f => f.live.current.shots.find(row => row.id === 'shot-a');
function fresh(f) { f.shots.load({ shots: [seed()], frameCount: 120, camera: f.actual.readStudioState().camera }); f.live.current.timeline.currentFrame = 10; }

/** Where the eyes (93 % of 1.8 m, 0.09 m ahead of the body) sit through a stored key, as frame fractions from the top-left. */
function measure(key, row, aspect) {
  const camera = new THREE.PerspectiveCamera(key.fovDeg, aspect, 0.05, 500);
  camera.position.set(key.pos.x, key.pos.y, key.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(key.pitch, key.yaw, 0);
  camera.updateMatrixWorld(true);
  const r = THREE.MathUtils.degToRad(row.rot), eye = new THREE.Vector3(row.x + Math.sin(r) * 0.09, 0.93 * 1.8, row.z + Math.cos(r) * 0.09).project(camera);
  return { x: (eye.x + 1) / 2, y: (1 - eye.y) / 2 };
}
const EYE_LINE = { tight: (1 - 0.42) / 2, normal: 1 / 3, loose: (1 - 0.2) / 2 };
const PLACE = { 'left-third': 1 / 3, centre: 0.5, 'right-third': 2 / 3 };

test('camera.applyTechnique places the eyes on each third, the centre and each headroom line', () => {
  const f = shotsFixture({ characters });
  try {
    const state = f.actual.readStudioState(), aspect = state.filmback.aspectRatio, mara = state.characters.find(row => row.id === 'actor-a');
    const rows = [];
    for (const place of ['left-third', 'centre', 'right-third']) for (const headroom of ['tight', 'normal', 'loose']) for (const stack of [['medium-shot'], ['close-up', 'low-angle'], ['push-in']]) {
      fresh(f);
      const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack, composition: { place, headroom } }, 'agent');
      assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 400));
      for (const key of shotOf(f).cameraKeys) {
        const at = measure(key.framing, mara, aspect);
        assert.ok(Math.abs(at.x - PLACE[place]) < TOL, `${place}/${headroom}/${stack}: eyes at x ${at.x.toFixed(4)}, want ${PLACE[place].toFixed(4)}`);
        assert.ok(Math.abs(at.y - EYE_LINE[headroom]) < TOL, `${place}/${headroom}/${stack}: eye line at ${at.y.toFixed(4)}, want ${EYE_LINE[headroom].toFixed(4)}`);
      }
      const first = measure(shotOf(f).cameraKeys[0].framing, mara, aspect);
      assert.ok(Math.abs(receipt.checks.screenX - first.x) < 0.002 && Math.abs(receipt.checks.eyeLineY - first.y) < 0.002, `the receipt reports what it achieved: ${receipt.checks.screenX}, ${receipt.checks.eyeLineY}`);
      assert.match(receipt.checks.composition, new RegExp(`${place.replace('-', ' ')} · ${headroom} headroom`));
      if (stack[0] === 'push-in') assert.equal(receipt.checks.moveVerified, true, 'a composed push-in still reads as a push-in');
      rows.push(`${place}/${headroom}=${first.x.toFixed(3)},${first.y.toFixed(3)}`);
    }
    console.log(`PASS ${rows.length / 3} placements x 3 stacks: ${rows.filter((_, i) => i % 3 === 0).join(' ')}`);
  } finally { f.dispose(); }
});

test('lead room leaves the space ahead of the facing direction; more lead room pushes further; the stack keeps it', () => {
  const f = shotsFixture({ characters });
  try {
    const state = f.actual.readStudioState(), aspect = state.filmback.aspectRatio, mara = state.characters.find(row => row.id === 'actor-a');
    for (const side of ['right', 'left']) {
      fresh(f);
      const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: ['medium-close-up'], side, composition: { leadRoom: 'facing' } }, 'agent');
      assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 400));
      const key = shotOf(f).cameraKeys[0].framing, at = measure(key, mara, aspect);
      const right = new THREE.Vector3(Math.cos(key.yaw), 0, -Math.sin(key.yaw)), facesRight = right.x * 1 > 0; // Mara faces +x
      assert.ok(Math.abs(at.x - (facesRight ? 1 / 3 : 2 / 3)) < TOL, `${side}: facing screen-${facesRight ? 'right' : 'left'}, so the eyes sit on the ${facesRight ? 'left' : 'right'} third (x ${at.x.toFixed(3)})`);
      const more = f.run('camera.applyTechnique', { shotId: 'shot-a', request: 'more lead room' }, 'agent');
      assert.equal(more.ok, true, JSON.stringify(more).slice(0, 400));
      assert.deepEqual(currentTechnique(shotOf(f)).stack.map(row => row.id), ['medium-close-up'], 'composition words alone keep the stack');
      const further = measure(shotOf(f).cameraKeys[0].framing, mara, aspect);
      assert.ok(Math.abs(further.x - (facesRight ? 0.275 : 0.725)) < TOL, `more lead room: x ${further.x.toFixed(3)}`);
      assert.deepEqual(currentTechnique(shotOf(f)).composition, { place: 'auto', headroom: 'normal', leadRoom: 'more' }, 'the composition is stored with the stack');
    }
    // Review #5: composition alone (no stack, no request) reuses the shot's stack, or a medium shot on a shot without one.
    const alone = f.run('camera.applyTechnique', { shotId: 'shot-a', composition: { place: 'right-third' } }, 'agent');
    assert.equal(alone.ok, true, JSON.stringify(alone).slice(0, 400));
    assert.deepEqual(currentTechnique(shotOf(f)).stack.map(row => row.id), ['medium-close-up'], 'composition alone keeps the stack');
    assert.ok(Math.abs(alone.checks.screenX - 2 / 3) < TOL, `and places the eyes: ${alone.checks.screenX}`);
    fresh(f);
    const bare = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', composition: { place: 'left-third' } }, 'agent');
    assert.equal(bare.ok, true, JSON.stringify(bare).slice(0, 400));
    assert.deepEqual(currentTechnique(shotOf(f)).stack.map(row => row.id), ['medium-shot'], 'a shot with no stack falls back to a medium shot');
    assert.ok(Math.abs(bare.checks.screenX - 1 / 3) < TOL);
    const thirds = f.run('camera.applyTechnique', { shotId: 'shot-a', request: 'medium shot, rule of thirds left' }, 'agent');
    assert.equal(thirds.ok, true, JSON.stringify(thirds).slice(0, 400));
    assert.ok(Math.abs(thirds.checks.screenX - 1 / 3) < TOL);
    const prompt = buildShotPrompt(shotCaptureMeta({ shot: shotOf(f), fps: 24 }));
    assert.match(prompt, /TECHNIQUE: MS · \d+mm: a medium shot[^;]*; the subject on the left third of the frame, eyes on the upper third line/, prompt);
    const lines = guideGeometry('thirds').lines;
    assert.ok(lines.some(line => Math.abs(line.x1 - 100 / 3) < 1e-9 && line.x1 === line.x2) && lines.some(line => Math.abs(line.y1 - 100 / 3) < 1e-9), 'the thirds guide draws the lines the eyes sit on');
  } finally { f.dispose(); }
});

test('shot.frame takes the same composition and reports it', () => {
  const f = shotsFixture({ characters });
  try {
    const state = f.actual.readStudioState(), aspect = state.filmback.aspectRatio, mara = state.characters.find(row => row.id === 'actor-a');
    for (const [place, headroom] of [['left-third', 'normal'], ['right-third', 'tight'], ['centre', 'loose']]) {
      fresh(f);
      const receipt = f.run('shot.frame', { shotId: 'shot-a', subjectIds: ['actor-a'], framing: { intent: { size: 'medium close-up', level: 'eye', view: 'front three-quarter', side: 'right', focalMm: 50 } }, composition: { place, headroom } }, 'agent');
      assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 400));
      const at = measure(shotOf(f).cameraKeys[0].framing, mara, aspect);
      assert.ok(Math.abs(at.x - PLACE[place]) < TOL && Math.abs(at.y - EYE_LINE[headroom]) < TOL, `shot.frame ${place}/${headroom}: ${at.x.toFixed(3)}, ${at.y.toFixed(3)}`);
      assert.ok(Math.abs(receipt.checks.screenX - at.x) < 0.002 && Math.abs(receipt.checks.eyeLineY - at.y) < 0.002, 'and reports it');
    }
    console.log('PASS shot.frame left/right/centre with tight/normal/loose headroom');
  } finally { f.dispose(); }
});

// depth-staging A3: composition.foreground. The lamp's world box comes from its row (footprint x scale, height x scaleY),
// each vertical edge is sampled through the three.js camera, and only the part inside the frame's height counts.
function lampShare(key, row, aspect, side) {
  const camera = new THREE.PerspectiveCamera(key.fovDeg, aspect, 0.05, 500);
  camera.position.set(key.pos.x, key.pos.y, key.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(key.pitch, key.yaw, 0);
  camera.updateMatrixWorld(true);
  const hw = row.footprint.width * row.scaleX / 2, hd = row.footprint.depth * row.scaleZ / 2, top = row.height * row.scaleY, xs = [];
  for (const dx of [-hw, hw]) for (const dz of [-hd, hd]) for (let i = 0; i <= 32; i++) {
    const p = new THREE.Vector3(row.x + dx, top * i / 32, row.z + dz).project(camera);
    if (Math.abs(p.y) <= 1) xs.push(side * p.x);
  }
  return (1 + Math.max(...xs)) / 2;
}

test('composition.foreground puts a named prop at its share of the frame width, the eyes on the far third; the OTS keeps its shoulder', () => {
  const f = shotsFixture({ characters });
  try {
    const add = f.run('object.add', { kind: 'cylinder', placement: { x: 2.4, z: 1.4 }, name: 'Floor lamp' }, 'agent');
    assert.equal(add.ok, true, JSON.stringify(add).slice(0, 300));
    const lampId = f.actual.readStudioState().objects.find(row => row.name === 'Floor lamp').id;
    const scaled = f.run('object.set', { id: lampId, set: { scale: { x: 0.35, y: 1.6, z: 0.35 } } }, 'agent');
    assert.equal(scaled.ok, true, JSON.stringify(scaled).slice(0, 300));
    const state = f.actual.readStudioState(), aspect = state.filmback.aspectRatio, mara = state.characters.find(row => row.id === 'actor-a'), lamp = state.objects.find(row => row.id === lampId);
    const rows = [];
    for (const side of ['right', 'left']) for (const share of [0.2, 0.3, 0.4]) for (const stack of [['medium-shot'], ['medium-close-up']]) {
      fresh(f);
      const receipt = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack, side, composition: { foreground: { id: 'lamp', share } } }, 'agent');
      assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 400));
      const key = shotOf(f).cameraKeys[0].framing, measured = lampShare(key, lamp, aspect, side === 'left' ? -1 : 1), eyes = measure(key, mara, aspect);
      assert.ok(Math.abs(measured - share) < 0.02, `${side}/${share}/${stack}: the lamp covers ${measured.toFixed(3)} of the width, want ${share}`);
      assert.ok(Math.abs(receipt.checks.foregroundShare - measured) < 0.01, `the receipt reports it: ${receipt.checks.foregroundShare}`);
      assert.ok(Math.abs(eyes.x - (side === 'left' ? 1 / 3 : 2 / 3)) < TOL && Math.abs(eyes.y - 1 / 3) < TOL, `the eyes on the far third: ${eyes.x.toFixed(3)}, ${eyes.y.toFixed(3)}`);
      assert.deepEqual(currentTechnique(shotOf(f)).composition.foreground, { id: lampId, share }, 'the foreground is stored by the id it resolved to');
      rows.push(`${side}/${share}=${measured.toFixed(3)}`);
    }
    // In words, through the router, and stated in the prompt.
    fresh(f);
    const said = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', request: 'put the lamp in the foreground' }, 'agent');
    assert.equal(said.ok, true, JSON.stringify(said).slice(0, 400));
    assert.ok(Math.abs(said.checks.foregroundShare - 0.3) < 0.02, `"put the lamp in the foreground" resolves to it: ${said.checks.foregroundShare}`);
    assert.match(buildShotPrompt(shotCaptureMeta({ shot: shotOf(f), fps: 24 })), /Floor lamp soft in the foreground/);
    const missing = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', composition: { foreground: { id: 'piano' } } }, 'agent');
    assert.equal(missing.ok, false, 'a foreground nothing in the scene answers to is refused');
    // The over-the-shoulder keeps its own dirty shoulder (camera-polish): the same keys with or without the foreground ask.
    fresh(f);
    assert.equal(f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: ['over-the-shoulder'] }, 'agent').ok, true);
    const ots = structuredClone(shotOf(f).cameraKeys.map(row => row.framing));
    fresh(f);
    const both = f.run('camera.applyTechnique', { shotId: 'shot-a', subjectId: 'actor-a', stack: ['over-the-shoulder'], composition: { foreground: { id: 'lamp' } } }, 'agent');
    assert.equal(both.ok, true, JSON.stringify(both).slice(0, 400));
    assert.deepEqual(shotOf(f).cameraKeys.map(row => row.framing), ots, 'the OTS framing is unchanged');
    assert.ok(both.warnings.some(row => /keeps its own framing/.test(row.message)), JSON.stringify(both.warnings));
    console.log(`PASS foreground shares ${rows.join(' ')}`);
  } finally { f.dispose(); }
});
