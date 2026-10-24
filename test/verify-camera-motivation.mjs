// camera-motivation A2 and A3: the motivation check. Each shot's measured
// camera splits into move segments, each motivated by a beat (a story beat or a
// motion beat), by its subject, or unmotivated; a beat more than the tolerance
// from the move's start or rest flags starts-off-beat / settles-off-beat, each
// issue with a severity, the frames and a fix. A3: no issue on any camera.cover
// pattern's shots or on a follow camera of a walking subject; a push-in laid
// in a beatless window is flagged. Constructed good and bad moves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShot } from '../src/cuts.js';
import { checkMotivation, motivationReason } from '../src/camera-motivation/check.js';
import { COVERAGE_PATTERN_IDS } from '../src/camera-coverage/patterns.js';
import { coveredSequence } from './bus/sequence-fixture.mjs';

const at = (z, extra = {}) => ({ pos: { x: 0, y: 1.6, z }, yaw: 0, pitch: 0, fovDeg: 40, ...extra });
const keyed = (id, start, end, keys) => ({ ...createShot(id, start, end, keys.map(([frame, framing], i) => ({ id: `${id}-k${i}`, frame, framing }))), id });
const push = keyed('shot-push', 96, 191, [[100, at(5)], [140, at(2.5)]]);
const doc = (extra = {}) => ({ fps: 24, frameCount: 240, filmback: { sensorId: 'fullFrame', aspectRatio: 16 / 9 }, cast: [{ id: 'mara', subject: 'Mara', x: 0, z: 0, rot: 0 }], shots: [push], storyBeats: [], ...extra });
const beat = (frame, label = 'admission', kind = 'disclosure', id = 'story-beat-1') => ({ id, frame, label, kind });
const only = (result) => result.shots[0].segments[0];

test('A2: a push-in with no beat is unmotivated; a beat inside it motivates it, off its start it flags', () => {
	const bare = checkMotivation(doc());
	assert.equal(bare.segments, 1);
	const seg = only(bare);
	assert.deepEqual([seg.startFrame, seg.endFrame, seg.moveId], [100, 140, 'push-in'], 'the segment runs from the last still frame to the frame it rests');
	assert.equal(seg.motivation.by, null);
	assert.deepEqual(bare.issues.map((row) => [row.rule, row.severity, row.frames]), [['unmotivated', 'high', [100, 140]]]);
	assert.match(bare.issues[0].fix.text, /^hold \(lock the camera off\)/);
	assert.deepEqual(bare.sources, ['subject travel'], 'with no beats the check says it read subject travel only');

	const late = checkMotivation(doc({ storyBeats: [beat(120)] }));
	assert.equal(only(late).motivation.by, 'beat');
	assert.deepEqual(late.issues.map((row) => [row.rule, row.severity, row.frames]), [['starts-off-beat', 'medium', [100, 120]]], '20 frames off, past three tolerances: medium');
	assert.equal(late.issues[0].fix.text, "start the push at f120 on 'admission'");
	assert.deepEqual(late.issues[0].fix.args, { shotId: 'shot-push', beat: 'story-beat-1', edge: 'start', segment: 0 });
	assert.equal(late.issues[0].fix.action, 'camera.alignMove');
	assert.match(late.issues[0].message, /The push starts at f100, 20 frames before 'admission' \(f120\)\./);

	assert.equal(checkMotivation(doc({ storyBeats: [beat(110)] })).issues[0].severity, 'low', '10 frames off: low');
	assert.equal(checkMotivation(doc({ storyBeats: [beat(102)] })).issueCount, 0, 'within the tolerance of its start: clean');
	assert.equal(checkMotivation(doc({ storyBeats: [beat(95)] })).issueCount, 0, 'a beat just before the move motivates it');
	assert.equal(checkMotivation(doc({ storyBeats: [beat(120)] }), { tolerance: 24 }).issueCount, 0, 'a wider tolerance accepts it');
	assert.equal(checkMotivation(doc({ storyBeats: [beat(60)] })).issues[0].rule, 'unmotivated', 'a beat long before the move does not motivate it');
	assert.equal(motivationReason(only(checkMotivation(doc({ storyBeats: [beat(100, 'Mara makes her admission')] })))), 'pushes in as Mara makes her admission');
	console.log('PASS A2 beats: unmotivated / starts-off-beat (medium, low) / clean, tolerance, fixes');
});

