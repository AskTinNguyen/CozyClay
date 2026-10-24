// The camera technique library as Studio actions: a compact index, one
// technique in full, and camera.applyTechnique, which compiles a stack into
// the primitives shot.frame and shot.setCameraRail already are, inside ONE
// bus run (one undo entry, one receipt that reads back what was achieved).
import { attachFrameMatrix, attachPos } from '../stage-attach-frames.js';
import { SUBJECT_HEIGHT_M } from '../shot.js';
import { shotAtFrame } from '../cuts.js';
import { TIMELINE_FPS } from '../timeline-defaults.js';
import { compileStack } from '../camera-techniques/compile.js';
import { describeTechnique, techniqueIndex } from '../camera-techniques/index.js';
import { parseRequest, searchTechniques } from '../camera-techniques/resolve.js';
import { classifyKeys, classifyRail, techniquePhrase } from '../camera-techniques/readback.js';
import { techniqueSignature } from '../camera-techniques/storage.js';
import { PLANNED_CAPABILITIES, TECHNIQUE_KINDS } from '../camera-techniques/entry.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail, shotLabel } from './shared.js';
import { registerRig, rigDeclarations } from './camera-rig.js';
import { capabilityReadback, capabilityScene } from '../camera-capabilities/readback.js';
import { compositionSchema, coverageDeclarations, registerCoverage } from './camera-coverage.js';
import { motivationDeclarations, registerMotivation } from './camera-motivation.js';
import { depthDeclarations, registerDepth } from './camera-depth.js';
import { routeCameraRequest } from '../camera-coverage/route.js';
import { eyePoint, measureComposition } from '../camera-coverage/composition.js';
import { travelAt } from '../camera-coverage/cut-geometry.js';
import { currentTechnique } from '../camera-techniques/storage.js';
import { castBoxes, propBoxes, resolveNear } from '../camera-depth/scene.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const params = { type: 'object', properties: {}, required: [], additionalProperties: true };
const item = { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, input({ id: { type: 'string', minLength: 1, maxLength: 40 }, params }, ['id'])] };
const STACK_HELP = 'stack: technique ids or { id, params } (one size, one angle, one move, one coverage, any modifiers), or request: a director\'s sentence ("low-angle slow push-in on Mara") the resolver turns into a stack.';

export const declarations = Object.freeze([
  { id: 'camera.techniques', label: 'List camera techniques', kind: 'job', domain: 'shot', timeoutMs: 10000, readOnly: true,
    description: 'The camera technique library (65 film techniques: sizes, angles, moves, lens moves, coverage, modifiers) as a compact index [id, kind, moods, needs?], or the ids matching query (a name, alias, misspelling or mood such as "uneasy"), kind or mood. Read one in full with camera.describeTechnique; apply with camera.applyTechnique.',
    input: input({ query: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: TECHNIQUE_KINDS }, mood: { type: 'string', maxLength: 40 } }) },
  { id: 'camera.describeTechnique', label: 'Describe a camera technique', kind: 'job', domain: 'shot', timeoutMs: 10000, readOnly: true,
    description: 'One camera technique in full: description, aliases, moods, params with defaults and ranges, the move the classifier confirms, and any camera capability it waits for (then it applies as prompt words only). Give id, or a phrase to resolve.',
    input: input({ id: { type: 'string', maxLength: 200 } }, ['id']) },
  { id: 'camera.applyTechnique', label: 'Apply camera technique', kind: 'mutation', undoDomain: 'shot',
    description: `Frame or move a shot's camera with a technique stack, as one undo entry. ${STACK_HELP} It compiles to shot.frame keys (moves ease in and out; a crash zoom, whip pan and 360 run at constant speed) or a shot.setCameraRail rail (tracking, follow, Steadicam, dolly, helicopter, one-er), and answers what it achieved: the move the classifier reads back from the real keys (checks.moveVerified), the derived size, framing checks, group members in frame, and what the camera capabilities it sets through camera.set do (Dutch/canted roll, rack focus, handheld shake, Snorricam mount, slow motion, whip-pan blur: checks rollDeg, focus, focusDistances, shakeAmplitude, mountBone, speed, shutterDeg). Shared params: speed slow|medium|fast, focalMm, direction, degrees. shotId defaults to the shot under the playhead (one is added when there is none); subjectId to the active character. side left|right puts the camera on that side of the subject. composition { place auto|left-third|centre|right-third, headroom tight|normal|loose, leadRoom none|facing|travel|more } turns the aim so the eyes sit on a third or the centre with room ahead (checks screenX, eyeLineY: frame fractions from the top-left); composition.foreground { id (a prop or cast member, by id or name), share 0.1-0.6 } frames past it so it covers that share of the width from the near edge (\"put the lamp in the foreground\"; checks foregroundShare). A request about coverage ("cover this conversation") runs camera.cover, about cuts ("check my cuts") camera.checkCuts. The stack is stored on the shot and states itself in the export prompt.`,
    input: input({ shotId: id, subjectId: id, stack: { type: 'array', items: item, minItems: 1, maxItems: 8 }, request: { type: 'string', minLength: 1, maxLength: 300 },
      speed: { type: 'string', enum: ['slow', 'medium', 'fast'] }, focalMm: { type: 'number', minimum: 8, maximum: 300 }, direction: { type: 'string', enum: ['left', 'right', 'up', 'down', 'in', 'out'] },
      degrees: { type: 'number', minimum: 5, maximum: 720 }, side: { type: 'string', enum: ['left', 'right'] }, composition: compositionSchema }) },
  // camera.set and camera.setKey: roll, lens, shake, mount, speed, shutter and rig keys (camera-rig.js).
  ...rigDeclarations,
  // camera.cover, camera.checkCuts and camera.setTransition (camera-coverage.js).
  ...coverageDeclarations,
  // story.addBeat / moveBeat / removeBeat, camera.checkMotivation and camera.alignMove (camera-motivation.js).
  ...motivationDeclarations,
  // camera.checkShots and camera.fixShot (camera-depth.js).
  ...depthDeclarations,
]);

