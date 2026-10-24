// Camera polish A3: the snorricam carries the walk bob. With a baked take whose
// hips rise and fall, the mounted camera's height follows the hips' change
// (within 1 mm a frame), the face holds its place in frame while the set bobs
// behind it, the character's scale scales the bob, and a take without a hips
// track, a proxy figure or no take leaves the mount as it was.
import assert from "node:assert/strict";
import { castPlacementAt, facePoint, hipsRise } from "../src/camera-capabilities/mount.js";
import { sampleAt } from "../src/sample-at.js";
import { check, done, joon, makeScene, makeShot, mara, project } from "./camera-capabilities-fixture.mjs";

// A v3 take: 96 frames, hips 0.95 m high bobbing 3 cm twice a step (a step every 12 frames).
const frameCount = 96, hips = new Float32Array(frameCount * 3);
const bobAt = (f) => 0.03 * Math.sin((f / 12) * 2 * Math.PI);
for (let f = 0; f < frameCount; f++) { hips[f * 3] = 0; hips[f * 3 + 1] = 0.95 + bobAt(f); hips[f * 3 + 2] = 0; }
const take = { frameCount, bones: ["Hips"], hips };
const mount = { mount: { characterId: "char-mara", bone: "chest" } };
const shot = makeShot(mount), withTake = makeScene({ motion: take }), without = makeScene();
const landmark = { x: 1.5, y: 1.0, z: 6 }; // the set behind the camera's look back at Mara's face
const TOP = 3, BOTTOM = 9; // a quarter step: hips highest, then lowest

check("hipsRise reads the take's hips against its first frame", () => {
	assert.ok(Math.abs(hipsRise(take, TOP) - bobAt(TOP)) < 1e-6 && Math.abs(hipsRise(take, BOTTOM) - bobAt(BOTTOM)) < 1e-6);
	assert.ok(Math.abs(hipsRise(take, 4.5) - (bobAt(4) + bobAt(5)) / 2) < 1e-6, "fractional frames interpolate");
	assert.equal(hipsRise(null, 10), 0);
	assert.equal(hipsRise({ frameCount, bones: ["Hips"] }, 10), 0, "no hips track, no bob");
});

check("the mounted camera rides the hips frame by frame", () => {
	const base = sampleAt(without, shot, 0).camera.pos.y;
	for (let f = 0; f < 48; f++) {
		const y = sampleAt(withTake, shot, f).camera.pos.y;
		assert.ok(Math.abs(y - base - bobAt(f)) < 0.001, `frame ${f}: camera rose ${(y - base).toFixed(4)} m, hips ${bobAt(f).toFixed(4)} m`);
	}
	const top = sampleAt(withTake, shot, TOP).camera, bottom = sampleAt(withTake, shot, BOTTOM).camera;
	console.log(`  camera ${top.pos.y.toFixed(3)} m at the top of the step, ${bottom.pos.y.toFixed(3)} m at the bottom`);
});

check("the face holds still in frame while the set bobs behind it", () => {
	const at = (frame) => {
		const camera = sampleAt(withTake, shot, frame).camera;
		return { face: project(camera, facePoint(castPlacementAt(withTake, shot, "char-mara", frame))), set: project(camera, landmark) };
	};
	const top = at(TOP), bottom = at(BOTTOM);
	assert.ok(Math.hypot(top.face.x - bottom.face.x, top.face.y - bottom.face.y) < 0.002, `face moved ${JSON.stringify([top.face, bottom.face])}`);
	const setShift = Math.abs(top.set.y - bottom.set.y);
	assert.ok(setShift > 0.01, `the set shifts ${setShift.toFixed(4)} NDC between the top and the bottom of a step`);
	console.log(`  face still (${top.face.y.toFixed(3)} / ${bottom.face.y.toFixed(3)} NDC), set shifts ${setShift.toFixed(3)} NDC`);
});

check("scale scales the bob; a proxy figure, no take or no hips track leave the mount level", () => {
	const tall = { ...mara, scale: 1.2 }, scene = makeScene({ subject: tall, cameraAnchor: tall, cast: [tall, joon], motion: take });
	assert.ok(Math.abs(castPlacementAt(scene, shot, "char-mara", TOP).bob - 1.2 * bobAt(TOP)) < 1e-6);
	const proxy = { ...mara, model: "proxy-figure" }, proxyScene = makeScene({ subject: proxy, cameraAnchor: proxy, cast: [proxy, joon], motion: take });
	assert.equal(castPlacementAt(proxyScene, shot, "char-mara", TOP).bob, 0);
	const flat = makeScene({ motion: { frameCount, bones: ["Hips"] } });
	assert.equal(sampleAt(flat, shot, TOP).camera.pos.y, sampleAt(without, shot, TOP).camera.pos.y);
	assert.equal(castPlacementAt(without, shot, "char-mara", TOP).bob, 0);
});

check("a cast member's own session take bobs its mount too", () => {
	const walker = { ...joon, sessionMotion: take }, scene = makeScene({ cast: [mara, walker] });
	const onJoon = makeShot({ mount: { characterId: "char-joon", bone: "chest" } });
	assert.ok(Math.abs(castPlacementAt(scene, onJoon, "char-joon", TOP).bob - bobAt(TOP)) < 1e-6);
});

done("camera-polish A3 walk bob");
