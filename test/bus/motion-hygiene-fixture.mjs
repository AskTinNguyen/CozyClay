// Port-level history instrumentation for verify-studio-undo-hygiene. The real
// solver, take arrays and runtime projections are exercised by motion-fixture.
export const motionCommandInputs = {
  'motion.rangePin.apply': { characterId: 'actor', pin: { id: 'pin', track: 'leftFoot', startFrame: 1, endFrame: 1, blend: 1, target: { space: 'world', position: [0, 0, 0] } } },
  'motion.rangePin.remove': { characterId: 'actor', pinId: 'pin' },
  'motion.set': { id: 'actor', set: { take: { prompt: 'Renamed take' } } },
  'ik.applyPose': { characterId: 'actor', frame: 8, pose: { bones: {} } },
  'ik.setKey': { characterId: 'actor', frame: 12, tracks: { head: { q: [{ x: 0, y: 0, z: 0, w: 1 }] } } },
  'ik.removeKey': { characterId: 'actor', frame: 12 },
  'ik.clearKeys': { characterId: 'actor' },
  'motion.commitLineEdit': { characterId: 'actor' },
  'motion.regenerateTrail': { characterId: 'actor' },
};
export function motionHygieneDomain(ports) {
  let rows = [{ id: 'actor', take: { frames: 48, fps: 24, prompt: '' }, ikKeys: [] }];
  const write = next => { rows = next; ports.writeMotion(next); };
  const patch = update => write(rows.map(row => ({ ...row, ...update })));
  const corrected = () => patch({ ikKeys: [{ frame: 8, tracks: { hips: { p: { x: 0, y: 0.02, z: 0 } } } }] });
  return {
    read: () => rows, write, motionFor: () => rows[0].take, fullMotionFor: () => ({ frames: 48 }),
    clear: () => patch({ take: null, ikKeys: [] }),
    keyPose: corrected,
    bakeRangePin: (_id, pin) => patch({ ikPins: [pin], ikKeys: [{ frame: pin.startFrame, tracks: { [pin.track]: { p: { x: 0, y: 0, z: 0 }, pin: pin.id } } }] }),
    removePin: () => patch({ ikPins: [], ikKeys: [] }),
    requestLineEdit: () => ports.queueMotion('line'), requestTrailRegeneration: () => ports.queueMotion('trail'),
  };
}
