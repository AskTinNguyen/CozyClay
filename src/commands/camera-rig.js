// The shot camera's capabilities as Studio actions (camera-capabilities):
// camera.set writes roll, lens, shake, mount, speed and shutter on a shot's
// camera block; camera.setKey keys roll and focus on its rig keys. Both are
// one undo entry and answer what the camera now does, sampled. Registered by
// commands/camera.js beside the technique library.
import { createCameraBlock, updateCameraBlock } from '../camera-block.js';
import { cameraCapabilities, F_STOPS, LIMITS, MOUNT_BONES, MOUNT_LOOKS, SHAKE_STYLES } from '../camera-capabilities/fields.js';
import { capabilityReadback, capabilityScene } from '../camera-capabilities/readback.js';
import { shotAtFrame } from '../cuts.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail, shotLabel } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const orNull = (schema) => ({ oneOf: [schema, { type: 'null' }] });
const range = ([minimum, maximum]) => ({ type: 'number', minimum, maximum });
const focus = orNull({ oneOf: [input({ targetId: id }, ['targetId']), input({ distance: range(LIMITS.focusDistance) }, ['distance'])] });
const FIELDS = {
  rollDeg: orNull(range(LIMITS.rollDeg)),
  lens: orNull(input({ fStop: orNull(range(LIMITS.fStop)), focusTarget: orNull(id), focusDistance: orNull(range(LIMITS.focusDistance)) })),
  shake: orNull(input({ style: { type: 'string', enum: SHAKE_STYLES }, amplitude: range(LIMITS.amplitude), frequency: range(LIMITS.frequency), seed: { type: 'integer', minimum: 0, maximum: LIMITS.seed[1] } }, ['amplitude'])),
  mount: orNull(input({ characterId: id, bone: { type: 'string', enum: MOUNT_BONES }, look: { type: 'string', enum: MOUNT_LOOKS },
    offset: input({ side: range(LIMITS.offset), up: range(LIMITS.offset), forward: range(LIMITS.offset) }) }, ['characterId'])),
  speed: orNull(range(LIMITS.speed)),
  shutterDeg: orNull(range(LIMITS.shutterDeg)),
  rigKeys: orNull({ type: 'array', maxItems: 32, items: input({ offset: { type: 'integer', minimum: 0 }, rollDeg: range(LIMITS.rollDeg), focus, ease: { type: 'string', enum: ['linear', 'in', 'out'] } }, ['offset']) }),
};

export const rigDeclarations = [
  { id: 'camera.set', label: 'Set shot camera capabilities', kind: 'mutation', undoDomain: 'shot',
    description: `Give a shot's camera what keys and rails cannot: rollDeg (Dutch angle; + turns the camera counter-clockwise, the horizon falls to the right), lens { fStop (${F_STOPS.join(', ')}; depth of field in the preview and captures), focusTarget (a cast id, followed per frame) or focusDistance (m) }, shake { style handheld|vehicle, amplitude 0-1, frequency Hz, seed } (deterministic, on top of the keys), mount { characterId, bone chest|head|hips|back, offset { side, up, forward } m, look face|forward } (Snorricam: the camera rides the body), speed (0.5 = slow motion: the take plays at half speed), shutterDeg (motion blur; 180 natural, 270+ heavy), rigKeys [{ offset (frames from the shot start), rollDeg, focus, ease }] (animated roll and rack focus; camera.setKey adds one). null clears a field; a lens patch merges. shotId defaults to the shot under the playhead. Answers checks { rollDeg, fStop, focus, focusDistances, shakeAmplitude, mountBone, speed, shutterDeg } sampled from the result.`,
    input: input({ shotId: id, ...FIELDS }) },
  { id: 'camera.setKey', label: 'Key shot camera roll or focus', kind: 'mutation', undoDomain: 'shot',
    description: 'Key the shot camera\'s roll and/or focus at a timeline frame (default the playhead) on its rig keys, which ease like camera keys without stopping the camera: two focus keys on different cast ids make a rack focus. rollDeg or focus null drops that channel from the key; remove: true drops the key. Answers the sampled roll and focus.',
    input: input({ shotId: id, frame: { type: 'integer', minimum: 0 }, rollDeg: orNull(range(LIMITS.rollDeg)), focus, ease: { type: 'string', enum: ['linear', 'in', 'out'] }, remove: { type: 'boolean' } }) },
];