const scaled = row => SUBJECT_HEIGHT_M * (row.scale ?? 1);
/** A character as the compiler reads it: this shot's placement override wins, and a head bone gives a point of view its eyes. */
export function castRow(row, shot, rig) {
  const placed = { ...row, ...(shot?.cast?.[row.id] ?? {}) }, eye = rig && attachFrameMatrix(rig, 'head') ? { x: attachPos.x, y: attachPos.y + 0.08 * (row.scale ?? 1), z: attachPos.z } : null;
  return { id: row.id, name: row.subject ?? row.name ?? row.id, x: placed.x ?? 0, z: placed.z ?? 0, rot: placed.rot ?? 0, height: scaled(row), ...(eye ? { eye } : {}) };
}

export function register(registry, ports) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  registry.register({ ...declarations[0], available: () => true, run({ query, kind, mood }) {
    if (!query) return { affectedIds: [], summary: `${techniqueIndex({ kind, mood }).count} camera techniques.`, output: techniqueIndex({ kind, mood }) };
    const rows = searchTechniques(query, { kind, mood }).slice(0, 12);
    return { affectedIds: [], summary: `${rows.length} techniques match "${query}".`, output: { query, techniques: rows.map(entry => [entry.id, entry.kind, entry.moods.slice(0, 2).join(',')]) } };
  } });
  registry.register({ ...declarations[1], available: () => true, run({ id: asked }) {
    const resolved = describeTechnique(asked) ? asked : parseRequest(asked).stack[0]?.id;
    const output = resolved && describeTechnique(resolved);
    if (!output) fail('INVALID_ARGUMENT', `No camera technique matches "${asked}"; read camera.techniques for ids.`);
    return { affectedIds: [], summary: `${output.name} (${output.kind}).`, output };
  } });
  registry.register({ ...declarations[2], available: state => mounted() === true ? (state.characters?.some(row => !row.hidden) || 'Add a character first; a technique frames a character.') : mounted(),
    target: args => args.shotId, run(args, context) { return apply(args, context); } });
  registerRig(registry, ports);
  registerCoverage(registry, ports, { castRow });
  registerMotivation(registry, ports);
  registerDepth(registry, ports);

  function apply(args, context) {
    const view = ports.readView(), visible = view.characters.filter(row => !row.hidden), named = visible.map(row => ({ id: row.id, name: row.subject ?? row.name }));
    // Coverage and cut questions go to their own actions; composition words ride on this one.
    // One router (camera-coverage/route.js) for every request: a non-camera "shot" names no action.
    const routed = args.request ? routeCameraRequest(args.request, { cast: named, props: (view.objects ?? []).map(row => ({ id: row.id, name: row.name })) }) : null;
    if (routed?.action === 'none' && !args.stack && !args.composition) fail('INVALID_ARGUMENT', `No camera action in "${args.request}": ${routed.reason} (confidence ${routed.confidence}); name a technique (push-in, low angle, OTS), a coverage or a mood. Read camera.techniques.`);
    if (routed && !args.stack && routed.action !== 'camera.applyTechnique' && routed.action !== 'none') return context.run(routed.action, { ...routed.args, ...(args.shotId && ['camera.cover', 'camera.alignMove', 'camera.setLine'].includes(routed.action) ? { shotId: args.shotId } : {}), request: args.request });
    const parsed = routed?.action === 'camera.applyTechnique' ? { stack: routed.args.stack ?? [], subjectId: routed.args.subjectId, dropped: routed.dropped, matched: routed.resolved } : null;
    const composition = args.composition ?? routed?.args.composition;
    let shot = args.shotId ? owner().read().find(row => row.id === args.shotId) ?? fail('STALE_TARGET', `Shot ${args.shotId} is not in this scene.`)
      : shotAtFrame(owner().read(), view.view?.frame ?? ports.state().frame) ?? owner().read().find(row => row.id === view.selectedShotId);
    if (!shot && !owner().read().length) { context.run('shot.create'); shot = owner().read()[0]; }
    if (!shot) fail('AMBIGUOUS_TARGET', 'No shot owns the playhead; name one with shotId.');
    // Composition words alone re-place the subject in the shot's current stack.
    // A call with neither stack nor request (composition alone) reads as an empty request.
    const asked = parsed?.stack ?? [], reuse = !args.stack && !asked.length && composition ? currentTechnique(shot) : null, stack = args.stack ?? (reuse || composition && !asked.length ? reuse?.stack ?? [{ id: 'medium-shot' }] : asked);
    if (!stack.length) fail('INVALID_ARGUMENT', `No camera technique in "${args.request}"; name one (push-in, low angle, OTS) or a mood (uneasy, epic). Read camera.techniques.`);
    const subjectId = args.subjectId ?? parsed?.subjectId ?? routed?.args.subjectId ?? shot.coverage?.subjectId ?? (visible.some(row => row.id === view.activeCharacterId) ? view.activeCharacterId : visible[0]?.id);
    const rows = visible.map(row => castRow(row, shot, view.targets?.get?.(row.id)?.rig)), found = rows.find(row => row.id === subjectId) ?? fail('STALE_TARGET', `${subjectId} is not a visible character in this scene.`);
    const travel = composition ? travelAt(visible.find(row => row.id === subjectId), shot, Math.round((shot.startFrame + shot.endFrame) / 2)) : null, subject = travel ? { ...found, travel } : found;
    const camera = view.camera && { position: view.camera.position, lookAt: view.camera.lookAt, focalMm: view.camera.focalMm };
    const shared = Object.fromEntries(['speed', 'focalMm', 'direction', 'degrees', 'side'].filter(key => args[key] !== undefined).map(key => [key, args[key]])), side = shared.side ?? reuse?.side;
    if (side) shared.side = side;
    // A foreground (depth-staging A3) names a prop or cast member; the compiler frames past its world box.
    const wanted = composition?.foreground, near = wanted ? resolveNear(wanted.id, { props: propBoxes(view.objects, view.characters, { frame: shot.startFrame, bounds: ports.bounds }), cast: castBoxes(visible, shot, shot.startFrame) }) : null;
    if (wanted && (!near || near.id === subject.id)) fail(near ? 'INVALID_ARGUMENT' : 'STALE_TARGET', near ? `${near.name} is the subject; put another prop or character in the foreground.` : `No prop or character named "${wanted.id}" stands in this scene to put in the foreground.`);
    const placedComposition = near ? { ...composition, foreground: { ...wanted, id: near.id } } : composition;
    let plan;
    try { plan = compileStack(stack, { subject, cast: rows, shot, filmback: view.filmback, camera, ...(composition ? { composition: placedComposition } : {}), ...(near ? { foreground: near } : {}) }, shared); }
    catch (error) { fail(error.code ?? 'INVALID_ARGUMENT', error.message); }
    const still = shot.kind === 'still' && plan.keys?.length > 1, notes = [...plan.notes, ...(still ? ['a still holds one picture, so the move is stated in the prompt and the first framing is kept'] : [])];
    const keys = still ? plan.keys.slice(0, 1) : plan.keys;
    let checks = {};
    if (keys) {
      patch(shot.id, row => ({ ...row, cameraKeys: [] }));
      for (const key of keys) checks = context.run('shot.frame', { shotId: shot.id, subjectIds: plan.subjectIds, keyAtFrame: key.frame, framing: { exact: key.framing } }).checks ?? checks;
      patch(shot.id, row => ({ ...row, cameraKeys: row.cameraKeys.map(key => ({ ...key, ...(keys.find(planned => planned.frame === key.frame)?.ease ? { ease: keys.find(planned => planned.frame === key.frame).ease } : {}) })) }));
    }
    if (plan.rail) {
      const { points, height, aimHeight, focalMm, response } = plan.rail;
      context.run('shot.setCameraRail', { shotId: shot.id, points, height, aim: [subject.id], aimHeight, focalMm });
      if (response) patch(shot.id, row => ({ ...row, camera: { ...row.camera, followCam: { ...row.camera.followCam, response } } }));
    }
    // The capabilities this stack sets, and the ones the shot's previous stack set that this one no longer does (cleared).
    const capabilityPatch = { ...plan.capabilities };
    for (const field of shot.technique?.capabilities ?? []) if (!(field in capabilityPatch)) capabilityPatch[field] = null;
    if (Object.keys(capabilityPatch).length) context.run('camera.set', { shotId: shot.id, ...capabilityPatch });
    shot = owner().read().find(row => row.id === shot.id);
    const length = shot.endFrame - shot.startFrame + 1, readOpts = { fps: TIMELINE_FPS, height: subject.height, filmback: view.filmback };
    const move = plan.rail ? classifyRail(plan.rail, subject, length, readOpts) : shot.cameraKeys.length && keys ? classifyKeys(shot.cameraKeys, subject, readOpts) : null;
    const technique = { stack: plan.stack.map(row => ({ id: row.id, params: row.params })), label: plan.label, phrase: techniquePhrase(plan, still ? null : move),
      move: move?.id ?? '', promptOnly: plan.promptOnly.map(part => part.id), signature: techniqueSignature(shot), ...(Object.keys(plan.capabilities).length ? { capabilities: Object.keys(plan.capabilities) } : {}),
      ...(plan.composition ? { composition: { place: plan.composition.place, headroom: plan.composition.headroom, leadRoom: plan.composition.leadRoom, ...(plan.foreground ? { foreground: { id: plan.foreground.id, share: plan.foreground.share } } : {}) } } : {}), ...(side ? { side } : {}) };
    // Where the eyes landed, measured through every stored key.
    const placed = plan.composition && keys ? shot.cameraKeys.map(key => ({ frame: key.frame, ...measureComposition(key.framing, eyePoint(subject), view.filmback?.aspectRatio) })) : null;
    const castName = castId => (rows.find(row => row.id === castId)?.name ?? castId).split(',')[0], achieved = capabilityReadback(shot, capabilityScene(view, owner().state().frameCount), castName);
    patch(shot.id, row => ({ ...row, technique }));
    const verified = !plan.expectedMove || still || move?.id === plan.expectedMove;
    const warnings = [
      ...plan.promptOnly.map(part => ({ code: 'PROMPT_ONLY', id: part.id, message: `${part.name} needs ${part.requires.map(need => PLANNED_CAPABILITIES[need]).join(' and ')}; prompt only.`.slice(0, 120) })),
      ...notes.slice(0, 3).map(message => ({ code: 'TECHNIQUE_NOTE', message: message.slice(0, 120) })),
      ...(verified ? [] : [{ code: 'MOVE_MISMATCH', id: shot.id, message: `Expected ${plan.expectedMove}; the keys read back as ${move?.id ?? 'no move'}.` }]),
      ...(plan.members ?? []).filter(row => !row.inFrame).map(row => ({ code: 'OUT_OF_FRAME', id: row.id, message: `${row.id} is outside the group framing.` })),
      ...(parsed?.dropped ?? []).map(row => ({ code: 'TECHNIQUE_DROPPED', id: row.id, message: `"${row.phrase}" was left out: ${row.reason}.`.slice(0, 120) })),
    ];
    const said = [move ? `${move.label}${plan.expectedMove ? (verified ? ' (verified)' : ` (expected ${plan.expectedMove})`) : ''}` : null, ...achieved.words].filter(Boolean).join('; ') || 'prompt only';
    return { affectedIds: [shot.id], summary: `Applied ${plan.label} to ${shotLabel(shot)}: ${said}.`.slice(0, 240), warnings,
      checks: { technique: plan.label, ...achieved.checks, ...(plan.expectedMove ? { expectedMove: plan.expectedMove } : {}), ...(move ? { move: move.id, moveVerified: verified, fromSize: move.from.sizeLabel, toSize: move.to.sizeLabel } : {}),
        ...pick(checks, ['derivedSize', 'screenFraction', 'clipped', 'behindCamera', 'occluded', 'cameraSide']), ...(plan.members ? { membersInFrame: plan.members.filter(row => row.inFrame).length, members: plan.members.length } : {}),
        ...(placed ? { composition: plan.composition.label, screenX: placed[0].screenX, eyeLineY: placed[0].eyeLineY } : {}), ...(plan.foreground ? { foregroundShare: plan.foreground.measured } : {}) },
      output: { technique, subjectId: subject.id, keys: shot.cameraKeys.length, mode: shot.camera.mode, ...(parsed ? { resolved: parsed.matched, matched: routed.matched, confidence: routed.confidence } : {}),
        ...(placed ? { composition: { ...technique.composition, target: { screenX: (plan.composition.target.x + 1) / 2, eyeLineY: (1 - plan.composition.target.y) / 2 }, keys: placed } } : {}), ...(plan.foreground ? { foreground: plan.foreground } : {}) } };
  }
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
  const patch = (shotId, update) => owner().write(rows => rows.map(row => (row.id === shotId ? update(row) : row)));
}
