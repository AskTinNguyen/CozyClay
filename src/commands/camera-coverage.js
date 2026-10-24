// Camera coverage as Studio actions (camera-coverage): camera.cover lays a
// coverage pattern over a frame range as one undo entry (the range becomes one
// shot, cut at each pattern cut with cuts.js cutAtFrame, the function
// shot.split runs, because shot.split cuts at the live playhead, which a
// command cannot move synchronously in the studio; each shot is named and
// framed through shot.rename and camera.applyTechnique), camera.checkCuts reports the
// editing rules at every cut (read only), and camera.setTransition stores the
// transition into a shot. Registered by commands/camera.js.
import { createShot, cutAtFrame, shotAtFrame } from '../cuts.js';
import { checkCuts, CUT_RULES } from '../camera-coverage/cut-rules.js';
import { castAt, lineSide, shotCameraAt } from '../camera-coverage/cut-geometry.js';
import { planCoverage } from '../camera-coverage/plan.js';
import { COVERAGE_PATTERN_IDS, coveragePattern } from '../camera-coverage/patterns.js';
import { resolveCameraRequest } from '../camera-coverage/resolve.js';
import { COMPOSITION_PLACES, HEADROOMS, LEAD_ROOMS } from '../camera-coverage/composition.js';
import { repairTransition, repairTransitionOut, TRANSITION_FRAMES_MAX, TRANSITION_TYPES, transitionOutWords, transitionWords } from '../camera-coverage/transitions.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail, shotLabel } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const frame = { type: 'integer', minimum: 0 };
export const compositionSchema = input({ place: { type: 'string', enum: COMPOSITION_PLACES }, headroom: { type: 'string', enum: HEADROOMS }, leadRoom: { type: 'string', enum: LEAD_ROOMS } });
const RULE_CODES = { line: 'CUT_LINE', jump: 'CUT_JUMP', screen: 'CUT_SCREEN', eyeline: 'CUT_EYELINE' };

export const coverageDeclarations = [
  { id: 'camera.cover', label: 'Lay camera coverage', kind: 'mutation', undoDomain: 'shot',
    description: `Cover a scene with several shots at once, as one undo entry: pattern ${COVERAGE_PATTERN_IDS.join(' | ')} (or request: "cover this conversation", "master and coverage", "walk and talk", "reverse on Joon"), cast [A, B] (default the active character and the nearest other), over range { startFrame, endFrameExclusive } or the shot shotId names (default the shot under the playhead; the whole timeline when there are no shots). The range becomes the pattern's shots (split evenly, or at cuts [frames]; shots sets how many a repeating pattern lays), each named and framed with camera.applyTechnique, every camera on one side of the line between A and B. Answers each shot and camera.checkCuts on the new cuts.`,
    input: input({ pattern: { type: 'string', enum: COVERAGE_PATTERN_IDS }, request: { type: 'string', minLength: 1, maxLength: 300 }, cast: { type: 'array', items: id, minItems: 1, maxItems: 2 }, shotId: id,
      range: input({ startFrame: frame, endFrameExclusive: { type: 'integer', minimum: 1 } }, ['startFrame', 'endFrameExclusive']), shots: { type: 'integer', minimum: 2, maximum: 8 },
      cuts: { type: 'array', items: frame, minItems: 1, maxItems: 7 }, beat: { type: 'string', enum: ['insert', 'close-up'] }, side: { type: 'string', enum: ['left', 'right'] }, composition: compositionSchema }) },
  { id: 'camera.checkCuts', label: 'Check cuts', kind: 'job', domain: 'shot', timeoutMs: 10000, readOnly: true,
    description: `The editing rules at every cut between consecutive shots, measured from the cameras and the cast at the cut frames: ${CUT_RULES.join(', ')} (180-degree line crossings, jump cuts under 30 degrees and one size step, screen-direction flips of a moving subject, shot-reverse-shot eyelines). Each issue has a severity, the frames and a suggested fix; nothing changes. frame names one cut (the nearest), shotIds the cuts touching those shots, request a question ("is the cut at 96 crossing the line?").`,
    input: input({ frame, shotIds: { type: 'array', items: id, minItems: 1, maxItems: 32 }, request: { type: 'string', maxLength: 300 } }) },
  { id: 'camera.setTransition', label: 'Set cut transition', kind: 'mutation', undoDomain: 'shot',
    description: `The transition on the cut into a shot (shotId, or the shot that starts at cutFrame; default the shot under the playhead): type ${TRANSITION_TYPES.join(' | ')}; frames for a dissolve, fade or whip (the preview blends over them), offsetFrames for a J- or L-cut (an audio note), note. cut clears it. edge "out" with fade-to-black ends the sequence on black after the shot (the last shot, or one before a gap). It is written to OTIO as a transition (dissolve, fades, whip) or clip metadata, and stated in the prompt.`,
    input: input({ shotId: id, cutFrame: frame, type: { type: 'string', enum: TRANSITION_TYPES }, frames: { type: 'integer', minimum: 2, maximum: TRANSITION_FRAMES_MAX },
      offsetFrames: { type: 'integer', minimum: 1, maximum: TRANSITION_FRAMES_MAX }, note: { type: 'string', maxLength: 120 }, edge: { type: 'string', enum: ['in', 'out'] } }, ['type']) },
];

