// intensity-curve A1, A2 and the A4 strip image. A1: sequenceIntensity gives
// every shot the seven components (size, height, focal, speed, cutting, roll,
// screen), the combined value and each cut's contrast, byte-identical across
// runs; a master-coverage sequence climbs from the master to the close-ups,
// an all-medium same-lens sequence is flat. A2: camera.checkStructure's rules
// on constructed cases: flat (beat-free, the only rule without beats),
// peak-off-beat, no-build, each with frames and a technique-stack suggestion
// camera.applyTechnique applies. A4: the strip renders to an image of the
// asked dimensions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coveredSequence, documentOf, techniqueShots } from './bus/sequence-fixture.mjs';
import { sequenceIntensity } from '../src/intensity-curve/curve.js';
import { checkStructure, structureWords } from '../src/intensity-curve/structure.js';
import { INTENSITY_COMPONENT_IDS, INTENSITY_COMPONENTS } from '../src/intensity-curve/weights.js';
import { STRIP_SIZE, stripImage, stripLayout } from '../src/intensity-curve/strip.js';
import { techniqueById } from '../src/camera-techniques/index.js';

const COMPONENTS = ['size', 'height', 'focal', 'speed', 'cutting', 'roll', 'screen'];
const medium = () => techniqueShots([[{ id: 'medium-shot' }], [{ id: 'medium-shot' }], [{ id: 'medium-shot' }], [{ id: 'medium-shot' }]]);
const beat = (frame, kind = 'reveal', label = 'the letter', id = 'story-beat-1') => ({ id, frame, label, kind });

test('A1: the curve per shot, the combined value and the per-cut contrast; master coverage climbs; byte-identical', () => {
	const { f, document } = coveredSequence({ push: false, roll: false, dissolve: false });
	try {
		const curve = sequenceIntensity(document);
		assert.deepEqual(curve.components, COMPONENTS);
		assert.equal(INTENSITY_COMPONENTS.reduce((sum, row) => sum + row.weight, 0).toFixed(6), '1.000000', 'the weights sum to 1');
		assert.equal(curve.shots.length, 5);
		for (const row of curve.shots) {
			assert.deepEqual(Object.keys(row.components), COMPONENTS, `${row.shotName}: every component`);
			for (const value of [...Object.values(row.components), row.combined]) assert.ok(value >= 0 && value <= 1, `${row.shotName}: 0-1`);
		}
		assert.equal(curve.cuts.length, 4);
		for (const cut of curve.cuts) assert.deepEqual(Object.keys(cut.contrast), COMPONENTS, 'the jump in each component at the cut');
		const c = curve.shots.map((row) => row.combined), [master, msA, msB, cuA, cuB] = c;
		assert.ok(master < Math.min(msA, msB) && Math.max(msA, msB) < Math.min(cuA, cuB), `the master, the mediums, the close-ups climb: ${c.join(' ')}`);
		assert.ok(cuB - master > 0.2, 'the close-ups sit well above the master');
		assert.deepEqual(curve.shots.map((row) => row.raw.rung[0]), [5, 3, 3, 1, 1], 'the size ladder: wide, medium, close-up');
		assert.ok(curve.cuts[0].contrast.size > 0.3 && curve.cuts[2].contrast.size > 0.3, 'the size steps at the master-to-medium and medium-to-close-up cuts');
		assert.ok(curve.shots[1].components.screen > 0.3, 'Mara jumps across the frame from the master to her medium');
		assert.equal(curve.peak.index, 5);
		assert.equal(JSON.stringify(sequenceIntensity(structuredClone(document))), JSON.stringify(curve), 'byte-identical on a second run');
		assert.deepEqual(sequenceIntensity(document, { range: { from: 2, to: 4 } }).shots.map((row) => row.shotId), curve.shots.slice(1, 4).map((row) => row.shotId), 'a range picks its shots');
		console.log(`PASS A1 master coverage climbs: ${c.join(' -> ')}; cuts ${curve.cuts.map((cut) => cut.total).join(', ')}`);
	} finally { f.dispose(); }
	const { f: g, document: same } = medium();
	try {
		const curve = sequenceIntensity(same);
		assert.equal(new Set(curve.shots.map((row) => row.combined)).size, 1, 'every shot at the same intensity');
		assert.deepEqual(curve.cuts.map((cut) => cut.total), [0, 0, 0], 'no cut changes anything');
		console.log(`PASS A1 all-medium same lens is flat: ${curve.shots.map((row) => row.combined).join(' ')}`);
	} finally { g.dispose(); }
	// A pushed shot moves, a rolled shot rolls, and the components say so.
	const { f: h, document: rich } = coveredSequence({ dissolve: false });
	try {
		const rows = sequenceIntensity(rich).shots;
		assert.ok(rows[1].components.speed > 0 && rows[0].components.speed === 0, 'the push-in on shot 2 reads as camera speed');
		assert.ok(rows[3].components.roll > 0.5, 'the 12-degree roll on shot 4');
	} finally { h.dispose(); }
});

