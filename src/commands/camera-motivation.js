// Camera motivation as Studio actions (camera-motivation): story.addBeat,
// story.moveBeat and story.removeBeat author the story beats on the shot
// document (each one undo entry), camera.checkMotivation reports every move's
// reason (read only), and camera.alignMove retimes one move so it starts or
// settles on a beat (one undo entry). Registered by commands/camera.js.
import { shotAtFrame } from '../cuts.js';
import { castAt } from '../camera-coverage/cut-geometry.js';
import { alignSegment } from '../camera-motivation/align.js';
import { checkMotivation, DEFAULT_TOLERANCE, MOTIVATION_RULES, shotBeats } from '../camera-motivation/check.js';
import { resolveMotivationRequest } from '../camera-motivation/resolve.js';
import { moveSegments } from '../camera-motivation/segments.js';
import { findStoryBeat, nextStoryBeatId, repairStoryBeats, STORY_BEAT_KINDS, STORY_BEAT_MAX, storyBeatWords } from '../camera-motivation/story-beats.js';
import { engineScene } from '../shot-prompt-engine/measure.js';
import { studioSequenceDocument } from '../sequence-prompt-studio.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail, shotLabel } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const frame = { type: 'integer', minimum: 0 }, request = { type: 'string', minLength: 1, maxLength: 300 };
const label = { type: 'string', minLength: 1, maxLength: 80 }, ref = { oneOf: [{ type: 'string', minLength: 1, maxLength: 80 }, frame] };
const KINDS = STORY_BEAT_KINDS.join(' | ');

export const motivationDeclarations = [
  { id: 'story.addBeat', label: 'Add story beat', kind: 'mutation', undoDomain: 'shot',
    description: `Mark a story beat the cast's motion cannot show (a line, a reveal, a decision) at a timeline frame, as one undo entry: frame, label ("Mara makes her admission"), kind ${KINDS} (default event); or request ("add a beat 'confession' at 120"). Beats are drawn on the timeline, written to OTIO as markers, named in the sequence brief, and motivate camera moves (camera.checkMotivation).`,
    input: input({ frame, label, kind: { type: 'string', enum: STORY_BEAT_KINDS }, request }) },
  { id: 'story.moveBeat', label: 'Move story beat', kind: 'mutation', undoDomain: 'shot',
    description: 'Move a story beat (beat: its id, its label, or a frame near it) to frame, as one undo entry; label and kind rename or re-kind it.',
    input: input({ beat: ref, frame, label, kind: { type: 'string', enum: STORY_BEAT_KINDS }, request }) },
  { id: 'story.removeBeat', label: 'Remove story beat', kind: 'mutation', undoDomain: 'shot',
    description: 'Remove a story beat (beat: its id, its label, or a frame near it), as one undo entry.', input: input({ beat: ref, request }) },
  { id: 'camera.checkMotivation', label: 'Check camera motivation', kind: 'job', domain: 'shot', timeoutMs: 15000, readOnly: true,
    description: `Why each camera move happens, measured from every shot's camera: each move segment is motivated by a beat (a story beat, or a motion beat of an installed take: steps, turns, reaches, jumps, landings), by its subject (a follow cam, a mount, a tracking rail, or a camera that keeps a travelling subject on screen), or unmotivated. Holds are never flagged. Issues: ${MOTIVATION_RULES.join(', ')} (the beat is more than tolerance frames, default ${DEFAULT_TOLERANCE}, from the move's start or rest), each with a severity, the frames and a fix ("hold", "start the push at f120 on 'admission'", camera.alignMove args). Nothing changes. shotIds narrows it; request a question ("is this move motivated?").`,
    input: input({ shotIds: { type: 'array', items: id, minItems: 1, maxItems: 32 }, tolerance: { type: 'integer', minimum: 1, maximum: 48 }, request: { type: 'string', maxLength: 300 } }) },
  { id: 'camera.alignMove', label: 'Align move to beat', kind: 'mutation', undoDomain: 'shot',
    description: 'Retime one camera move so it starts (edge start) or comes to rest (edge settle) on a beat, as one undo entry: beat is a story beat (id or label, or its kind: "the reveal") or a frame (a motion beat\'s frame, as camera.checkMotivation names it); shotId defaults to the shot holding the beat, segment to the move nearest it, edge to the one the check flags. The move\'s camera keys and rig keys keep their poses and length (squeezed at a shot edge); a rail or follow camera is refused. Or request ("start the push on the reveal"). Answers the re-check.',
    input: input({ shotId: id, beat: ref, edge: { type: 'string', enum: ['start', 'settle'] }, segment: { type: 'integer', minimum: 0, maximum: 31 }, request }) },
];

