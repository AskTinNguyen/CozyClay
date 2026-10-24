// A small top-down plan of what a technique does to the camera, drawn from
// its own recipe: the technique is compiled on a nominal two-person scene and
// the camera's path (sampled exactly as playback samples keys, or the rail
// the editor would ride) is fitted into a little box. Pure geometry; the
// picker (panels/TechniquePicker.jsx) only draws it.
import { cameraMoveAt } from "../camera-move.js";
import { buildRail } from "../camera-follow.js";
import { focalMmToFov } from "../shot.js";
import { compileStack } from "./compile.js";

const FILMBACK = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const SUBJECT = { id: "subject", name: "Subject", x: 0, z: 0, rot: 0, height: 1.8 };
const PARTNER = { id: "partner", name: "Partner", x: 1.5, z: 1.6, rot: -137, height: 1.8 };
const DEG = 180 / Math.PI;

const toFraming = (exact) => {
	const d = { x: exact.lookAt.x - exact.position.x, y: exact.lookAt.y - exact.position.y, z: exact.lookAt.z - exact.position.z };
	return { pos: { ...exact.position }, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fovDeg: focalMmToFov(exact.focalMm, FILMBACK.sensorId, FILMBACK.aspectRatio) * DEG };
};

/**
 * @param {Array<string|{id:string,params?:object}>} stack
 * @param {{width?:number,height?:number,pad?:number}} [box]
 * @returns {null | { path: Array<[number,number]>, start: [number,number], end: [number,number], wedge: Array<[number,number]>,
 *   cast: Array<{at:[number,number], facing:[number,number], subject:boolean}>, rail: boolean, still: boolean }}
 */
export function techniqueDiagram(stack, { width = 132, height = 92, pad = 10 } = {}) {
	let plan;
	try { plan = compileStack(stack, { subject: SUBJECT, cast: [SUBJECT, PARTNER], shot: { startFrame: 0, endFrame: 71 }, filmback: FILMBACK, camera: { position: { x: 1.2, y: 1.6, z: 4 }, lookAt: { x: 0, y: 1.3, z: 0 }, focalMm: 35 } }); } catch { return null; }
	if (!plan.keys && !plan.rail) return null;
	let world, look, first = null;
	if (plan.rail) {
		world = (buildRail(plan.rail.points)?.points ?? plan.rail.points).map((p) => ({ x: p.x, z: p.z }));
		look = { yaw: Math.atan2(world.at(-1).x - SUBJECT.x, world.at(-1).z - SUBJECT.z), fov: focalMmToFov(plan.rail.focalMm, FILMBACK.sensorId, FILMBACK.aspectRatio) };
	} else {
		const keys = plan.keys.map((key) => ({ ...key, framing: toFraming(key.framing) })), last = keys.at(-1).frame;
		world = Array.from({ length: keys.length > 1 ? 49 : 1 }, (_, i) => cameraMoveAt(keys, SUBJECT, (last * i) / 48 || 0, FILMBACK).pos);
		const end = keys.at(-1).framing;
		look = { yaw: end.yaw, fov: end.fovDeg / DEG };
		first = { yaw: keys[0].framing.yaw, fov: keys[0].framing.fovDeg / DEG };
	}
	const endPos = world.at(-1), reach = Math.max(0.8, Math.hypot(endPos.x - SUBJECT.x, endPos.z - SUBJECT.z) * 0.7);
	// The lens's horizontal field as two rays from a camera position.
	const rays = (from, aim) => {
		const forward = { x: -Math.sin(aim.yaw), z: -Math.cos(aim.yaw) }, hfov = Math.atan(Math.tan(aim.fov / 2) * FILMBACK.aspectRatio);
		return [1, -1].map((sign) => ({ x: from.x + (forward.x * Math.cos(hfov) - sign * forward.z * Math.sin(hfov)) * reach, z: from.z + (forward.z * Math.cos(hfov) + sign * forward.x * Math.sin(hfov)) * reach }));
	};
	const endRays = rays(endPos, look), startRays = first ? rays(world[0], first) : null;
	const cast = [SUBJECT, ...(plan.members?.length || /over|pov|two|three|master/.test(JSON.stringify(stack)) ? [PARTNER] : [])];
	const all = [...world, ...cast, ...endRays, ...(startRays ?? [])];
	const xs = all.map((p) => p.x), zs = all.map((p) => p.z), span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1.5);
	const scale = Math.min((width - 2 * pad) / span, (height - 2 * pad) / span), cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
	const at = (p) => [Math.round((width / 2 + (p.x - cx) * scale) * 10) / 10, Math.round((height / 2 + (p.z - cz) * scale) * 10) / 10];
	return {
		path: world.map(at), start: at(world[0]), end: at(endPos), wedge: [at(endRays[0]), at(endPos), at(endRays[1])], startWedge: startRays ? [at(startRays[0]), at(world[0]), at(startRays[1])] : null, rail: Boolean(plan.rail), still: world.length === 1 || Math.hypot(endPos.x - world[0].x, endPos.z - world[0].z) < 0.05,
		cast: cast.map((row) => ({ at: at(row), facing: at({ x: row.x + Math.sin(row.rot / DEG) * 0.45, z: row.z + Math.cos(row.rot / DEG) * 0.45 }), subject: row === SUBJECT })),
	};
}