test('A2: flat is flagged with a technique stack that camera.applyTechnique applies, and the curve changes', () => {
	const { f, document } = medium();
	try {
		const out = checkStructure(document);
		assert.deepEqual(out.rules, ['flat'], 'with no story beats only the beat-free rule runs');
		assert.deepEqual(out.issues.map((issue) => [issue.rule, issue.frames, issue.shots]), [['flat', [0, 191], [1, 4]]]);
		const { suggestion } = out.issues[0];
		assert.equal(suggestion.shotId, 'shot-3');
		assert.deepEqual(suggestion.stack, [{ id: 'medium-close-up', params: { focalMm: 50 } }, { id: 'low-angle' }], 'one size tighter on a longer lens, from a lower angle');
		assert.ok(suggestion.stack.every((row) => techniqueById(row.id)), 'technique ids from the library');
		assert.equal(suggestion.text, 'one size tighter (medium close-up), a lower angle, a longer lens (50 mm)');
		assert.match(structureWords(out), /^intensity holds level at about 0\.33 across beats 1-4; flat over beats 1-4\.$/);
		const receipt = f.run(suggestion.action, suggestion.args, 'agent');
		assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 300));
		const after = checkStructure(documentOf(f, { frameCount: document.frameCount }));
		assert.ok(after.curve.shots[2].combined > out.curve.shots[2].combined + 0.05, 'shot 3 rises');
		assert.equal(after.issues.filter((issue) => issue.rule === 'flat').length, 0, 'the flat stretch is broken');
		console.log(`PASS A2 flat: ${out.issues[0].message} Try: ${suggestion.text}. After: ${after.curve.shots.map((row) => row.combined).join(' ')}`);
	} finally { f.dispose(); }
	const { f: g, document: covered } = coveredSequence({ push: false, roll: false, dissolve: false });
	try { assert.equal(checkStructure(covered).issueCount, 0, 'master coverage climbs: nothing flat'); } finally { g.dispose(); }
});

