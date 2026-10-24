// Shot looks as Studio actions (colour-script A1, A2, A4, A6): shot.setLook
// stores a partial stage look on a shot (stage-shot-look.js), from a look
// recipe in story words, an explicit partial, a nudge ("colder"), another
// shot's look or a request; shot.colourScript reads the colour script of a
// range (read only): each shot's look in words, its intended palette, the
// palette measured from its middle frame (rendered through the export path),
// and the colour change across each cut. Registered by commands/shot.js.
import { StudioSchemas } from '../studio-agent-protocol.js';
import { shotAtFrame } from '../cuts.js';
import { SHOT_LOOK_FIELDS, withDrawShots } from '../stage-shot-look.js';
import { editShotLook, LOOK_EDIT_KEYS, lookText } from '../colour-script/edit.js';
import { LIGHTING_PRESETS } from '../stage-lighting.js';
import { LOOK_ADJUSTMENTS, LOOK_RECIPE_IDS, LOOK_RECIPES } from '../colour-script/recipes.js';
import { colourCutWords, colourScript, colourScriptWords } from '../colour-script/script.js';
import { measurePalette } from '../colour-script/palette.js';
import { resolveLookRequest } from '../colour-script/resolve.js';
import { fail, shotLabel } from './shared.js';

const id = StudioSchemas.TargetGuard.properties.targetId;
const input = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const ref = { oneOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'integer', minimum: 1 }] };
const palette = input({ swatches: { type: 'array', items: hex, minItems: 3, maxItems: 5 }, word: { type: 'string', maxLength: 40 } }, ['swatches']);
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] });
const lookSchema = input({ preset: nullable({ type: 'string', enum: [...LIGHTING_PRESETS] }), warmth: nullable({ type: 'number', minimum: 0, maximum: 1 }), keyColor: nullable(hex), keyIntensity: nullable({ type: 'number', minimum: 0, maximum: 4 }),
  exposure: nullable({ type: 'number', minimum: 0.2, maximum: 3 }), fill: nullable({ type: 'number', minimum: 0, maximum: 3 }), fog: nullable({ type: 'number', minimum: 0, maximum: 1 }), sky: nullable(hex), skyTop: nullable(hex), palette: nullable(palette) });
const RECIPE_WORDS = LOOK_RECIPES.map(row => `${row.id} (${row.mood.split(':')[0].toLowerCase()})`).join('; ');

export const lookDeclarations = [
  { id: 'shot.setLook', label: 'Set shot look', kind: 'mutation', undoDomain: 'shot',
    description: `A shot's own look, merged over the stage look while it plays (previews, captures, video, keyframe packs; a dissolve blends the two looks): recipe in story words ${RECIPE_WORDS}; or look { ${SHOT_LOOK_FIELDS.filter(field => field !== 'recipe').join(', ')} } (a partial stage.lighting: preset, key warmth or keyColor, keyIntensity, exposure, fill, fog, sky, skyTop; null clears a field) over the shot's look; palette { swatches 3-5 #rrggbb, word } is the palette it is meant to read as; adjust ${LOOK_ADJUSTMENTS.join(' | ')} nudges it; sameAs (a shot id, name word or 1-based number) copies another shot's look; clear removes it. shotId or shot (id, name word, a story beat's label in it, or number) picks the shot, default the one under the playhead; request reads the words ("make the confession shot colder", "the same look as shot 2").`,
    input: input({ shotId: id, shot: ref, recipe: { type: 'string', enum: LOOK_RECIPE_IDS }, look: lookSchema, palette, adjust: { type: 'string', enum: LOOK_ADJUSTMENTS }, sameAs: ref, clear: { type: 'boolean' }, request: { type: 'string', maxLength: 300 } }) },
  { id: 'shot.colourScript', label: 'Read colour script', kind: 'job', domain: 'shot', timeoutMs: 60000, readOnly: true,
    description: 'The colour script of a range of shots ("colour script for this scene"): per shot its look in words, its intended palette and the palette measured from its middle frame (dominant swatches with shares, mean luminance, warmth -1 cold to 1 warm, saturation), the story beats, and the colour change across each cut (luminance and warmth deltas, hard / soft / matched, measured when both sides were rendered, else planned from the looks). measure false skips the render. shotIds or from/to (1-based) pick the range, default every shot. Nothing changes.',
    input: input({ shotIds: { type: 'array', items: id, minItems: 1, maxItems: 64 }, from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 }, measure: { type: 'boolean' }, request: { type: 'string', maxLength: 300 } }) },
];

const sorted = rows => [...rows].sort((a, b) => a.startFrame - b.startFrame);
const words = word => String(word).toLowerCase().trim();

