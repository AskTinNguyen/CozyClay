import assert from "node:assert/strict";
import { framingChecks, sampledFramingChecks } from "../src/studio-agent-commands.js";

const scene = {
  frame: 0,
  frameCount: 48,
  floorY: 0,
  objects: [{ id: "subject", name: "Subject", renderer: "cube", x: 0, y: 0, z: 0, rotX: 0, rot: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, footprint: { width: 1, depth: 1 }, height: 1, hidden: false }],
  characters: [],
  camera: { position: { x: 0, y: 1, z: 5 }, lookAt: { x: 0, y: 0.5, z: 0 }, focalMm: 35, sensorId: "fullFrame" },
  filmback: { sensorId: "fullFrame", aspectRatio: 16 / 9 },
};
const ports = {
  bounds() { throw new Error("static primitive does not use evaluated bounds"); },
  sampleStateAt(frame, state) {
    return frame < 24 ? state : { ...state, frame, objects: [{ ...state.objects[0], x: 100 }] };
  },
};

const current = framingChecks(["subject"], scene, ports);
assert.equal(current.clipped, false, "the first frame fits");
const result = sampledFramingChecks(["subject"], scene, ports, [0, 24, 47]);
assert.equal(result.coverage, "sampled-timeline-subject-bounds-projection");
assert.deepEqual(result.sampledFrames, [0, 24, 47]);
assert.equal(result.sampledChecks.length, 3);
assert.equal(typeof result.sampledChecks[0].screenFraction, "number");
assert.deepEqual(result.issueFrames.map(({ frame }) => frame), [24, 47]);
assert.equal(result.evaluatedFrames, 3);
console.log("verify-studio-agent-sampled-framing: ok");