export function registerMotivation(registry, ports) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  const beats = () => owner().state().storyBeats ?? [];
  const writeBeats = list => owner().writeState(before => ({ ...before, storyBeats: repairStoryBeats(list, before.frameCount) }));
  const routed = (args, actions) => { const hit = args.request ? resolveMotivationRequest(args.request) : null; return hit && actions.includes(hit.action) ? hit : null; };
  const said = hit => (hit ? { resolved: hit.via, matched: hit.matched, confidence: hit.confidence } : {});
  const beatOf = refValue => findStoryBeat(beats(), refValue) ?? fail('STALE_TARGET', `No story beat matches ${JSON.stringify(refValue)}; ${beats().length ? `the beats are ${beats().map(storyBeatWords).join(', ')}` : 'there are none yet (story.addBeat)'}.`);
  // The document the check reads: the studio's sequence document (installed takes compiled once), the shot list and its beats.
  const document = () => ({ ...studioSequenceDocument(ports.readView()), shots: owner().read(), storyBeats: beats(), frameCount: owner().state().frameCount });
  const placeAt = (row, shot, at) => castAt(ports.sampleStateAt?.(at)?.characters?.find(entry => entry.id === row.id) ?? row, shot, at);
  // A beat belongs to the scene: its receipt reads the scene back.
  const scene = () => [ports.readView().host.sceneId];
  const available = state => mounted() === true ? (state.shots.length > 0 || 'There are no shots yet; add one with shot.create.') : mounted();

  registry.register({ ...motivationDeclarations[0], available: () => mounted(), run(args) {
    const hit = routed(args, ['story.addBeat']), at = args.frame ?? hit?.args.frame, text = args.label ?? hit?.args.label, frameCount = owner().state().frameCount;
    if (!Number.isInteger(at) || !text) fail('INVALID_ARGUMENT', 'A story beat needs a frame and a label ("add a beat \'confession\' at 120").');
    if (at >= frameCount) fail('INVALID_RANGE', `Frame ${at} is past the ${frameCount}-frame timeline.`);
    if (beats().length >= STORY_BEAT_MAX) fail('INVALID_ARGUMENT', `A scene holds at most ${STORY_BEAT_MAX} story beats.`);
    const beat = { id: nextStoryBeatId(beats()), frame: at, label: text, kind: args.kind ?? hit?.args.kind ?? 'event' };
    writeBeats([...beats(), beat]);
    const stored = beats().find(row => row.id === beat.id);
    return { affectedIds: scene(), summary: `Story beat ${storyBeatWords(stored)}.`, output: { beat: stored, beats: beats(), ...said(hit) } };
  } });
  registry.register({ ...motivationDeclarations[1], available: () => (mounted() === true ? beats().length > 0 || 'There are no story beats yet; add one with story.addBeat.' : mounted()), run(args) {
    const hit = routed(args, ['story.moveBeat']), beat = beatOf(args.beat ?? hit?.args.beat), at = args.frame ?? hit?.args.frame ?? beat.frame;
    if (at >= owner().state().frameCount) fail('INVALID_RANGE', `Frame ${at} is past the timeline.`);
    writeBeats(beats().map(row => (row.id === beat.id ? { ...row, frame: at, ...(args.label ? { label: args.label } : {}), ...(args.kind ? { kind: args.kind } : {}) } : row)));
    const stored = beats().find(row => row.id === beat.id);
    return { affectedIds: scene(), summary: `Story beat ${storyBeatWords(stored)} (was f${beat.frame}).`, output: { beat: stored, from: beat.frame, ...said(hit) } };
  } });
  registry.register({ ...motivationDeclarations[2], available: () => (mounted() === true ? beats().length > 0 || 'There are no story beats to remove.' : mounted()), run(args) {
    const hit = routed(args, ['story.removeBeat']), beat = beatOf(args.beat ?? hit?.args.beat);
    writeBeats(beats().filter(row => row.id !== beat.id));
    return { affectedIds: scene(), summary: `Removed the story beat ${storyBeatWords(beat)}.`, output: { removed: beat, ...said(hit) } };
  } });
  registry.register({ ...motivationDeclarations[3], available, run(args) { return check(args); } });
  registry.register({ ...motivationDeclarations[4], available, target: args => args.shotId, run(args) { return align(args); } });

  function check(args) {
    const hit = routed(args, ['camera.checkMotivation']), result = checkMotivation(document(), { tolerance: args.tolerance, shotIds: args.shotIds, placeAt });
    const flagged = result.issues.slice(0, 2).map(issue => `${issue.message} Fix: ${issue.fix.text}.`).join(' ');
    return { affectedIds: [], summary: `${result.segments} move${result.segments === 1 ? '' : 's'} in ${result.shots.length} shot${result.shots.length === 1 ? '' : 's'} checked against ${result.sources.join(', ')}: ${result.issueCount ? flagged : 'every move has its reason'}`.slice(0, 240),
      warnings: result.issues.slice(0, 10).map(issue => ({ code: `MOVE_${issue.rule.toUpperCase().replaceAll('-', '_')}`, id: issue.shotId, message: issue.message.slice(0, 120) })),
      checks: { shots: result.shots.length, issues: result.issueCount }, output: { ...compact(result), ...said(hit) } };
  }

  function align(args) {
    const hit = routed(args, ['camera.alignMove']), doc = document(), refValue = args.beat ?? hit?.args.beat;
    if (refValue === undefined) fail('INVALID_ARGUMENT', 'Name the beat to align to: a story beat\'s id or label, or a frame.');
    const story = typeof refValue === 'string' ? findStoryBeat(beats(), refValue) ?? beats().find(row => row.kind === refValue.toLowerCase().replace(/^the /, '')) : null;
    const rows = owner().read(), playhead = ports.readView().view?.frame ?? ports.state().frame;
    const nearFrame = story?.frame ?? (Number.isInteger(refValue) ? refValue : null);
    const shot = args.shotId ? rows.find(row => row.id === args.shotId) ?? fail('STALE_TARGET', `Shot ${args.shotId} is not in this scene.`)
      : shotAtFrame(rows, nearFrame ?? playhead) ?? shotAtFrame(rows, playhead) ?? fail('AMBIGUOUS_TARGET', 'No shot holds that beat or the playhead; name one with shotId.');
    const motion = nearFrame === null ? shotBeats(doc, shot).find(row => row.source === 'motion' && (row.name.includes(String(refValue).toLowerCase()) || row.label.toLowerCase().includes(String(refValue).toLowerCase()))) : null;
    const target = story ? { frame: story.frame, name: `'${story.label}'` } : motion ? { frame: motion.frame, name: motion.name } : Number.isInteger(refValue) ? { frame: refValue, name: `f${refValue}` }
      : fail('STALE_TARGET', `No story beat or motion beat matches "${refValue}"; ${beats().length ? `the story beats are ${beats().map(storyBeatWords).join(', ')}` : 'add one with story.addBeat'}.`);
    const { segments, unmeasured } = moveSegments(engineScene(doc), shot);
    if (unmeasured) fail('TARGET_NOT_READY', `${shotLabel(shot)} is a follow camera with no baked track; it moves with its subject.`);
    if (!segments.length) fail('TARGET_NOT_READY', `${shotLabel(shot)} holds still: there is no move to align.`);
    const segment = Number.isInteger(args.segment) ? segments[args.segment] ?? fail('INVALID_ARGUMENT', `${shot.name} has ${segments.length} move(s); segment ${args.segment} is not one.`)
      : [...segments].sort((a, b) => Math.min(Math.abs(a.startFrame - target.frame), Math.abs(a.endFrame - target.frame)) - Math.min(Math.abs(b.startFrame - target.frame), Math.abs(b.endFrame - target.frame)))[0];
    const flagged = checkMotivation(doc, { shotIds: [shot.id], placeAt }).issues.find(issue => issue.segment === segment.index && issue.beat?.frame === target.frame);
    const edge = args.edge ?? hit?.args.edge ?? (flagged?.rule === 'settles-off-beat' ? 'settle' : 'start');
    let aligned;
    try { aligned = alignSegment(shot, segment, segments, target.frame, edge); } catch (error) { fail(error.code ?? 'INVALID_ARGUMENT', error.message); }
    owner().write(list => list.map(row => (row.id === shot.id ? aligned.shot : row)));
    const after = checkMotivation(document(), { shotIds: [shot.id], placeAt });
    return { affectedIds: [shot.id], summary: `${edge === 'settle' ? 'Settled' : 'Started'} the move in ${shotLabel(shot)} on ${target.name} at f${target.frame}: f${aligned.from.join('-')} -> f${aligned.to.join('-')}; ${after.issueCount ? `${after.issueCount} issue(s) left` : 're-check clean'}.`.slice(0, 240),
      warnings: after.issues.slice(0, 6).map(issue => ({ code: `MOVE_${issue.rule.toUpperCase().replaceAll('-', '_')}`, id: shot.id, message: issue.message.slice(0, 120) })),
      checks: { issues: after.issueCount },
      output: { shotId: shot.id, edge, beat: target, segment: segment.index, from: aligned.from, to: aligned.to, keys: aligned.keys, rigKeys: aligned.rigKeys, recheck: compact(after).shots, ...said(hit) } };
  }
}

/** The check for a receipt: per shot, each move with its reason and issues (bounded). */
function compact(result) {
  return { tolerance: result.tolerance, sources: result.sources, issueCount: result.issueCount, shots: result.shots.slice(0, 24).map(shot => ({ shotId: shot.shotId, shotName: shot.shotName, ...(shot.follow ? { follow: true } : {}),
    moves: shot.segments.map(segment => ({ index: segment.index, startFrame: segment.startFrame, endFrame: segment.endFrame, move: segment.moveId,
      motivation: segment.motivation.by ? { by: segment.motivation.by, ...(segment.motivation.beat ? { beat: { frame: segment.motivation.beat.frame, name: segment.motivation.beat.name, source: segment.motivation.beat.source } } : {}), ...(segment.motivation.how ? { how: segment.motivation.how } : {}) } : null,
      issues: segment.issues.map(issue => ({ rule: issue.rule, severity: issue.severity, frames: issue.frames, message: issue.message, fix: issue.fix.text, ...(issue.fix.action ? { fixAction: issue.fix.action, fixArgs: issue.fix.args } : {}) })) })) })) };
}
