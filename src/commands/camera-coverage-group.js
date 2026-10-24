// Group coverage as Studio actions (group-coverage): camera.setLine stores the
// line of action a shot keeps (shot.line { between: [A, B] }, the pair the cut
// rules judge it by, decision D1), and camera.checkCoverage answers "is there
// enough here to edit?" for a range and cast (read only). Registered by
// commands/camera-coverage.js with its shot helpers.
import { checkCuts } from '../camera-coverage/cut-rules.js';
import { checkCoverage } from '../camera-coverage/completeness.js';
import { repairLine } from '../camera-coverage/storage.js';
import { resolveCameraRequest } from '../camera-coverage/resolve.js';
import { shotAtFrame } from '../cuts.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail, shotLabel } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const frame = { type: 'integer', minimum: 0 };
const range = input({ startFrame: frame, endFrameExclusive: { type: 'integer', minimum: 1 } }, ['startFrame', 'endFrameExclusive']);

export const groupDeclarations = [
  { id: 'camera.setLine', label: 'Set line of action', kind: 'mutation', undoDomain: 'shot',
    description: 'Store the line of action a shot keeps: between [A, B] (two cast ids; [] clears it), on shotId, shotIds, every clip shot (all), or the shot under the playhead; or request ("keep the line between Mara and Joon"). camera.checkCuts then judges each cut by the line between the pair the two shots are about (an authored line, else the subjects, else whom the subject looks at) and names that pair; when it cannot tell it says so. Answers the cut check on the cuts touching those shots.',
    input: input({ between: { type: 'array', items: id, minItems: 0, maxItems: 2 }, shotId: id, shotIds: { type: 'array', items: id, minItems: 1, maxItems: 64 }, all: { type: 'boolean' }, request: { type: 'string', minLength: 1, maxLength: 300 } }) },
  { id: 'camera.checkCoverage', label: 'Check coverage', kind: 'job', domain: 'shot', timeoutMs: 10000, readOnly: true,
    description: 'Is there enough here to edit? For a range { startFrame, endFrameExclusive } (default every shot) and cast (default everyone the shots are about), measured from the cameras: a master or establishing shot, at least two sizes of each cast member, a neutral or cutaway where the line changes, and the same setups in every branch (branches: frame ranges, default the branches camera.cover laid). Each gap carries a suggested shot as a technique stack (camera.applyTechnique { stack }); nothing changes. request: "is my coverage enough to edit?".',
    input: input({ range, cast: { type: 'array', items: id, minItems: 1, maxItems: 6 }, branches: { type: 'array', items: range, minItems: 2, maxItems: 8 }, request: { type: 'string', maxLength: 300 } }) },
];

