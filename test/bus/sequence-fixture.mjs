// A sequence built through the real App wiring (shots-fixture.mjs): Mara and
// Joon 4 m apart, covered with camera.cover (master and coverage over 0-191),
// a push-in on the second shot, a 12-frame dissolve into the third, a Dutch roll on the fourth, then
// the document buildSequencePrompt reads. Shared by the shot-prompt-engine
// verify files.
import { shotsFixture, framing } from './shots-fixture.mjs';
import { createShot } from '../../src/cuts.js';
import { createCharacterEntry } from '../../src/scenes.js';

const characters = [
  createCharacterEntry({ id: 'actor-a', model: 'y-bot-tpose', x: 0, z: 0, rot: 90, subject: 'Mara, a woman in a red raincoat' }),
  createCharacterEntry({ id: 'actor-b', model: 'y-bot-tpose', x: 4, z: 0, rot: -90, subject: 'Joon, a tall man in a grey suit' }),
];

/** The studio state as a sequence document. */
function documentOf(f, extra = {}) {
  const view = f.actual.readStudioState();
  return { title: 'Rooftop', fps: 24, aspect: '16:9', look: 'night rain, sodium light, 35mm film', filmback: view.filmback, frameCount: 240,
    activeCharacterId: 'actor-a', cast: view.characters, shots: [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame), ...extra };
}

/** A fixture with the covered sequence laid; returns { f, receipt, document }. */
export function coveredSequence({ pattern = 'master-coverage', end = 191, roll = true, dissolve = true, push = true } = {}) {
  const f = shotsFixture({ characters });
  f.shots.load({ shots: [{ ...createShot('Scene', 0, end, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' }], frameCount: 240, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 10;
  const receipt = f.run('camera.cover', { pattern, cast: ['actor-a', 'actor-b'], shotId: 'shot-a' }, 'agent');
  if (!receipt.ok) throw new Error(JSON.stringify(receipt).slice(0, 600));
  const shots = () => [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
  if (push && shots()[1]) { const set = f.run('camera.applyTechnique', { shotId: shots()[1].id, subjectId: 'actor-a', stack: [{ id: 'medium-shot' }, { id: 'push-in' }] }, 'agent'); if (!set.ok) throw new Error(JSON.stringify(set).slice(0, 400)); }
  if (dissolve && shots()[2]) { const set = f.run('camera.setTransition', { shotId: shots()[2].id, type: 'dissolve', frames: 12 }, 'agent'); if (!set.ok) throw new Error(JSON.stringify(set).slice(0, 400)); }
  if (roll && shots()[3]) { const set = f.run('camera.set', { shotId: shots()[3].id, rollDeg: 12 }, 'agent'); if (!set.ok) throw new Error(JSON.stringify(set).slice(0, 400)); }
  return { f, receipt, document: documentOf(f) };
}

/** One shot per technique stack, laid end to end (48 frames each) and applied with camera.applyTechnique; returns { f, document, receipts }. */
export function techniqueShots(stacks, { length = 48 } = {}) {
  const f = shotsFixture({ characters });
  const shots = stacks.map((_, i) => ({ ...createShot(`T${i + 1}`, i * length, i * length + length - 1, [{ id: `key-${i}`, frame: i * length, framing }]), id: `shot-${i + 1}` }));
  f.shots.load({ shots, frameCount: stacks.length * length + 24, camera: f.actual.readStudioState().camera });
  const receipts = stacks.map((stack, i) => {
    const receipt = f.run('camera.applyTechnique', { shotId: `shot-${i + 1}`, subjectId: 'actor-a', stack }, 'agent');
    if (!receipt.ok) throw new Error(JSON.stringify(receipt).slice(0, 500));
    return receipt;
  });
  return { f, receipts, document: documentOf(f, { frameCount: stacks.length * length + 24 }) };
}
