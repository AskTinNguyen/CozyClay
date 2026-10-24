// shot-prompt-engine A4: a keyframe pack carries the brief and its reference
// manifest. Packs for the covered sequence (one archive with every shot, and a
// single shot's pack) are written to disk and opened with Git Bash's unzip:
// `unzip -t` must find no errors, and every file references.json lists must
// be in the archive, by role (first frame, last frame, composition guide,
// character sheet, set), each naming the beats it serves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { coveredSequence } from './sequence-fixture.mjs';
import { buildSequencePrompt, shotsInRange } from '../../src/shot-prompt-engine/sequence.js';
import { sequencePackFiles } from '../../src/shot-prompt-engine/references.js';
import { keyframePackEntries, sequencePackName } from '../../src/keyframe-pack.js';
import { buildZip } from '../../src/zip-store.js';

const run = promisify(execFile);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const JPG_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;

/** Every shot's keyframe pack entries (frames, camera, prompt, README) plus the brief's files: what App.jsx writes. */
function packEntries(document, brief) {
  const all = shotsInRange(document), files = sequencePackFiles(brief, document);
  return brief.beats.flatMap((beat, i) => {
    const shot = all[beat.shotNumber - 1];
    return keyframePackEntries({ shot: { title: shot.name, index: beat.shotNumber, startFrame: shot.startFrame, endFrame: shot.endFrame }, fps: 24, firstFramePng: png,
      lastFramePng: shot.endFrame > shot.startFrame ? png : null, clip: null, camera: { fps: 24 }, prompt: `shot ${beat.shotNumber}`, sequenceFiles: i === brief.beats.length - 1 ? files : [] });
  });
}

async function openZip(dir, name, entries) {
  const path = join(dir, name);
  await writeFile(path, buildZip(entries));
  const tested = await run('unzip', ['-t', path]);
  const listed = (await run('unzip', ['-Z1', path])).stdout.split(/\r?\n/).filter(Boolean);
  const read = async (member) => (await run('unzip', ['-p', path, member])).stdout;
  return { tested: tested.stdout, listed, read };
}

test('the sequence pack holds the brief, the manifest and every file it lists', async () => {
  const { f, document } = coveredSequence(), dir = await mkdtemp(join(tmpdir(), 'cozyclay-seq-pack-'));
  try {
    const doc = { ...document, cast: document.cast.map((row) => (row.id === 'actor-a' ? { ...row, identityImage: PNG_URL } : row)), set: { environment: 'a wet rooftop at night', image: JPG_URL } };
    const brief = buildSequencePrompt(doc, { profile: 'kling-3' }), zip = await openZip(dir, sequencePackName(doc.title), packEntries(doc, brief));
    assert.match(zip.tested, /No errors detected in compressed data/, zip.tested);
    assert.equal(sequencePackName('Rooftop'), 'cozyclay-sequence-rooftop.zip');
    const manifest = JSON.parse(await zip.read('references.json'));
    assert.deepEqual(manifest, brief.references, 'references.json is the manifest');
    assert.equal(await zip.read('sequence-prompt.txt'), `${brief.text}\n`, 'sequence-prompt.txt is the brief');
    assert.equal(manifest.schema, 'cozyclay.references.v1');
    for (const entry of manifest.entries) {
      assert.ok(zip.listed.includes(entry.file), `${entry.role} ${entry.file} is in the pack`);
      assert.ok(entry.beats.length && entry.beats.every((n) => n >= 1 && n <= brief.beats.length), `${entry.file} serves real beats`);
    }
    const roles = (role) => manifest.entries.filter((entry) => entry.role === role);
    assert.equal(roles('first-frame').length, 5); assert.equal(roles('last-frame').length, 5); assert.equal(roles('composition-guide').length, 5);
    assert.deepEqual(roles('character-sheet').map((entry) => [entry.subject, entry.file, entry.beats]), [['Mara', 'references/cast-mara.png', [1, 2, 4]]]);
    assert.deepEqual(roles('set').map((entry) => [entry.file, entry.beats]), [['references/set.jpg', [1, 2, 3, 4, 5]]]);
    assert.deepEqual(manifest.missing, [{ role: 'character-sheet', subject: 'Joon', fix: 'add a character sheet for Joon in the cast inspector' }], 'Joon has no sheet: listed as missing, with how to add one');
    assert.match(await zip.read(roles('composition-guide')[0].file), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 640 360"[^]*Mara at 0\.\d+ across/, 'the guide draws the measured eye point');
    assert.match(brief.text, /^REFERENCES: references\.json lists 17 stills by role .*; missing: character-sheet for Joon\.$/m);
    assert.match(await zip.read('5-master-5-cu-joon/README.txt'), /\.\.\/sequence-prompt\.txt: the whole brief/, 'the README points at the brief');
    console.log(`PASS A4 sequence pack: ${zip.listed.length} files, ${manifest.entries.length} references (${[...new Set(manifest.entries.map((entry) => entry.role))].join(', ')}), unzip -t: ${zip.tested.trim().split('\n').at(-1).trim()}`);
  } finally { f.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('a single shot pack carries its one-beat brief and a manifest of its own files', async () => {
  const { f, document } = coveredSequence(), dir = await mkdtemp(join(tmpdir(), 'cozyclay-shot-pack-'));
  try {
    const third = shotsInRange(document)[2], brief = buildSequencePrompt(document, { range: { shotIds: [third.id] } });
    assert.equal(brief.beats[0].shotNumber, 3, 'the folder keeps the shot\'s place in the sequence');
    const zip = await openZip(dir, 'cozyclay-shot-3.zip', packEntries(document, brief));
    assert.match(zip.tested, /No errors detected/);
    const manifest = JSON.parse(await zip.read('references.json'));
    assert.deepEqual(manifest.entries.map((entry) => entry.file), ['3-master-3-ms-joon/first.png', '3-master-3-ms-joon/last.png', '3-master-3-ms-joon/composition.svg']);
    for (const entry of manifest.entries) assert.ok(zip.listed.includes(entry.file), entry.file);
    assert.deepEqual(manifest.missing.map((row) => row.subject ?? row.role), ['Mara', 'Joon', 'set']);
    assert.match(await zip.read('sequence-prompt.txt'), /^SEQUENCE: Rooftop: 1 shot, 1\.58s at 24 fps, 16:9\.$/m);
    console.log(`PASS A4 shot pack: ${zip.listed.join(', ')}`);
  } finally { f.dispose(); await rm(dir, { recursive: true, force: true }); }
});
