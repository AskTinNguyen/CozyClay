// Sculpt mode (#739): the pure parts of the fifth viewport mode. The stage
// component (sculpt-stage.jsx) and App use these; verify-sculpt-mode pins them.
import { placementInFront, SCULPT_KIND } from "./scene-objects.js";

/** The sculpt turntable's render layer. dualview.jsx owns 2-5; nothing else
 * draws on 6, so only the sculpt camera sees the turntable floor and lights. */
export const SCULPT_LAYER = 6;

/** Front / side / back, as azimuths from the sculpt's own front (+Z turned by
 * its yaw). Side is the subject's own left, sculpt.compare's positive yaw. */
export const SCULPT_VIEWS = Object.freeze({ front: 0, side: 90, back: 180 });

/** The sculpt the mode opens on: the selected object when it is a sculpt,
 * otherwise none (the first run creates one). */
export function sculptTargetFromSelection(objects, selectedId) {
	const object = (objects ?? []).find((row) => row.id === selectedId);
	return object?.renderer === SCULPT_KIND ? object.id : null;
}

/** The object ids the isolated turntable draws: the target and nothing else.
 * Every other object, character and the set stay in their records untouched;
 * they are simply not on the sculpt camera's layer. */
export function isolatedObjectIds(objects, targetId) {
	return (objects ?? []).some((row) => row.id === targetId) ? [targetId] : [];
}

/** Orbit target and camera position that frame `object` (size from
 * objectSize) from one of SCULPT_VIEWS through a `fovDeg` vertical lens. */
export function sculptFraming(object, size, view = "front", fovDeg = 35) {
	const height = Math.max(0.05, size?.height ?? 1);
	const radius = 0.5 * Math.hypot(size?.width ?? 1, height, size?.depth ?? 1);
	const base = object?.y ?? 0;
	const target = [object?.x ?? 0, base + height / 2, object?.z ?? 0];
	const distance = (radius / Math.sin(((fovDeg / 2) * Math.PI) / 180)) * 1.15;
	const azimuth = (((object?.rot ?? 0) + (SCULPT_VIEWS[view] ?? 0)) * Math.PI) / 180;
	// A slight look-down reads the volume; level would flatten it to the mask.
	const lift = distance * 0.18;
	return {
		target,
		position: [target[0] + Math.sin(azimuth) * distance, target[1] + lift, target[2] + Math.cos(azimuth) * distance],
		radius,
		floorY: base,
	};
}

/** Where Place in scene stands the sculpt: on the ground, in front of the
 * scene camera, with the same helper + Add uses. */
export function sculptPlacement(cameraPosition, yaw) {
	return { ...placementInFront({ x: cameraPosition.x, z: cameraPosition.z }, yaw), y: 0 };
}

const PENDING = new Set(["started", "queued", "running", "pending"]);

/**
 * The command feed a sculpt run listens to. The editor bus only announces
 * finished jobs, so the agent's live command handlers are wrapped to report
 * every receipt too; a receipt seen twice (a job reported by both) is fed once.
 * Events are `{ action, args, result }`, with a job's output merged into result.
 */
export function createCommandTap() {
	const listeners = new Set();
	const seen = new Set();
	const report = (request, receipt) => {
		if (!receipt?.ok || !receipt.action || PENDING.has(receipt.status)) return;
		if (receipt.receiptId) {
			if (seen.has(receipt.receiptId)) return;
			seen.add(receipt.receiptId);
		}
		const args = request?.args?.action === receipt.action ? request.args.args ?? {} : request?.args ?? {};
		const event = { action: receipt.action, args, result: { ...receipt, ...(receipt.output ?? {}) } };
		for (const listener of [...listeners]) listener(event);
	};
	return {
		report,
		/** Wrap live handlers so each receipt they answer is reported. */
		wrap(handlers) {
			return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (request, ...rest) => {
				const out = handler(request, ...rest);
				if (out?.then) return out.then((value) => { report(request, value); return value; });
				report(request, out);
				return out;
			}]));
		},
		/** createSculptRun's `bus`: tap events plus the editor bus's finished jobs. */
		subscribe(listener, bus = null) {
			listeners.add(listener);
			const off = bus?.subscribe?.((event) => { if (event?.type === "job.completed") report(null, event.receipt); });
			return () => { listeners.delete(listener); off?.(); };
		},
	};
}

/** The studio agent client a sculpt run turns through: the Agent panel's
 * transport, with the live editor context every Studio turn must carry. */
export function sculptAgentClient(transport, readContext) {
	return { turn: (request, onEvent, signal) => transport.turn({ ...request, context: readContext() }, onEvent, signal) };
}

/** Readiness for Start, from the transport's status (the Agent panel's rule:
 * signed in, or a provider key held by the sidecar). */
export const agentSessionReady = (status) => Boolean(status?.signedIn || status?.providersConfigured > 0);

/** A stored image asset as a data URL (the bytes the store holds, so the run
 * scores against exactly the stored, possibly downscaled, picture). */
export function assetDataUrl(asset) {
	const bytes = new Uint8Array(asset.bytes);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return `data:${asset.type};base64,${globalThis.btoa(binary)}`;
}
