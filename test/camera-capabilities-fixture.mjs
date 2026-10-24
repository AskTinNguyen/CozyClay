// Shared scene, shot and projection helpers for the camera-capabilities
// verify files: a two-character set (Mara at the origin, Joon behind her),
// a 96-frame shot with one held framing, and a three.js projection of world
// points through a sampled camera (roll included), as the renderer sees them.
import * as THREE from "three";
import { createShot } from "../src/cuts.js";
import { focalMmToFov } from "../src/shot.js";

const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
export const mara = { id: "char-mara", model: "y-bot-tpose", x: 0, y: 0, z: 0, rot: 0, scale: 1, subject: "Mara, a woman in a red coat" };
export const joon = { id: "char-joon", model: "x-bot-tpose", x: 1.2, y: 0, z: -3, rot: 0, scale: 1, subject: "Joon, a man in a grey suit" };

/** A framing record looking from `position` at `lookAt` through a lens of focalMm. */
export function framingAt(position, lookAt, focalMm = 50) {
	const d = { x: lookAt.x - position.x, y: lookAt.y - position.y, z: lookAt.z - position.z };
	return { pos: { ...position }, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fovDeg: (focalMmToFov(focalMm, filmback.sensorId, filmback.aspectRatio) * 180) / Math.PI };
}

export const heldFraming = framingAt({ x: 0.4, y: 1.6, z: 3 }, { x: 0, y: 1.5, z: 0 });

export function makeScene(extra = {}) {
	return { frameCount: 96, fps: 24, subject: mara, cameraAnchor: mara, fovDeg: 40, filmback, cast: [mara, joon], ...extra };
}

export function makeShot(camera = {}, keys = [{ id: "key-0", frame: 0, framing: heldFraming }], range = [0, 95]) {
	return { ...createShot("Test", range[0], range[1], keys), id: "shot-test", camera: { mode: "keys", ...camera } };
}

/** NDC [-1, 1] of a world point through a sampled camera (pos, yaw, pitch, rollDeg, fovDeg), 16:9. */
export function project(camera, point) {
	const cam = new THREE.PerspectiveCamera(camera.fovDeg, 16 / 9, 0.05, 200);
	cam.position.set(camera.pos.x, camera.pos.y, camera.pos.z);
	cam.rotation.order = "YXZ";
	cam.rotation.set(camera.pitch, camera.yaw, ((camera.rollDeg ?? 0) * Math.PI) / 180);
	cam.updateMatrixWorld();
	const v = new THREE.Vector3(point.x, point.y, point.z).project(cam);
	return { x: v.x, y: v.y };
}

let passed = 0;
export function check(name, fn) {
	fn();
	passed++;
	console.log("ok -", name);
}
export const done = (label) => console.log(`${passed} checks passed (${label})`);