test('A2: a motion beat motivates a move, and a move that rests off its landing settles off the beat', () => {
	const jump = { characterId: 'mara', name: 'Mara', startFrame: 0, timeline: [], observations: { balance: { air: [[100, 165]] } }, objects: {}, yaw: [] };
	const shot = keyed('shot-jump', 96, 191, [[100, at(5)], [156, at(3)]]);
	const out = checkMotivation(doc({ shots: [shot], motion: [jump] }));
	assert.equal(only(out).motivation.by, 'beat');
	assert.equal(only(out).motivation.beat.kind, 'jump', 'the take-off starts it');
	assert.deepEqual(out.issues.map((row) => [row.rule, row.severity, row.frames]), [['settles-off-beat', 'low', [156, 166]]]);
	assert.equal(out.issues[0].fix.text, 'settle on the landing at f166');
	assert.deepEqual(out.issues[0].fix.args, { shotId: 'shot-jump', beat: 166, edge: 'settle', segment: 0 }, 'a motion beat is named by its frame');
	assert.deepEqual(out.sources, ['motion beats', 'subject travel']);
	const landed = checkMotivation(doc({ shots: [keyed('shot-land', 96, 191, [[100, at(5)], [164, at(3)]])], motion: [jump] }));
	assert.equal(landed.issueCount, 0, 'resting within the tolerance of the landing is clean');
	const walk = { characterId: 'mara', name: 'Mara', startFrame: 0, timeline: [{ beat: 'walk', f: [120, 170] }], observations: {}, objects: {}, yaw: [] };
	const pan = keyed('shot-pan', 96, 191, [[122, at(5)], [150, at(5, { yaw: 0.4 })]]);
	const panned = checkMotivation(doc({ shots: [pan], motion: [walk] }));
	assert.equal(only(panned).moveId, 'pan-left');
	assert.equal(panned.issueCount, 0);
	assert.equal(motivationReason(only(panned)), 'pans left as Mara starts walking');
	console.log('PASS A2 motion beats: take-off, landing (settles-off-beat, clean), walk start');
});

test('A3: no issue on any coverage pattern, a held shot, or a camera that follows a walking subject; a push-in in a beatless window is flagged', () => {
	for (const pattern of COVERAGE_PATTERN_IDS) {
		const { f, document } = coveredSequence({ pattern, push: false, roll: false, dissolve: false });
		try {
			const out = checkMotivation(document);
			assert.equal(out.issueCount, 0, `${pattern}: ${out.issues.map((row) => row.message).join(' ')}`);
			console.log(`PASS A3 ${pattern}: ${out.shots.length} shots, ${out.segments} moves (${out.shots.flatMap((row) => row.segments.map((segment) => `${segment.moveId} by ${segment.motivation.by}`)).join(', ') || 'all holds'}), 0 issues`);
		} finally { f.dispose(); }
	}
	const held = keyed('shot-held', 0, 95, [[0, at(5)], [60, at(5)]]);
	assert.equal(checkMotivation(doc({ shots: [held] })).segments, 0, 'a hold is no move');
	// A follow camera of a walking subject: the rig follows its subject, so it is never flagged.
	const follow = { ...createShot('Follow', 0, 95, []), id: 'shot-follow', camera: { mode: 'follow' } };
	const walking = { id: 'mara', subject: 'Mara', x: 0, z: 0, rot: 90, layer: { waypoints: [{ frame: 0, x: 0, z: 0 }, { frame: 95, x: 4, z: 0 }] } };
	const followed = checkMotivation(doc({ shots: [follow], cast: [walking] }));
	assert.deepEqual([followed.issueCount, followed.shots[0].follow], [0, true]);
	// A keyed camera that travels with her as she walks 4 m along +x (placed per frame, as the studio samples the take root).
	const walkAt = (row, shot, frame) => ({ id: row.id, name: 'Mara', x: 4 * Math.max(0, Math.min(1, (frame - 10) / 80)), z: 0, rot: 90, height: 1.8 });
	const track = keyed('shot-track', 0, 95, [[10, { pos: { x: 0, y: 1.6, z: 4 }, yaw: 0, pitch: 0, fovDeg: 40 }], [90, { pos: { x: 4, y: 1.6, z: 4 }, yaw: 0, pitch: 0, fovDeg: 40 }]]);
	const tracked = checkMotivation(doc({ shots: [track], cast: [walking] }), { placeAt: walkAt });
	assert.equal(tracked.issueCount, 0, tracked.issues.map((row) => row.message).join(' '));
	assert.deepEqual(only(tracked).motivation, { by: 'subject', how: "follows the subject's travel", subjectId: 'mara' });
	assert.match(motivationReason(only(tracked), 'Mara'), /, following Mara's travel$/);
	const panWith = keyed('shot-panwith', 0, 95, [[10, { pos: { x: 2, y: 1.6, z: 6 }, yaw: 0.32, pitch: 0, fovDeg: 40 }], [90, { pos: { x: 2, y: 1.6, z: 6 }, yaw: -0.32, pitch: 0, fovDeg: 40 }]]);
	assert.equal(checkMotivation(doc({ shots: [panWith], cast: [walking] }), { placeAt: walkAt }).issueCount, 0, 'a pan that keeps her on screen follows her');
	assert.equal(checkMotivation(doc({ shots: [track], cast: [walking] })).issues[0]?.rule, 'unmotivated', 'the same move with her standing still answers to nothing');

	const { f, document } = coveredSequence({ roll: false, dissolve: false });
	try {
		const out = checkMotivation(document), pushed = document.shots[1];
		assert.deepEqual(out.issues.map((row) => [row.shotId, row.rule, row.severity]), [[pushed.id, 'unmotivated', 'high']], 'only the push-in laid in a beatless window is flagged');
		assert.match(out.issues[0].message, /^The push over f\d+-\d+ has no story beat, motion beat or travelling subject to answer to\.$/);
		console.log(`PASS A3 flag: ${out.issues[0].message} Fix: ${out.issues[0].fix.text}.`);
	} finally { f.dispose(); }
});