/** @param {object} helpers { owner, visible, scene, patch, compactCut } from registerCoverage */
export function registerGroupCoverage(registry, ports, { owner, visible, scene, patch, compactCut }) {
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  registry.register({ ...groupDeclarations[0], target: args => args.shotId,
    available: state => (mounted() === true ? state.shots.length > 0 || 'There are no shots yet; add one with shot.create.' : mounted()), run(args) { return setLine(args); } });
  registry.register({ ...groupDeclarations[1], available: state => (mounted() === true ? state.shots.length > 0 || 'There are no shots yet; coverage is checked over shots.' : mounted()),
    run(args) { return check(args); } });

  function setLine(args) {
    const people = visible(), named = people.map(row => ({ id: row.id, name: row.subject ?? row.name }));
    const routed = args.request && !args.between ? resolveCameraRequest(args.request, { cast: named }) : null;
    const between = args.between ?? (routed?.action === 'camera.setLine' ? routed.args.between : null) ?? fail('INVALID_ARGUMENT', `Name the line: between [A, B]${args.request ? `; "${args.request}" names ${routed?.args?.between?.length ?? 0} cast member(s)` : ''}.`);
    if (between.length === 1) fail('INVALID_ARGUMENT', 'A line runs between two cast members; give two ids, or [] to clear it.');
    for (const castId of between) if (!people.some(row => row.id === castId)) fail('STALE_TARGET', `${castId} is not a visible character in this scene.`);
    const line = between.length ? repairLine({ between }) ?? fail('INVALID_ARGUMENT', 'A line runs between two different cast members.') : null;
    const rows = owner().read(), view = ports.readView();
    const targets = args.all ? rows.filter(row => row.kind !== 'still')
      : args.shotIds ?? args.shotId ? (args.shotIds ?? [args.shotId]).map(shotId => rows.find(row => row.id === shotId) ?? fail('STALE_TARGET', `Shot ${shotId} is not in this scene.`))
        : [shotAtFrame(rows, view.view?.frame ?? ports.state().frame) ?? rows.find(row => row.id === view.selectedShotId) ?? fail('AMBIGUOUS_TARGET', 'No shot owns the playhead; name one with shotId, shotIds or all.')];
    for (const shot of targets) patch(shot.id, row => { const next = { ...row }; delete next.line; return line ? { ...next, line } : next; });
    const ids = new Set(targets.map(row => row.id)), cuts = checkCuts(owner().read(), scene()).cuts.filter(cut => ids.has(cut.from) || ids.has(cut.to));
    const issues = cuts.reduce((sum, cut) => sum + cut.issues.length, 0), names = line ? line.between.map(castId => (named.find(row => row.id === castId)?.name ?? castId).split(',')[0]).join('–') : null;
    return { affectedIds: [...ids], summary: `${line ? `The ${names} line` : 'No authored line'} on ${targets.length === 1 ? shotLabel(targets[0]) : `${targets.length} shots`}; ${cuts.length} cut${cuts.length === 1 ? '' : 's'} touching them, ${issues ? `${issues} issue${issues === 1 ? '' : 's'}` : 'clean'}.`.slice(0, 240),
      // A one-shot line is a single write, so its receipt carries no output: the matched words ride in checks too.
      checks: { shots: targets.length, cuts: cuts.length, issues, ...(routed?.action === 'camera.setLine' ? { matched: routed.matched, confidence: routed.confidence } : {}) },
      output: { line, shotIds: [...ids], cuts: cuts.map(compactCut), ...(routed?.action === 'camera.setLine' ? { matched: routed.matched, confidence: routed.confidence } : {}) } };
  }

  function check(args) {
    const routed = args.request ? resolveCameraRequest(args.request, { cast: visible().map(row => ({ id: row.id, name: row.subject ?? row.name })) }) : null;
    const span = args.range ? { startFrame: args.range.startFrame, endFrame: args.range.endFrameExclusive - 1 } : null;
    const branches = args.branches?.map(row => ({ startFrame: row.startFrame, endFrame: row.endFrameExclusive - 1 }));
    const castIds = args.cast ?? (routed?.action === 'camera.checkCoverage' ? routed.args.cast : undefined);
    for (const castId of castIds ?? []) if (!visible().some(row => row.id === castId)) fail('STALE_TARGET', `${castId} is not a visible character in this scene.`);
    const report = checkCoverage(owner().read(), scene(), { range: span, castIds, branches });
    if (!report.shots) fail('TARGET_NOT_READY', `No clip shot in ${span ? `${span.startFrame}-${span.endFrame}` : 'the timeline'}; lay coverage with camera.cover first.`);
    const said = report.gaps.slice(0, 2).map(gap => gap.message).join(' ');
    return { affectedIds: [], summary: `${report.complete ? 'Enough to edit' : `${report.gaps.length} gap${report.gaps.length === 1 ? '' : 's'}`} over ${report.range.startFrame}-${report.range.endFrame} (${report.shots} shots, ${report.cast.length} cast)${said ? `: ${said}` : '.'}`.slice(0, 240),
      warnings: report.gaps.slice(0, 10).map(gap => ({ code: `COVERAGE_${gap.kind.toUpperCase().replace(/-/g, '_')}`, message: gap.message.slice(0, 120), ...(gap.shotId ? { id: gap.shotId } : {}) })),
      checks: { complete: report.complete, gaps: report.gaps.length, shots: report.shots, master: report.checks.master, sizes: report.checks.sizes, lineChanges: report.checks.lineChanges, ...(report.checks.branches === null ? {} : { branchesMatch: report.checks.branches }) },
      output: { ...report, ...(routed?.action === 'camera.checkCoverage' ? { matched: routed.matched, confidence: routed.confidence } : {}) } };
  }
}