export function registerRig(registry, ports) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  const hasShots = state => (mounted() === true ? state.shots.length > 0 || 'There are no shots yet; add one with shot.create.' : mounted());
  const shotFor = (shotId) => {
    const rows = owner().read(), view = ports.readView();
    if (shotId) return rows.find(row => row.id === shotId) ?? fail('STALE_TARGET', `Shot ${shotId} is not in this scene.`);
    return shotAtFrame(rows, view.view?.frame ?? ports.state().frame) ?? rows.find(row => row.id === view.selectedShotId) ?? fail('AMBIGUOUS_TARGET', 'No shot owns the playhead; name one with shotId.');
  };
  const castIds = () => new Set(ports.readView().characters.map(row => row.id));
  const castName = (castId) => { const row = ports.readView().characters.find(entry => entry.id === castId); return (row?.subject ?? row?.name ?? castId).split(',')[0]; };
  const known = (castId, what) => (castIds().has(castId) ? castId : fail('STALE_TARGET', `${what} ${castId} is not a character in this scene.`));
  const write = (shotId, update) => owner().write(rows => rows.map(row => (row.id === shotId ? { ...row, camera: update(createCameraBlock(row.camera)) } : row)));
  function answer(shotId, verb) {
    const shot = owner().read().find(row => row.id === shotId), { checks, words } = capabilityReadback(shot, capabilityScene(ports.readView(), owner().state().frameCount), castName);
    return { affectedIds: [shotId], summary: `${verb} ${shotLabel(shot)}: ${words.join('; ') || 'a plain camera'}.`.slice(0, 240), checks, output: { capabilities: cameraCapabilities(shot.camera) } };
  }
  registry.register({ ...rigDeclarations[0], available: hasShots, target: args => args.shotId, run(args) {
    const shot = shotFor(args.shotId), patch = Object.fromEntries(Object.keys(FIELDS).filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    if (!Object.keys(patch).length) fail('INVALID_ARGUMENT', 'Name at least one of rollDeg, lens, shake, mount, speed, shutterDeg or rigKeys.');
    if (patch.mount) known(patch.mount.characterId, 'Mount');
    if (patch.lens?.focusTarget) known(patch.lens.focusTarget, 'Focus target');
    for (const key of patch.rigKeys ?? []) if (key.focus?.targetId) known(key.focus.targetId, 'Focus target');
    if (patch.lens) {
      const current = createCameraBlock(shot.camera).lens ?? {}, merged = { ...current, ...patch.lens };
      if (patch.lens.focusTarget) delete merged.focusDistance;
      if (patch.lens.focusDistance) delete merged.focusTarget;
      patch.lens = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null));
    }
    write(shot.id, camera => updateCameraBlock(camera, patch));
    return answer(shot.id, 'Camera set on');
  } });
  registry.register({ ...rigDeclarations[1], available: hasShots, target: args => args.shotId, run(args) {
    const shot = shotFor(args.shotId), frame = args.frame ?? ports.readView().view?.frame ?? ports.state().frame;
    if (frame < shot.startFrame || frame > shot.endFrame) fail('TARGET_NOT_READY', `Frame ${frame} is outside ${shot.name} (${shot.startFrame}-${shot.endFrame}).`);
    if (!args.remove && args.rollDeg === undefined && args.focus === undefined) fail('INVALID_ARGUMENT', 'Give rollDeg, focus, or remove: true.');
    if (args.focus?.targetId) known(args.focus.targetId, 'Focus target');
    const offset = frame - shot.startFrame;
    write(shot.id, camera => {
      const keys = camera.rigKeys ?? [], old = keys.find(key => key.offset === offset) ?? { offset }, next = { ...old };
      for (const field of ['rollDeg', 'focus', 'ease']) if (args[field] !== undefined) { if (args[field] === null) delete next[field]; else next[field] = args[field]; }
      const rest = keys.filter(key => key.offset !== offset);
      return updateCameraBlock(camera, { rigKeys: args.remove ? rest : [...rest, next] });
    });
    return answer(shot.id, args.remove ? `Removed the rig key at frame ${frame} of` : `Keyed frame ${frame} of`);
  } });
}
