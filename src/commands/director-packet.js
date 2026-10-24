// The director packet as a Studio action (director-packet A4, A5):
// export.directorPacket writes the sequence pack for a range of shots with
// packet/ inside it (index.html, plan.png, contact-sheet.png, shot-list.csv,
// shot-list.md, packet.json), the same export File > Export > Director packet
// downloads, handed to the configured export folder or the browser download.
// The cast is placed as the editor plays it (sampleStateAt), so a walk a take
// makes is on the plan. Registered by commands/export.js.
import { castAt } from '../camera-coverage/cut-geometry.js';
import { shotsInRange } from '../shot-prompt-engine/sequence.js';
import { studioSequenceDocument } from '../sequence-prompt-studio.js';
import { packetFileNames } from '../director-packet/files.js';
import { StudioSchemas } from '../studio-agent-protocol.js';
import { fail } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties) => ({ type: 'object', properties, required: [], additionalProperties: false });

export const packetDeclarations = [
  { id: 'export.directorPacket', label: 'Export director packet', kind: 'job', domain: 'shot', timeoutMs: 300_000,
    description: `A range of shots as a director packet inside its sequence pack (cozyclay-sequence-<title>.zip), like File > Export > Director packet: every shot's keyframe pack, sequence-prompt.txt and references.json, plus ${packetFileNames({ plan: true, contactSheet: true }).join(', ')}. The plan draws each shot's numbered camera with its frustum and move, every pair's line of action and the cast's marks and walks; the contact sheet is one frame per shot; the shot list carries the flags of the cut, coverage, motivation and shot checks. shotIds or from/to (1-based, time order) pick the range, default every shot. Renders each shot's frames and clip, so it can take minutes (up to 5); answers output.fileName and output.files once the zip is handed to the export folder or the browser download. render_packet answers the same data without pictures.`,
    input: input({ shotIds: { type: 'array', items: id, minItems: 1, maxItems: 64 }, from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 } }) },
];

export function registerDirectorPacket(registry, ports) {
  registry.register({ ...packetDeclarations[0],
    available: state => state.exporting ? 'An export is already running; wait for it to finish.'
      : !ports.exportDirectorPacket ? 'This editor cannot export a director packet.'
        : (state.shots?.length > 0 || 'There are no shots yet; add one with shot.create or lay coverage with camera.cover.'),
    async run(args) {
      const range = args.shotIds ? { shotIds: args.shotIds } : { from: args.from, to: args.to };
      const shotIds = shotsInRange(studioSequenceDocument(ports.readView()), range).map(shot => shot.id);
      if (!shotIds.length) fail('INVALID_ARGUMENT', 'No shots in that range; shotIds or from/to (1-based, time order) pick it.');
      const placeAt = (row, shot, at) => castAt(ports.sampleStateAt?.(at)?.characters?.find(entry => entry.id === row.id) ?? row, shot, at);
      const result = await ports.exportDirectorPacket(shotIds, { placeAt });
      if (!result?.name) fail('TARGET_NOT_READY', 'The director packet export did not finish; the editor\'s export panel shows why and offers Retry.');
      const packet = result.files.filter(name => name.startsWith('packet/')), flags = result.packet.shots.reduce((sum, row) => sum + row.flags.length, 0) + result.packet.notes.length;
      return { affectedIds: [], checks: { shots: result.packet.shots.length, issues: flags },
        output: { fileName: result.name, entries: result.files.length, files: packet, shots: result.packet.shots.map(row => [row.number, row.shotId, row.flags.length]), checks: result.packet.checks, plan: result.packet.plan.counts },
        summary: `Exported ${result.name}: ${result.packet.shots.length} shot${result.packet.shots.length === 1 ? '' : 's'} with packet/ (${packet.map(name => name.slice(7)).join(', ')}), ${result.files.length} files, ${flags} flag${flags === 1 ? '' : 's'}; handed to the export folder or the browser download.`.slice(0, 400) };
    } });
}
