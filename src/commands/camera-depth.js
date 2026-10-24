// Depth staging as Studio actions (depth-staging): camera.checkShots reads
// every shot's camera against the set over sampled frames (occluded, inside,
// crop; read only, the report shape camera.checkCuts has, decision D1) with
// each shot's depth layers, and camera.fixShot applies one issue's suggested
// camera change to a shot's keys as one undo entry. Only the camera moves.
// Registered by commands/camera.js.
import { checkShots, SHOT_RULES } from '../camera-depth/shot-checks.js';
import { movedCamera } from '../camera-depth/fixes.js';
import { depthWords } from '../camera-depth/layers.js';
import { castAt } from '../camera-coverage/cut-geometry.js';
import { eyePoint } from '../camera-coverage/composition.js';
import { routeCameraRequest } from '../camera-coverage/route.js';
import { shotAtFrame } from '../cuts.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail, shotLabel } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const RULE = { type: 'string', enum: SHOT_RULES };
const CODES = { occluded: 'SHOT_OCCLUDED', inside: 'SHOT_INSIDE', crop: 'SHOT_CROP' };

export const depthDeclarations = [
  { id: 'camera.checkShots', label: 'Check shots', kind: 'job', domain: 'shot', timeoutMs: 10000, readOnly: true,
    description: `What each shot's camera does with the set, over its first and last frame and every k frames: ${SHOT_RULES.join(', ')} (the subject's eyes hidden by a prop or another person at either end or on over a quarter of the samples; the lens inside a prop or nearer than the 10 cm near clip; a frame edge at the ankle, knee, waist or neck). Each issue has a severity, the frames and a fix (raise or lower by d m, slide left or right by d m, change size one step) camera.fixShot applies; each shot lists its depth layers (cast and props in the foreground, midground and background). Nothing changes. shotIds narrows it, rule keeps one rule, request a question ("is anything blocking her face?", "is the camera inside the wall?").`,
    input: input({ shotIds: { type: 'array', items: id, minItems: 1, maxItems: 64 }, rule: RULE, request: { type: 'string', maxLength: 300 } }) },
  { id: 'camera.fixShot', label: 'Fix shot camera', kind: 'mutation', undoDomain: 'shot',
    description: 'Apply the camera change camera.checkShots suggests for one issue of a shot (shotId, default the shot under the playhead; rule picks the issue, default its first): every camera key moves by the fix\'s offset and keeps its aim, as one undo entry; props and cast never move. Answers the shot checked again. A rail or follow shot is refused (move its rail).',
    input: input({ shotId: id, rule: RULE }) },
];

/** One shot's report for a receipt: issues with their fix and the layers by name (bounded). */
function compactShot(row) {
  const names = band => row.layers?.[band]?.map(entry => entry.name) ?? [];
  return { shotId: row.shotId, name: row.name, subjectId: row.subjectId, frames: row.frames.length,
    issues: row.issues.map(issue => ({ rule: issue.rule, severity: issue.severity, message: issue.message, frames: issue.frames, fix: { kind: issue.fix.kind, text: issue.fix.text, ...(issue.fix.delta ? { delta: issue.fix.delta } : {}) }, ...(issue.by ? { by: issue.by } : {}), ...(issue.joint ? { joint: issue.joint } : {}) })),
    layers: { foreground: names('foreground'), midground: names('midground'), background: names('background'), words: depthWords(row.layers, row.subjectName) }, ...(row.unjudged ? { unjudged: row.unjudged } : {}) };
}

