// director-packet A3: the packet's files inside a sequence pack. A sequence
// pack for master and coverage (each shot's keyframe pack, the brief's files)
// plus packet/index.html, plan.png, contact-sheet.png, shot-list.csv,
// shot-list.md and packet.json is zipped, tested with `unzip -t`, listed, and
// each file read back and checked against the packet data. The keyframe pack
// entries are unchanged: the packet only adds a folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coveredSequence } from './director-packet-fixture.mjs';
import { directorPacket } from '../src/director-packet/packet.js';
import { packetFileNames, packetFiles } from '../src/director-packet/files.js';
import { SHOT_LIST_COLUMNS } from '../src/director-packet/shot-list.js';
import { buildSequencePrompt } from '../src/shot-prompt-engine/sequence.js';
import { sequencePackFiles } from '../src/shot-prompt-engine/references.js';
import { keyframePackEntries } from '../src/keyframe-pack.js';
import { buildZip } from '../src/zip-store.js';
import { encodePng } from '../mcp/image-file.mjs';

const png = (width, height, shade) => new Uint8Array(encodePng(width, height, new Uint8Array(width * height * 4).fill(shade)));
/** A minimal CSV reader for the checks: quoted fields with doubled quotes, CRLF rows. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch; continue; }
    if (ch === '"') quoted = true; else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; } else field += ch;
  }
  return rows;
}

test('A3: the packet folder rides in the sequence pack and every file matches the packet', () => {
  const { f, document } = coveredSequence();
  const dir = mkdtempSync(join(tmpdir(), 'director-packet-'));
  try {
    const packet = directorPacket(document), brief = buildSequencePrompt(document);
    const shotEntries = document.shots.flatMap((shot, i) => keyframePackEntries({ shot: { title: shot.name, index: i + 1, startFrame: shot.startFrame, endFrame: shot.endFrame }, fps: 24,
      firstFramePng: png(4, 4, 40), lastFramePng: png(4, 4, 80), clip: null, camera: { mode: 'keys' }, prompt: shot.name }));
    const images = { plan: png(32, 23, 250), contactSheet: png(48, 18, 120) };
    const entries = [...shotEntries, ...sequencePackFiles(brief, document), ...packetFiles(packet, images)];
    const zip = join(dir, 'cozyclay-sequence-rooftop.zip');
    writeFileSync(zip, buildZip(entries));

    const tested = execFileSync('unzip', ['-t', zip], { encoding: 'utf8' });
    assert.match(tested, /No errors detected in compressed data/, tested);
    const listed = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    const expected = ['packet/index.html', 'packet/shot-list.csv', 'packet/shot-list.md', 'packet/packet.json', 'packet/plan.png', 'packet/contact-sheet.png'];
    assert.deepEqual(packetFileNames(images), expected);
    assert.deepEqual(listed.filter((name) => name.startsWith('packet/')), expected, 'the packet folder');
    assert.ok(listed.includes('sequence-prompt.txt') && listed.includes('references.json') && listed.includes('1-master-1-master/first.png'), 'the sequence pack around it');
    assert.deepEqual(listed.filter((name) => !name.startsWith('packet/')), [...shotEntries, ...sequencePackFiles(brief, document)].map((entry) => entry.name), 'the pack entries are unchanged');
    const read = (name) => execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

    const csv = parseCsv(read('packet/shot-list.csv'));
    assert.deepEqual(csv[0], SHOT_LIST_COLUMNS.map(([id]) => id));
    assert.equal(csv.length, 1 + packet.shots.length, 'a row per shot');
    packet.shots.forEach((row, i) => {
      const cells = Object.fromEntries(csv[0].map((id, k) => [id, csv[i + 1][k]]));
      assert.deepEqual([cells.number, cells.name, cells.start_frame, cells.end_frame, cells.tc_in, cells.tc_out], [String(row.number), row.name, String(row.frames.start), String(row.frames.end), row.timecode.in, row.timecode.out]);
      assert.equal(cells.measured, row.measured);
      assert.equal(cells.lens_mm, row.lensMm[0] === row.lensMm[1] ? String(row.lensMm[0]) : `${row.lensMm[0]}-${row.lensMm[1]}`);
      assert.equal(cells.flags === '', row.flags.length === 0);
    });
    assert.match(csv[2].at(-1), /^motivation\/unmotivated \(high\): The push over/, 'the push-in flag in its row');

    const md = read('packet/shot-list.md');
    assert.match(md, /^# Rooftop: shot list$/m);
    assert.equal(md.split('\n').filter((line) => /^\| \d+ \| /.test(line)).length, packet.shots.length, 'a table row per shot');
    for (const row of packet.shots) assert.ok(md.includes(`| ${row.number} | ${row.name} | ${row.frames.start} | ${row.frames.end} | ${row.timecode.in} |`), `md row ${row.number}`);
    assert.match(md, /^- Shot 2 \(motivation, high\): The push over/m);

    const html = read('packet/index.html');
    for (const href of ['plan.png', 'contact-sheet.png', 'shot-list.csv', 'shot-list.md', 'packet.json']) assert.ok(html.includes(`"${href}"`), `index.html references ${href}`);
    assert.match(html, /@page \{ size: A4 landscape;/);
    assert.equal((html.match(/<tr><td>\d+<\/td>/g) ?? []).length, packet.shots.length, 'the shot list on the page');
    assert.ok(packet.shots.every((row) => html.includes(`<td>${row.name.replace('&', '&amp;')}</td>`)));
    assert.deepEqual(JSON.parse(read('packet/packet.json')), packet, 'packet.json is the data');
    const plan = execFileSync('unzip', ['-p', zip, 'packet/plan.png']);
    assert.deepEqual([...plan.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'plan.png is a PNG');
    assert.equal(Buffer.compare(plan, Buffer.from(images.plan)), 0);

    // Without pictures the folder holds the text files only and the page shows no picture.
    const bare = packetFiles(packet);
    assert.deepEqual(bare.map((entry) => entry.name), packetFileNames({}));
    assert.ok(!bare[0].data.includes('<img'), 'no picture rendered: none on the page');
    console.log(`PASS A3 ${listed.length} entries, packet/: ${expected.length} files; unzip -t: ${tested.trim().split('\n').at(-1)}`);
  } finally { f.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