export function registerCoverage(registry, ports, { castRow }) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  const visible = () => ports.readView().characters.filter(row => !row.hidden);
  // The active character walks on its take root: sample it (ports.sampleStateAt) so a moving subject's screen direction is read.
  const placeAt = (row, shot, at) => castAt(ports.sampleStateAt?.(at)?.characters?.find(entry => entry.id === row.id) ?? row, shot, at);
  const scene = () => ({ cast: visible(), filmback: ports.readView().filmback, placeAt });
  const patch = (shotId, update) => owner().write(rows => rows.map(row => (row.id === shotId ? update(row) : row)));
  // A cut at a frame of the shot that holds it (cuts.js cutAtFrame keeps the upstream id); the keys are replaced when the shot is framed.
  const cutAt = (frame) => { const host = shotAtFrame(owner().read(), frame); if (host && host.startFrame < frame) owner().write(rows => cutAtFrame(rows, host.id, frame, host.cameraKeys[0]?.framing ?? { pos: { x: 0, y: 1.6, z: 5 }, yaw: 0, pitch: 0, fovDeg: 40 })); };
  const issueWarnings = cuts => cuts.flatMap(cut => cut.issues.map(issue => ({ code: RULE_CODES[issue.rule], id: cut.to, message: `Cut at ${cut.cutFrame}: ${issue.message}`.slice(0, 120) }))).slice(0, 10);

  registry.register({ ...coverageDeclarations[0], target: args => args.shotId,
    available: state => (mounted() === true ? state.characters?.some(row => !row.hidden) || 'Add a character first; coverage frames the cast.' : mounted()),
    run(args, context) { return cover(args, context); } });
  registry.register({ ...coverageDeclarations[1], available: state => (mounted() === true ? state.shots.length > 1 || 'There is no cut yet: coverage needs two shots or more.' : mounted()),
    run(args) { return check(args); } });
  registry.register({ ...coverageDeclarations[2], target: args => args.shotId,
    available: state => (mounted() === true ? state.shots.length > 0 || 'There are no shots yet; add one with shot.create.' : mounted()), run(args) { return setTransition(args); } });

  /** The frame range camera.cover lays over: the range asked for, the named shot, the playhead's, or the whole timeline. */
  function rangeFor(args) {
    const rows = owner().read(), { frameCount } = owner().state(), view = ports.readView();
    if (args.range) return { startFrame: args.range.startFrame, endFrame: args.range.endFrameExclusive - 1 };
    const shot = args.shotId ? rows.find(row => row.id === args.shotId) ?? fail('STALE_TARGET', `Shot ${args.shotId} is not in this scene.`)
      : shotAtFrame(rows, view.view?.frame ?? ports.state().frame) ?? rows.find(row => row.id === view.selectedShotId);
    if (shot) return { startFrame: shot.startFrame, endFrame: shot.endFrame };
    if (!rows.length) return { startFrame: 0, endFrame: frameCount - 1 };
    return fail('AMBIGUOUS_TARGET', 'No shot owns the playhead; give range { startFrame, endFrameExclusive } or shotId.');
  }

  /** Which side of the A-B line the shot just before the range keeps (+1 / -1), or 0 when there is none to match. */
  function neighbourSide(range, people, aId, bId) {
    const before = owner().read().find(row => row.endFrame === range.startFrame - 1 && row.kind !== 'still'), a = people.find(row => row.id === aId);
    const b = people.find(row => row.id === bId) ?? people.filter(row => row.id !== aId).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
    const camera = before && a && b && shotCameraAt(before, before.endFrame, scene());
    if (!camera) return 0;
    const side = lineSide(camera.pos, castAt(a, before, before.endFrame), { x: b.x - a.x, z: b.z - a.z });
    return Math.abs(side) > 0.2 ? Math.sign(side) : 0;
  }

  /** Make [start, end] exactly one clip shot through the shot commands, and answer its id. */
  function oneShot(range, context) {
    const { startFrame, endFrame } = range, inside = () => owner().read().filter(row => row.startFrame <= endFrame && row.endFrame >= startFrame);
    const overlapping = inside(), container = overlapping.length === 1 && overlapping[0].startFrame <= startFrame && overlapping[0].endFrame >= endFrame ? overlapping[0] : null;
    if (container) {
      cutAt(startFrame);
      cutAt(endFrame + 1);
      return shotAtFrame(owner().read(), startFrame).id;
    }
    const across = overlapping.find(row => row.startFrame < startFrame || row.endFrame > endFrame);
    if (across) fail('INVALID_RANGE', `The range ${startFrame}-${endFrame} cuts across ${shotLabel(across)}; cover inside one shot or over whole shots.`);
    for (const row of overlapping) context.run('shot.remove', { shotId: row.id });
    const created = createShot(`Shot ${owner().read().length + 1}`, startFrame, endFrame);
    owner().write(rows => [...rows, created].sort((a, b) => a.startFrame - b.startFrame));
    return created.id;
  }

  function cover(args, context) {
    if (ports.storeDomain?.('scenes')?.metadata?.().previsMode === 'storyboard') fail('TARGET_NOT_READY', 'Coverage lays clip shots; switch the scene out of storyboard mode first.');
    const view = ports.readView(), people = visible(), named = people.map(row => ({ id: row.id, name: row.subject ?? row.name }));
    const routed = args.request && !args.pattern ? resolveCameraRequest(args.request, { cast: named }) : null;
    if (args.request && !args.pattern && routed?.action !== 'camera.cover') fail('INVALID_ARGUMENT', `No coverage pattern in "${args.request}"; name one of ${COVERAGE_PATTERN_IDS.join(', ')}.`);
    const pattern = args.pattern ?? routed.args.pattern, castIds = args.cast ?? routed?.args.cast ?? [];
    const first = castIds[0] ?? (people.some(row => row.id === view.activeCharacterId) ? view.activeCharacterId : people[0]?.id);
    const range = rangeFor(args), { frameCount } = owner().state();
    if (range.endFrame >= frameCount || range.endFrame < range.startFrame) fail('INVALID_RANGE', `The range ${range.startFrame}-${range.endFrame} is outside the ${frameCount}-frame timeline.`);
    const container = shotAtFrame(owner().read(), range.startFrame), rows = people.map(row => castRow(row, container, view.targets?.get?.(row.id)?.rig));
    let plan;
    const lineSign = args.side ? 0 : neighbourSide(range, people, first, castIds[1]);
    try { plan = planCoverage(pattern, { cast: rows, subjects: [first, castIds[1]], range, lineSign, filmback: view.filmback, count: args.shots, cuts: args.cuts, beat: args.beat, side: args.side, composition: args.composition }); }
    catch (error) { fail(error.code ?? 'INVALID_ARGUMENT', error.message); }
    const laidId = oneShot(range, context);
    for (const shot of plan.shots.slice(1)) cutAt(shot.startFrame);
    const laid = [], warnings = [];
    for (const shot of plan.shots) {
      const target = shotAtFrame(owner().read(), shot.startFrame);
      context.run('shot.rename', { shotId: target.id, name: shot.name });
      const applied = context.run('camera.applyTechnique', { shotId: target.id, subjectId: shot.subjectId, stack: shot.stack, side: shot.side, ...(args.composition && shot.plan.composition ? { composition: args.composition } : {}) });
      patch(target.id, row => ({ ...row, coverage: { pattern: plan.pattern, index: shot.index, role: shot.role, subjectId: shot.subjectId } }));
      for (const warning of applied.warnings ?? []) if (warning.code !== 'TECHNIQUE_NOTE') warnings.push({ ...warning, id: target.id });
      laid.push({ id: target.id, name: shot.name, startFrame: shot.startFrame, endFrame: shot.endFrame, subjectId: shot.subjectId, technique: applied.checks?.technique, move: applied.checks?.move });
    }
    const ids = new Set(laid.map(row => row.id)), cuts = checkCuts(owner().read(), scene()).cuts.filter(cut => ids.has(cut.from) || ids.has(cut.to));
    const issues = cuts.reduce((sum, cut) => sum + cut.issues.length, 0), name = coveragePattern(plan.pattern).name;
    return { affectedIds: [laidId, ...ids].filter((value, i, all) => all.indexOf(value) === i),
      summary: `Laid ${name} over ${range.startFrame}-${range.endFrame}: ${laid.map(row => row.name.replace(/^\S+ \d+ · /, '')).join(', ')}; ${issues ? `${issues} cut issue${issues === 1 ? '' : 's'}` : 'every cut clean'}.`.slice(0, 240),
      warnings: [...issueWarnings(cuts), ...warnings, ...plan.notes.map(message => ({ code: 'COVERAGE_NOTE', message: message.slice(0, 120) }))].slice(0, 12),
      checks: { pattern: plan.pattern, shots: laid.length, cuts: cuts.length, issues, lineSide: plan.lineSide },
      output: { pattern: plan.pattern, subjects: plan.subjects, lineSide: plan.lineSide, shots: laid, cuts: cuts.map(compactCut), ...(routed ? { resolved: routed.via } : {}) } };
  }

  function check(args) {
    const routed = args.request ? resolveCameraRequest(args.request) : null, at = args.frame ?? routed?.args.frame;
    let { cuts } = checkCuts(owner().read(), scene());
    if (args.shotIds) cuts = cuts.filter(cut => args.shotIds.includes(cut.from) || args.shotIds.includes(cut.to));
    if (Number.isInteger(at) && cuts.length) cuts = [cuts.reduce((best, cut) => (Math.abs(cut.cutFrame - at) < Math.abs(best.cutFrame - at) ? cut : best))];
    const issues = cuts.reduce((sum, cut) => sum + cut.issues.length, 0), flagged = cuts.filter(cut => cut.issues.length);
    const said = flagged.slice(0, 2).map(cut => `cut at ${cut.cutFrame}: ${cut.issues.map(issue => issue.message).join(' ')}`).join(' ');
    return { affectedIds: [], summary: `${cuts.length} cut${cuts.length === 1 ? '' : 's'} checked: ${issues ? said : 'no rule broken'}`.slice(0, 240), warnings: issueWarnings(cuts),
      checks: { cuts: cuts.length, issues }, output: { cuts: cuts.map(compactCut), rules: CUT_RULES } };
  }

  function setTransition({ shotId, cutFrame, type, frames, offsetFrames, note, edge = 'in' }) {
    const rows = owner().read(), view = ports.readView();
    const shot = shotId ? rows.find(row => row.id === shotId) ?? fail('STALE_TARGET', `Shot ${shotId} is not in this scene.`)
      : Number.isInteger(cutFrame) ? rows.find(row => row.startFrame === cutFrame) ?? fail('STALE_TARGET', `No shot starts at frame ${cutFrame}; a cut sits on a shot's first frame.`)
        : shotAtFrame(rows, view.view?.frame ?? ports.state().frame) ?? fail('AMBIGUOUS_TARGET', 'No shot owns the playhead; name one with shotId or cutFrame.');
    if (edge === 'out') return setEnding(shot, rows, type, frames);
    const transition = repairTransition({ type, frames, offsetFrames, note });
    patch(shot.id, row => { const next = { ...row }; delete next.transition; return transition ? { ...next, transition } : next; });
    const previous = rows.filter(row => row.kind !== 'still' && row.endFrame < shot.startFrame).sort((a, b) => b.endFrame - a.endFrame)[0];
    const warnings = [...(!previous && type !== 'fade-from-black' && transition ? [{ code: 'NO_PREVIOUS_SHOT', id: shot.id, message: `${shot.name} is the first shot; only a fade from black has something to come from.` }] : []),
      ...(previous && previous.endFrame + 1 !== shot.startFrame && transition ? [{ code: 'GAP_BEFORE_CUT', id: shot.id, message: `${shot.startFrame - previous.endFrame - 1} free frames sit before ${shot.name}; the preview blends only adjacent shots.` }] : [])];
    return { affectedIds: [shot.id], summary: `Transition into ${shotLabel(shot)} at frame ${shot.startFrame}: ${transition ? transitionWords(transition) : 'a straight cut'}.`.slice(0, 240), warnings,
      output: { shotId: shot.id, cutFrame: shot.startFrame, transition } };
  }
  // The end of a sequence: a fade to black after a shot nothing cuts out of (shot.transitionOut).
  function setEnding(shot, rows, type, frames) {
    if (type !== 'fade-to-black' && type !== 'cut') fail('INVALID_ARGUMENT', 'edge "out" takes fade-to-black (or cut to clear it).');
    const next = rows.find(row => row.kind !== 'still' && row.startFrame === shot.endFrame + 1);
    if (next && type !== 'cut') fail('INVALID_ARGUMENT', `${next.name} follows ${shot.name}; fade to black on the cut into it instead (camera.setTransition { shotId: "${next.id}", type: "fade-to-black" }).`);
    const transitionOut = type === 'cut' ? null : repairTransitionOut({ type, frames });
    patch(shot.id, row => { const copy = { ...row }; delete copy.transitionOut; return transitionOut ? { ...copy, transitionOut } : copy; });
    return { affectedIds: [shot.id], summary: `End of ${shotLabel(shot)}: ${transitionOut ? transitionOutWords(transitionOut) : 'a straight cut out'}.`.slice(0, 240), output: { shotId: shot.id, transitionOut } };
  }
}

/** A cut for a receipt: frames, shots, issues and the measures behind them (bounded). */
function compactCut(cut) {
  return { cutFrame: cut.cutFrame, from: cut.from, to: cut.to, fromName: cut.fromName, toName: cut.toName, issues: cut.issues.map(issue => ({ rule: issue.rule, severity: issue.severity, message: issue.message, frames: issue.frames, fix: issue.fix.text })),
    measures: cut.measures, ...(cut.unjudged ? { unjudged: cut.unjudged } : {}), ...(cut.gapFrames ? { gapFrames: cut.gapFrames } : {}) };
}
