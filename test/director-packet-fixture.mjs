// Sequences the director-packet verify files share, laid through the real App
// wiring with camera.cover: master and coverage for Mara and Joon (the
// shot-prompt-engine fixture: a push-in, a dissolve, a Dutch roll), and a
// triangle dialogue for Mara, Joon and Sela standing round a point.
import { shotsFixture, framing } from './bus/shots-fixture.mjs';
import { coveredSequence, documentOf } from './bus/sequence-fixture.mjs';
import { createShot } from '../src/cuts.js';
import { createCharacterEntry } from '../src/scenes.js';

export { coveredSequence };

const toward = (from, to) => (Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI;
const TRIO = ['Mara', 'Joon', 'Sela'].map((name, i) => {
  const centre = { x: 2, z: 1.2 }, at = { x: centre.x + 2.3 * Math.sin((i * 2 * Math.PI) / 3), z: centre.z + 2.3 * Math.cos((i * 2 * Math.PI) / 3) };
  return createCharacterEntry({ id: `actor-${name.toLowerCase()}`, model: 'y-bot-tpose', ...at, rot: toward(at, centre), subject: name });
});

/** Triangle dialogue over 0-311 for the trio; returns { f, receipt, document }. */
export function triangleSequence() {
  const f = shotsFixture({ characters: TRIO });
  for (const row of TRIO) f.live.current.rigs[row.id] ??= f.live.current.rigs['actor-a'];
  f.shots.load({ shots: [{ ...createShot('Scene', 0, 311, [{ id: 'key-a', frame: 0, framing }]), id: 'shot-a' }], frameCount: 400, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 10;
  const receipt = f.run('camera.cover', { pattern: 'triangle-dialogue', cast: TRIO.map((row) => row.id), shotId: 'shot-a' }, 'agent');
  if (!receipt.ok) throw new Error(JSON.stringify(receipt).slice(0, 600));
  return { f, receipt, document: documentOf(f, { title: 'Triangle', frameCount: 400, activeCharacterId: 'actor-mara' }) };
}
