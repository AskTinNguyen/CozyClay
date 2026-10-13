import assert from "node:assert/strict";
import { createPoseDetector } from "../src/pose-extract/detector.js";

function pass(label) { console.log(`PASS ${label}`); }

/* --- createPoseDetector failure names -------------------------------------- */

const okModelFetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });

{
	const failed = await createPoseDetector({
		loadRuntime: async () => { throw new Error("boom"); },
		fetchImpl: okModelFetch,
	}).catch((error) => error.message);
	assert.equal(failed, "pose-runtime-unavailable");
	pass("a missing JS runtime is named");
}

{
	const failed = await createPoseDetector({
		loadRuntime: async () => ({}),
		fetchImpl: async () => ({ ok: false, status: 404 }),
	}).catch((error) => error.message);
	assert.equal(failed, "pose-model-download-failed");
	pass("an unreachable model download is named");
}

{
	const failed = await createPoseDetector({
		loadRuntime: async () => ({
			FilesetResolver: { forVisionTasks: async () => { throw new Error("offline"); } },
		}),
		fetchImpl: okModelFetch,
	}).catch((error) => error.message);
	assert.equal(failed, "pose-engine-download-failed");
	pass("an unreachable wasm engine is named");
}

{
	const delegates = [];
	const failed = await createPoseDetector({
		loadRuntime: async () => ({
			FilesetResolver: { forVisionTasks: async () => ({}) },
			PoseLandmarker: {
				createFromOptions: async (_fileset, options) => {
					delegates.push(options.baseOptions.delegate);
					throw new Error("no delegate");
				},
			},
		}),
		fetchImpl: okModelFetch,
	}).catch((error) => error.message);
	assert.equal(failed, "pose-engine-init-failed");
	assert.deepEqual(delegates, ["GPU", "CPU"]); // GPU first, CPU is the retry, then a named refusal
	pass("engine init tries GPU then CPU before failing by name");
}

{
	const calls = [];
	const detector = await createPoseDetector({
		loadRuntime: async () => ({
			FilesetResolver: { forVisionTasks: async () => ({}) },
			PoseLandmarker: {
				createFromOptions: async () => ({
					detectForVideo: (image, timestampMs) => { calls.push([image, timestampMs]); return { worldLandmarks: [] }; },
					close: () => calls.push("closed"),
				}),
			},
		}),
		fetchImpl: okModelFetch,
	});
	detector.detect("frame", 33.4);
	assert.deepEqual(calls[0], ["frame", 33]); // detectForVideo wants integer ms
	detector.close();
	assert.equal(calls[1], "closed");
	pass("a working detector rounds timestamps and closes cleanly");
}

console.log("verify-pose-detector: all checks passed");