export function registerShotLook(registry, ports) {
  const owner = () => ports.storeDomain('shot');
  const mounted = () => Boolean(ports.storeDomain?.('shot')) || 'The shots document owner is not mounted.';
  const stage = () => ports.readView()?.stage ?? {};
  /** A shot by id, name word, a story beat's label inside it, or 1-based number in time order. */
  function find(reference) {
    const rows = sorted(owner().read());
    if (typeof reference === 'number') return rows[reference - 1] ?? fail('STALE_TARGET', `There is no shot ${reference}; the timeline has ${rows.length}.`);
    const said = words(reference), beats = owner().state().storyBeats ?? [];
    return rows.find(row => row.id === reference) ?? rows.find(row => words(row.name ?? '') === said) ?? rows.find(row => words(row.name ?? '').includes(said))
      ?? rows.find(row => beats.some(beat => beat.frame >= row.startFrame && beat.frame <= row.endFrame && words(beat.label).includes(said)))
      ?? fail('STALE_TARGET', `No shot is named "${reference}" or holds a story beat of that name.`);
  }
  const current = () => shotAtFrame(sorted(owner().read()), ports.state().frame) ?? fail('TARGET_NOT_READY', `No shot is under the playhead (frame ${ports.state().frame}); name one with shotId or shot.`);

  registry.register({ ...lookDeclarations[0], target: args => args.shotId,
    available: state => (mounted() === true ? (state.shots.length > 0 || 'There are no shots yet; add one with shot.create.') : mounted()),
    run(args) {
      const said = args.request ? resolveLookRequest(args.request) : null, heard = said?.action === 'shot.setLook' ? said.args : {};
      const want = { ...heard, ...Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'request')) };
      if (args.request && !said && !LOOK_EDIT_KEYS.some(key => args[key] !== undefined)) fail('INVALID_ARGUMENT', `No look words in "${args.request}": name a recipe (${LOOK_RECIPE_IDS.join(', ')}), a nudge (${LOOK_ADJUSTMENTS.join(', ')}) or a shot to match.`);
      const shot = want.shotId ? find(want.shotId) : want.shot !== undefined ? find(want.shot) : current();
      let next;
      try { next = editShotLook(shot.look ?? null, want, { stage: stage(), source: want.sameAs !== undefined ? find(want.sameAs) : null }); }
      catch (error) { if (error.code) fail(error.code, error.message); throw error; }
      owner().write(rows => rows.map(row => {
        if (row.id !== shot.id) return row;
        const copy = { ...row };
        delete copy.look;
        return next ? { ...copy, look: next } : copy;
      }));
      const text = lookText(next);
      return { affectedIds: [shot.id], summary: `Look on ${shotLabel(shot)}: ${text}.`.slice(0, 240),
        output: { shotId: shot.id, look: next, words: text, ...(said ? { resolved: said.via, matched: said.matched, confidence: said.confidence } : {}) } };
    } });

  registry.register({ ...lookDeclarations[1], available: state => (mounted() === true ? (state.shots.length > 0 || 'There are no shots yet; add one with shot.create.') : mounted()),
    run(args) {
      const said = args.request ? resolveLookRequest(args.request) : null;
      const range = args.shotIds ? { shotIds: args.shotIds } : args.from || args.to ? { from: args.from, to: args.to } : null;
      const document = { shots: owner().read(), stage: stage(), storyBeats: owner().state().storyBeats ?? [] };
      const planned = colourScript(document, { range }), render = args.measure !== false && typeof ports.renderFrameBuffer === 'function' ? ports.renderFrameBuffer : null;
      const measured = {};
      // Lit from the document's looks: the scene's own props can still be a render behind an edit just made.
      if (render) withDrawShots(document.shots, () => { for (const row of planned.shots) { const image = render(row.middleFrame); measured[row.shotId] = measurePalette(image.data, image.width, image.height); } });
      const script = render ? colourScript(document, { range, measured }) : planned, line = colourScriptWords(script);
      return { affectedIds: [], summary: `Colour script: ${line}`.slice(0, 240), checks: { shots: script.shots.length, issues: script.hardCuts },
        output: { words: line, version: script.version, measured: Boolean(render),
          shots: script.shots.map(row => ({ index: row.index, shotId: row.shotId, shotName: row.shotName, frames: [row.startFrame, row.endFrame], middleFrame: row.middleFrame, look: row.look, words: row.words, intended: row.intended, planned: row.planned, key: row.key,
            ...(row.measured ? { measured: { swatches: row.measured.swatches, meanLuminance: row.measured.meanLuminance, warmth: row.measured.warmth, saturation: row.measured.saturation } } : {}) })),
          cuts: script.cuts.map(cut => ({ ...cut, words: colourCutWords(cut) })), beats: script.beats,
          ...(said ? { resolved: said.via, matched: said.matched, confidence: said.confidence } : {}) } };
    } });
}
