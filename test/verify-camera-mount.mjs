// A4: a body mount (Snorricam) rides a character's bone with an offset and a
// look back at the face, following the body per frame: across a moving take
// the subject's face holds its place in frame while a fixed point of the set
// sweeps across it. Works for a walking proxy figure (its path) and for the
// camera subject's take (its sampled root), and the exports bake it.
import assert from "node:assert/strict";
import { createCameraBlock } from "../src/camera-block.js";
import { BONE_HEIGHT, castPlacementAt, facePoint } from "../src/camera-capabilities/mount.js";
import { sampleAt } from "../src/sample-at.js";
import { readShotAuthoring, serializeShotAuthoring } from "../src/shot-authoring.js";
import { serializeUsdCamera } from "../src/usd-camera.js";
import { check, done, joon, makeScene, makeShot, mara, project } from "./camera-capabilities-fixture.mjs";

// A proxy figure walks 6 m and turns: frame 0 at the origin facing +z, a bend at frame 48.
const walker = { id: "walker", model: "proxy-figure", x: 0, y: 0, z: 0, rot: 0, scale: 1, subject: "Ana, a runner",
	layer: { waypoints: [{ id: "w1", frame: 48, x: 0, z: 3, heading: null }, { id: "w2", frame: 95, x: 2.5, z: 5, heading: null }] } };
const scene = makeScene({ subject: mara, cast: [mara, joon, walker] });
const snorri = makeShot({ mount: { characterId: "walker", bone: "chest" } });
const landmark = { x: -2, y: 1.2, z: -6 }; // behind the walker, in the lens looking back at the face
const spread = (values) => Math.max(...values) - Math.min(...values);

check("the mount is stored and repaired with its defaults (chest, 0.6 m out and 0.25 m up, looking at the face)", () => {
	const state = readShotAuthoring(serializeShotAuthoring({ shots: [snorri], frameCount: 96 })).state;
	assert.deepEqual(state.shots[0].camera.mount, { characterId: "walker", bone: "chest", offset: { side: 0, up: 0.25, forward: 0.6 }, look: "face" });
	assert.equal(createCameraBlock({ mount: { characterId: "walker", bone: "back" } }).mount.look, "forward");
	assert.equal(createCameraBlock({ mount: { bone: "chest" } }).mount, undefined, "a mount needs a character");
});

check("the camera follows the bone per frame: chest height, in front of the body", () => {
	for (const frame of [0, 30, 60, 95]) {
		const camera = sampleAt(scene, snorri, frame).camera, placed = castPlacementAt(scene, snorri, "walker", frame);
		assert.ok(Math.abs(camera.pos.y - (BONE_HEIGHT.chest * 1.8 + 0.25)) < 1e-9);
		assert.ok(Math.abs(Math.hypot(camera.pos.x - placed.x, camera.pos.z - placed.z) - 0.6) < 1e-9, "0.6 m off the chest");
	}
});

check("the subject holds its place in frame while the world moves", () => {
	const frames = Array.from({ length: 12 }, (_, i) => i * 8 + 1), face = [], world = [];
	for (const frame of frames) {
		const camera = sampleAt(scene, snorri, frame).camera;
		face.push(project(camera, facePoint(castPlacementAt(scene, snorri, "walker", frame))));
		world.push(project(camera, landmark));
	}
	const faceSpread = Math.max(spread(face.map((p) => p.x)), spread(face.map((p) => p.y))), worldSpread = Math.max(spread(world.map((p) => p.x)), spread(world.map((p) => p.y)));
	console.log(`  face spread ${faceSpread.toExponential(2)} NDC, landmark spread ${worldSpread.toFixed(3)} NDC over frames ${frames[0]}-${frames.at(-1)}`);
	assert.ok(faceSpread < 0.01, "the face stays put");
	assert.ok(worldSpread > 0.3, "the set swings behind (and out of frame after the turn)");
});

check("on the camera subject's take the mount rides the sampled root", () => {
	const frames = 96, rootPos = new Float32Array(frames * 3);
	for (let i = 0; i < frames; i++) { rootPos[i * 3] = 0; rootPos[i * 3 + 1] = 1; rootPos[i * 3 + 2] = i * 0.05; }
	const take = { frames, rootPos, anchorX: 0, anchorZ: 0, anchorFrame: 0, rotationDeg: 0 };
	const withTake = makeScene({ motion: take }), shot = makeShot({ mount: { characterId: "char-mara", bone: "chest" } });
	const a = sampleAt(withTake, shot, 10).camera, b = sampleAt(withTake, shot, 80).camera;
	assert.ok(Math.abs((b.pos.z - a.pos.z) - 70 * 0.05) < 1e-4, "the rig travels with the take root");
	const faceA = project(a, facePoint(castPlacementAt(withTake, shot, "char-mara", 10, sampleAt(withTake, shot, 10).subject)));
	const faceB = project(b, facePoint(castPlacementAt(withTake, shot, "char-mara", 80, sampleAt(withTake, shot, 80).subject)));
	assert.ok(Math.hypot(faceA.x - faceB.x, faceA.y - faceB.y) < 0.01);
});

check("the USD export bakes the mounted camera per frame", () => {
	const usd = serializeUsdCamera(scene, snorri), at = sampleAt(scene, snorri, 72).camera;
	assert.ok(usd.includes(`        72: (${[at.pos.x, at.pos.y, at.pos.z].map((v) => Number(v.toPrecision(15))).join(", ")}),`));
	assert.match(usd, /custom string cozyclay:mount = "walker chest, looking at the face/);
});

done("A4 body mount");
