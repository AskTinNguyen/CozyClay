// The intensity curve as a Studio action (intensity-curve A2, A5):
// camera.checkStructure measures every shot's intensity (size, height, lens,
// movement, cutting rate, roll, screen jump), each cut's contrast, and reports
// where the sequence goes flat, peaks off its strongest beat, or does not
// build into a reveal, threat or decision, each with a technique stack to
// apply. Read only. Registered by commands/camera.js.
import { castAt } from '../camera-coverage/cut-geometry.js';
import { checkStructure, STRUCTURE_RULES, structureWords } from '../intensity-curve/structure.js';
import { resolveStructureRequest } from '../intensity-curve/resolve.js';
import { INTENSITY_COMPONENTS, STRUCTURE_LIMITS } from '../intensity-curve/weights.js';
import { studioSequenceDocument } from '../sequence-prompt-studio.js';
import { StudioSchemas } from '../studio-agent-protocol.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const COMPONENT_WORDS = INTENSITY_COMPONENTS.map(row => row.label).join(', ');

export const structureDeclarations = [
  { id: 'camera.checkStructure', label: 'Check sequence structure', kind: 'job', domain: 'shot', timeoutMs: 20000, readOnly: true,
    description: `The sequence's intensity curve against its story beats ("where does this go flat?", "show me the intensity", "build to the reveal"): per shot the measured ${COMPONENT_WORDS} (each 0-1, weighted into a combined value), each cut's contrast, and issues ${STRUCTURE_RULES.join(', ')} (flat: ${STRUCTURE_LIMITS.flatShots}+ shots with every cut under ${STRUCTURE_LIMITS.flatContrast}; with no story beats only flat runs). Each issue has frames and a suggestion: a technique stack (one size tighter, low-angle, a longer lens) with camera.applyTechnique args, plus shorter shots in words. Nothing changes. shotIds or from/to narrow it; beat names a beat it must build into.`,
    input: input({ shotIds: { type: 'array', items: id, minItems: 1, maxItems: 64 }, from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 },
      beat: { oneOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'integer', minimum: 0 }] }, request: { type: 'string', maxLength: 300 } }) },
];

export function registerStructure(registry, ports) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  const document = () => ({ ...studioSequenceDocument(ports.readView()), shots: owner().read(), storyBeats: owner().state().storyBeats ?? [], frameCount: owner().state().frameCount });
  const placeAt = (row, shot, at) => castAt(ports.sampleStateAt?.(at)?.characters?.find(entry => entry.id === row.id) ?? row, shot, at);

  registry.register({ ...structureDeclarations[0], available: state => (mounted() === true ? (state.shots.length > 0 || 'There are no shots yet; add one with shot.create.') : mounted()), run(args) {
    const hit = args.request ? resolveStructureRequest(args.request) : null, said = hit?.action === 'camera.checkStructure' ? hit : null;
    const range = args.shotIds ? { shotIds: args.shotIds } : args.from || args.to ? { from: args.from, to: args.to } : null;
    const result = checkStructure(document(), { range, placeAt, beat: args.beat ?? said?.args.beat ?? null }), words = structureWords(result);
    const flagged = result.issues.slice(0, 2).map(issue => `${issue.message} Try: ${issue.suggestion.text}.`).join(' ');
    return { affectedIds: [], summary: `${result.curve.shots.length} shot${result.curve.shots.length === 1 ? '' : 's'}: ${words} ${result.issueCount ? flagged : `No ${result.rules.join(', ')} issue.`}`.slice(0, 240),
      warnings: result.issues.slice(0, 10).map(issue => ({ code: `STRUCTURE_${issue.rule.toUpperCase().replaceAll('-', '_')}`, id: issue.shotIds.at(-1), message: issue.message.slice(0, 120) })),
      checks: { shots: result.curve.shots.length, issues: result.issueCount },
      output: { structure: words, ...compact(result), ...(said ? { resolved: said.via, matched: said.matched, confidence: said.confidence } : {}) } };
  } });
}

/** The check for a receipt: the curve per shot, the cuts' contrast, and the issues with their suggestions (bounded). */
function compact(result) {
  const { curve } = result;
  return { version: curve.version, weights: curve.weights, rules: result.rules, limits: result.limits, issueCount: result.issueCount,
    beats: result.beats.map(beat => ({ id: beat.id, frame: beat.frame, kind: beat.kind, label: beat.label })), ...(result.beat ? { buildInto: result.beat.id } : {}),
    shots: curve.shots.slice(0, 64).map(row => ({ index: row.index, shotId: row.shotId, shotName: row.shotName, frames: [row.startFrame, row.endFrame], combined: row.combined, components: row.components, ...(row.unmeasured ? { unmeasured: true } : {}) })),
    cuts: curve.cuts.slice(0, 63).map(cut => ({ cutFrame: cut.cutFrame, from: cut.from, to: cut.to, total: cut.total, contrast: cut.contrast })), peak: curve.peak,
    issues: result.issues.map(issue => ({ rule: issue.rule, severity: issue.severity, frames: issue.frames, shotIds: issue.shotIds, message: issue.message,
      ...(issue.beat ? { beat: { id: issue.beat.id, frame: issue.beat.frame, kind: issue.beat.kind } } : {}),
      suggestion: issue.suggestion.text, ...(issue.suggestion.action ? { fixAction: issue.suggestion.action, fixArgs: issue.suggestion.args } : {}) })) };
}