test('A2: peak-off-beat and no-build read the story beats', () => {
	const { f, document } = coveredSequence({ push: false, roll: false, dissolve: false });
	try {
		const shots = sequenceIntensity(document).shots, inShot = (n, offset = 5) => shots[n - 1].startFrame + offset;
		const off = checkStructure({ ...document, storyBeats: [beat(inShot(2))] });
		assert.deepEqual(off.rules, ['flat', 'peak-off-beat', 'no-build']);
		assert.deepEqual(off.issues.map((issue) => issue.rule), ['peak-off-beat'], 'the reveal sits in the medium, the peak in the close-ups');
		assert.deepEqual(off.issues[0].frames, [shots[4].startFrame, shots[4].endFrame]);
		assert.equal(off.issues[0].suggestion.shotId, shots[1].shotId, 'the suggestion raises the beat\'s shot');
		assert.deepEqual(off.issues[0].suggestion.stack.map((row) => row.id), ['medium-close-up', 'low-angle']);
		assert.deepEqual(checkStructure({ ...document, storyBeats: [beat(inShot(5))] }).issues.map((issue) => issue.rule), ['no-build'], 'the reveal on the peak shot: on the peak, but the cut from close-up to close-up does not rise into it');
		assert.equal(checkStructure({ ...document, storyBeats: [beat(inShot(4))] }).issueCount, 0, 'the peak holds or follows the beat');
		assert.equal(checkStructure({ ...document, storyBeats: [beat(inShot(2), 'reveal'), beat(inShot(5), 'event', 'a door', 'story-beat-2')] }).issues[0].rule, 'peak-off-beat', 'the strongest beat decides, not the last');
		const skip = checkStructure({ ...document, storyBeats: [beat(inShot(2))] }, { range: { shotIds: [shots[0].shotId, shots[4].shotId] } });
		assert.equal(skip.beats.length, 0, 'shotIds that skip shot 2 leave its reveal out');
		assert.equal(skip.issues.filter((issue) => issue.beat).length, 0, 'no beat rule judges a skipped shot\'s beat against the next selected shot');
		// No build: the decision falls on the second of the two mediums (Joon's), which sits under Mara's.
		const flatInto = checkStructure({ ...document, storyBeats: [beat(inShot(3), 'decision', 'Joon decides')] });
		assert.ok(flatInto.issues.some((issue) => issue.rule === 'no-build' && issue.frames[0] === shots[1].startFrame && issue.frames[1] === inShot(3)), JSON.stringify(flatInto.issues.map((i) => i.message)));
		const noBuild = flatInto.issues.find((issue) => issue.rule === 'no-build');
		assert.equal(noBuild.severity, 'high');
		assert.match(noBuild.message, /^Intensity does not rise into decision "Joon decides" at f\d+: shot 2 '.*' 0\.\d\d, shot 3 '.*' 0\.\d\d\.$/);
		assert.equal(noBuild.suggestion.shotId, shots[2].shotId);
		assert.equal(checkStructure({ ...document, storyBeats: [beat(inShot(4), 'threat', 'the gun')] }).issueCount, 0, 'a threat on the cut to the close-up builds');
		assert.equal(checkStructure({ ...document, storyBeats: [beat(inShot(3), 'event', 'a look')] }).issues.filter((i) => i.rule === 'no-build').length, 0, 'an event asks for no build');
		assert.equal(checkStructure({ ...document, storyBeats: [beat(inShot(3), 'event', 'a look')] }, { beat: 'a look' }).issues.filter((i) => i.rule === 'no-build').length, 1, '"build to the look" asks for one');
		console.log(`PASS A2 peak-off-beat: ${off.issues[0].message} Try: ${off.issues[0].suggestion.text}.`);
		console.log(`PASS A2 no-build: ${noBuild.message} Try: ${noBuild.suggestion.text}.`);
	} finally { f.dispose(); }
});

test('A4: the strip renders as an image of the asked dimensions', () => {
	const { f, document } = coveredSequence({ push: false, roll: false, dissolve: false });
	try {
		const result = checkStructure({ ...document, storyBeats: [beat(60)] }), options = { beats: result.beats, issues: result.issues };
		const image = stripImage(result.curve, options);
		assert.deepEqual([image.width, image.height, image.data.length], [STRIP_SIZE.width, STRIP_SIZE.height, 960 * 160 * 4], 'default 960 x 160 RGBA');
		const small = stripImage(result.curve, { ...options, width: 400, height: 80, frameCount: 240 });
		assert.deepEqual([small.width, small.height, small.data.length], [400, 80, 400 * 80 * 4]);
		assert.ok(small.data.every((value, i) => i % 4 !== 3 || value === 255), 'opaque');
		const layout = stripLayout(result.curve, { components: ['size', 'cutting'], beats: result.beats });
		assert.deepEqual(layout.series.map((row) => row.id), ['size', 'cutting', 'combined'], 'the toggled components, then the combined curve');
		assert.equal(layout.series.at(-1).points.length, 10, 'two points per shot');
		assert.deepEqual(layout.beats.map((row) => row.frame), [60]);
		assert.equal(stripLayout(result.curve).series.length, 1, 'the combined curve alone by default');
		const peak = result.curve.shots[4], [px, py] = layout.series.at(-1).points[8], at = (Math.round(py) * image.width + Math.round(px + 10)) * 4;
		assert.deepEqual([...image.data.slice(at, at + 3)], [242, 242, 245], `the combined curve is drawn at the peak (${peak.combined})`);
		assert.equal(Buffer.from(stripImage(result.curve, options).data).equals(Buffer.from(image.data)), true, 'the same pixels on a second run');
		assert.equal(INTENSITY_COMPONENT_IDS.length, 7);
		console.log(`PASS A4 strip image: ${image.width}x${image.height}, ${small.width}x${small.height}`);
	} finally { f.dispose(); }
});