export function registerDepth(registry, ports) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  const visible = () => ports.readView().characters.filter(row => !row.hidden);
  const placeAt = (row, shot, at) => castAt(ports.sampleStateAt?.(at)?.characters?.find(entry => entry.id === row.id) ?? row, shot, at);
  const scene = () => { const view = ports.readView(); return { cast: visible(), objects: view.objects ?? [], filmback: view.filmback, placeAt, bounds: ports.bounds }; };
  const ready = state => (mounted() === true ? state.shots.length > 0 || 'There are no shots yet; shots are checked against the set.' : mounted());
  registry.register({ ...depthDeclarations[0], available: ready, run(args) { return check(args); } });
  registry.register({ ...depthDeclarations[1], target: args => args.shotId, available: ready, run(args) { return fix(args); } });

  function check(args) {
    const routed = args.request ? routeCameraRequest(args.request) : null, rule = args.rule ?? (routed?.action === 'camera.checkShots' ? routed.args.rule : undefined);
    const rows = owner().read();
    for (const shotId of args.shotIds ?? []) if (!rows.some(row => row.id === shotId)) fail('STALE_TARGET', `Shot ${shotId} is not in this scene.`);
    const report = checkShots(rows, scene(), { rule, shotIds: args.shotIds });
    const flagged = report.shots.filter(row => row.issues.length), said = flagged.slice(0, 2).map(row => `${row.name}: ${row.issues.map(issue => issue.message).join(' ')}`).join(' ');
    return { affectedIds: [], summary: `${report.shots.length} shot${report.shots.length === 1 ? '' : 's'} checked${rule ? ` for ${rule}` : ''}: ${report.issueCount ? said : 'nothing blocks a face, no lens in the set, no edge at a joint'}`.slice(0, 240),
      warnings: flagged.flatMap(row => row.issues.map(issue => ({ code: CODES[issue.rule], id: row.shotId, message: `${row.name}: ${issue.message}`.slice(0, 120) }))).slice(0, 12),
      checks: { shots: report.shots.length, issues: report.issueCount, flagged: report.flagged, ...(routed?.action === 'camera.checkShots' ? { matched: routed.matched, confidence: routed.confidence } : {}) },
      output: { rules: SHOT_RULES, ...(rule ? { rule } : {}), shots: report.shots.map(compactShot), ...(routed?.action === 'camera.checkShots' ? { matched: routed.matched, confidence: routed.confidence } : {}) } };
  }

  function fix({ shotId, rule }) {
    const rows = owner().read(), view = ports.readView();
    const shot = shotId ? rows.find(row => row.id === shotId) ?? fail('STALE_TARGET', `Shot ${shotId} is not in this scene.`)
      : shotAtFrame(rows, view.view?.frame ?? ports.state().frame) ?? fail('AMBIGUOUS_TARGET', 'No shot owns the playhead; name one with shotId.');
    if (shot.camera?.mode === 'rail' || shot.camera?.mode === 'follow' || !shot.cameraKeys?.length) fail('TARGET_NOT_READY', `${shotLabel(shot)} has no camera keys to move; move its rail or key it with shot.frame.`);
    const [before] = checkShots([shot], scene()).shots, issue = before.issues.find(row => !rule || row.rule === rule);
    if (!issue) return fail('TARGET_NOT_READY', `${shotLabel(shot)} has no ${rule ?? 'shot check'} issue to fix.`);
    if (!issue.fix.delta) fail('INVALID_ARGUMENT', `No camera move clears it here: ${issue.fix.text}.`);
    const subject = visible().find(row => row.id === before.subjectId), aspect = view.filmback?.aspectRatio;
    owner().write(list => list.map(row => (row.id !== shot.id ? row : { ...row, cameraKeys: row.cameraKeys.map(key => ({ ...key, framing: { ...key.framing, ...movedCamera(key.framing, issue.fix.delta, eyePoint(castAt(subject, row, key.frame)), aspect) } })) })));
    const [after] = checkShots([owner().read().find(row => row.id === shot.id)], scene()).shots;
    return { affectedIds: [shot.id], summary: `${shotLabel(shot)}: ${issue.fix.text} for ${issue.rule}; checked again, ${after.issues.length ? after.issues.map(row => row.rule).join(', ') : 'clean'}.`.slice(0, 240),
      checks: { issues: after.issues.length }, output: { shotId: shot.id, fixed: { rule: issue.rule, fix: issue.fix }, after: compactShot(after) } };
  }
}
