// Camera polish A3: the snorricam carries the walk bob. With a baked take whose
// hips rise and fall, the mounted camera's height follows the hips' change
// (within 1 mm a frame), the face holds its place in frame while the set bobs
// behind it, the character's scale scales the bob, and a take without a hips
// track, a proxy figure or no take leaves the mount as it was. On a compiled
// walk the mount also rides the hips' path and heading (the frozen motion
// files are only imported here).
import assert from "node:assert/strict";
import { castPlacementAt, facePoint, hipsRise } from "../src/camera-capabilities/mount.js";
import { sampleAt } from "../src/sample-at.js";
import { check, done, joon, makeScene, makeShot, mara, project } from "./camera-capabilities-fixture.mjs";
import { compileSpec } from "../src/motion3/pipeline.js";
import { motionScene } from "../src/motion3/scene.js";
import { skeletonFor } from "../src/motion3/rigs/index.js";
import { bakeTake } from "../src/motion3/take.js";

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

check("on a compiled walk (take v3) the mount rides the hips' path and heading, the face fixed in frame", () => {
	const sk = skeletonFor("y-bot-tpose"), walker = { ...mara, x: -1.2, z: 0, rot: 90 };
	const spec = { schema: "cozyclay.motion-spec.v1", frames: 300, use: [
		{ skill: "standIdle", f0: 0, args: { at: [-1.2, 0], heading: 180, until: 30 } }, { skill: "walkTo", f0: 30, args: { to: [-1.2, -5] } }] };
	const compiled = compileSpec(spec, { sk, scene: motionScene([]) }, { lenient: true });
	const walk = bakeTake(sk, compiled.out, { position: [walker.x, 0, walker.z], yaw: walker.rot });
	const scene = makeScene({ subject: walker, cameraAnchor: walker, cast: [walker, joon], motion: walk, frameCount: 300 });
	const faces = [], rises = [];
	for (let f = 60; f <= 240; f += 6) {
		const camera = sampleAt(scene, shot, f).camera, placement = castPlacementAt(scene, shot, "char-mara", f);
		faces.push(project(camera, facePoint(placement)));
		rises.push(placement.bob);
	}
	const start = castPlacementAt(scene, shot, "char-mara", 30), end = castPlacementAt(scene, shot, "char-mara", 290);
	const faceSpread = Math.max(...faces.map((p) => Math.hypot(p.x - faces[0].x, p.y - faces[0].y)));
	assert.ok(Math.hypot(end.x - -1.2, end.z - -5) < 0.25, `the body ends near the walk's goal (${end.x.toFixed(2)}, ${end.z.toFixed(2)})`);
	const midway = castPlacementAt(scene, shot, "char-mara", 150).rot, off = (a) => Math.abs(((a - 180) % 360 + 540) % 360 - 180);
	assert.ok(off(midway) < 15, `walking toward -z the heading reads ${midway.toFixed(1)}° from the hips, not the character's 90°`);
	assert.ok(faceSpread < 0.01, `face spread ${faceSpread.toFixed(4)} NDC across the walk`);
	const headings = Array.from({ length: 21 }, (_, i) => castPlacementAt(scene, shot, "char-mara", 90 + i * 5).rot), twist = Math.max(...headings) - Math.min(...headings);
	assert.ok(twist < 3, `the pelvis twist stays out of the heading on the straight (${twist.toFixed(2)}°)`);
	const bobRange = Math.max(...rises) - Math.min(...rises);
	assert.ok(bobRange > 0.01 && bobRange < 0.06, `the walk bobs ${(bobRange * 100).toFixed(1)} cm`);
	console.log(`  walked to (${end.x.toFixed(2)}, ${end.z.toFixed(2)}), heading ${start.rot.toFixed(0)}° -> ${end.rot.toFixed(0)}°, heading twist ${twist.toFixed(2)}°, face spread ${faceSpread.toFixed(4)} NDC, bob ${(bobRange * 100).toFixed(1)} cm`);
});

done("camera-polish A3 walk bob");
