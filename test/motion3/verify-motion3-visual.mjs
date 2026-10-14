#!/usr/bin/env node
// C11 (docs/motion-api-v3.1.md): verify_result contact_sheet frames "beats" and visual "trace".
// The frame choice runs on synthetic timeline and QA inputs (lanes B and C fill the real ones);
// the trace and the binding path run on a real compile of the cup scene.
import { beatFrames, grabReleases, traceSeries } from "../../src/motion3/beats.js";
import { studioVisual, traceRgba } from "../../src/studio-motion-visual.js";
import { sampleContactSheetFrames, CONTACT_SHEET_LAYOUT } from "../../src/studio-contact-sheet.js";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { SCENE_OBJECTS, CHARACTER } from "./fixtures/cup-scene.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const json = JSON.stringify;
const spaced = frames => frames.every((f, i) => i === 0 || f - frames[i - 1] > 3);

// ---- beats on synthetic inputs ------------------------------------------------------------
const timeline = [
	{ beat: "standIdle", src: "use[0]", f: [0, 11], events: [] },
	{ beat: "walkTo", src: "use[1]", f: [12, 86], events: [] },
	{ beat: "reachGrip", src: "use[2]", f: [87, 140], events: [{ f: 104, object: "empty-2", event: "grab" }, { f: 106, object: "empty-2", event: "show" }] },
	{ beat: "keys", src: "keys", f: [141, 279], events: [{ f: 160, object: "empty-2", event: "release" }] },
];
const groups = [
	{ kind: "GOAL", subject: "cup at mouth: 0.31 m at f150 (needs <= 0.06)", worstFrame: 150 },
	{ kind: "COLLIDE", subject: "thigh_r x cube", worstFrame: 62 },
	{ kind: "SLIDE", subject: "foot_l", worstFrame: 200 },
];
const even = sampleContactSheetFrames("whole_clip", 280);
const beats = beatFrames({ range: [0, 279], even, timeline, groups });
expect("beats: at most 6 frames, ascending, inside the range", beats.frames.length === 6 && json(beats.frames) === json([...beats.frames].sort((a, b) => a - b)) && beats.frames.every(f => f >= 0 && f <= 279), json(beats.frames));
expect("beats: one pick per frame with its reason", json(beats.picks.map(p => p.f)) === json(beats.frames) && beats.picks.every(p => typeof p.why === "string" && p.why));
const why = Object.fromEntries(beats.picks.map(p => [p.f, p.why]));
expect("beats: grab and release frames come first", why[104] === "grab empty-2" && why[160] === "release empty-2", json(beats.picks));
expect("beats: then beat starts (frame 0, 12, 87, 141)", why[0] === "start standIdle" && why[12] === "start walkTo" && why[87] === "start reachGrip" && why[141] === "start keys", json(beats.picks));
expect("beats: no two picks within +-3 frames", spaced(beats.frames), json(beats.frames));
expect("beats: the same inputs pick the same frames", json(beatFrames({ range: [0, 279], even, timeline, groups })) === json(beats));

const worst = beatFrames({ range: [0, 279], even, timeline: [], groups });
expect("beats: the top 2 groups' worstFrame, then even fill", worst.picks.some(p => p.f === 150 && p.why === "worst GOAL cup at mouth") && worst.picks.some(p => p.f === 62 && p.why === "worst COLLIDE thigh_r x cube")
	&& !worst.frames.includes(200) && worst.picks.filter(p => p.why === "even").length === 4, json(worst.picks));
expect("beats: even fill keeps clear of the picks", worst.frames.length === 6 && spaced(worst.frames), json(worst.frames));

const dup = beatFrames({ range: [0, 279], even, timeline: [{ beat: "keys", f: [102, 120], events: [{ f: 104, object: "cup", event: "grab" }] }], groups: [{ kind: "GOAL", subject: "x", worstFrame: 106 }] });
expect("beats: a beat start or worst frame within 3 of the grab is dropped", dup.picks.filter(p => p.f >= 100 && p.f <= 108).length === 1 && why[104] === "grab empty-2", json(dup.picks));

const crowded = beatFrames({ range: [0, 279], even, timeline: Array.from({ length: 10 }, (_, i) => ({ beat: `b${i}`, f: [i * 25, i * 25 + 20], events: [] })), groups });
expect("beats: never more than 6 even with 10 beat starts", crowded.frames.length === 6 && crowded.picks.every(p => p.why.startsWith("start ")), json(crowded.picks));

const outside = beatFrames({ range: [24, 71], even: sampleContactSheetFrames({ startFrame: 24, endFrameExclusive: 72 }, 280), timeline, groups });
expect("beats: frames outside the requested range are never picked", outside.frames.every(f => f >= 24 && f <= 71) && outside.picks.some(p => p.f === 62), json(outside.picks));

const empty = beatFrames({ range: [0, 279], even });
expect("beats: with no timeline, events or QA it answers the even frames", json(empty.frames) === json(even) && empty.picks.every(p => p.why === "even"), json(empty.frames));
expect("beats: undefined inputs (a take that did not compile) degrade to even", json(beatFrames({ range: [0, 279], even, timeline: undefined, groups: undefined, objects: undefined }).frames) === json(even));
expect("grabReleases: timeline events, then spec.objects grab/release", json(grabReleases(timeline, { cylinder: { prop: "grip", grab: 20, release: 40 }, door: { pivot: [0, 0, 0] } }).map(r => r.why))
	=== json(["grab cylinder", "release cylinder", "grab empty-2", "release empty-2"]));

// ---- trace on a real compile --------------------------------------------------------------
const sk = skeletonFor(CHARACTER.model), scene = motionScene(SCENE_OBJECTS);
const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 48, use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }],
	props: { grip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"] } },
	keys: [{ f: 10, set: { armw_r: 1, hand_r: [-0.25, 0.95, 0.25] } }, { f: 30, set: { armw_r: 1, hand_r: [-0.2, 1.4, 0.3] } }],
	objects: { cylinder: { prop: "grip", grab: 20, release: 40 } },
	goals: [{ name: "cup up", near: ["object:cylinder.top", "landmark:mouth"], tol: 0.06, at: [30, 40] }] };
const r = compileSpec(spec, { sk, scene }, { lenient: true });
const trace = traceSeries(r.out, r.expanded, [0, 99]);
const named = Object.fromEntries(trace.series.map(s => [s.name, s]));
expect("trace: the range is clamped to the compiled frames", json(trace.range) === "[0,47]", json(trace.range));
expect("trace: hand heights, the near goal and the carried object's grip", json(Object.keys(named)) === json(["hand_l.y", "hand_r.y", "near cup up", "grip to cylinder"]), json(Object.keys(named)));
const hand = named["hand_r.y"];
expect("trace: min/max with the frames they happen at", hand && hand.max === Math.max(...hand.values) && hand.values[hand.maxAt] === hand.max && hand.values[hand.minAt] === hand.min && hand.maxAt === 30 && Math.abs(hand.max - 1.4) < 0.02, json({ ...hand, values: undefined }));
expect("trace: one value per frame, colours and units", trace.series.every(s => s.values.length === 48 && /^#[0-9a-f]{6}$/.test(s.color) && s.unit === "m") && named["hand_l.y"].color === "#d1495b");

const plot = traceRgba(trace.series, trace.range, { width: 200, height: 100, marks: [20] });
const px = (x, y) => Array.from(plot.data.subarray((y * plot.width + x) * 4, (y * plot.width + x) * 4 + 4));
const colourRows = hex => { const [cr, cg, cb] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), rows = []; for (let y = 0; y < plot.height; y++) for (let x = 0; x < plot.width; x++) { const [pr, pg, pb] = px(x, y); if (pr === cr && pg === cg && pb === cb) rows.push({ x, y }); } return rows; };
expect("trace raster: RGBA of the asked size, opaque", plot.width === 200 && plot.height === 100 && plot.data.length === 200 * 100 * 4 && px(0, 0)[3] === 255 && px(199, 99)[3] === 255);
const right = colourRows(hand.color), atX = x => right.filter(p => p.x === x).map(p => p.y);
const x0 = 12, x30 = Math.round(12 + (30 / 47) * 176);
expect("trace raster: the right hand's line is drawn in its colour", right.length > 100, String(right.length));
expect("trace raster: rows run bottom-up, so the raised hand sits at a higher row", Math.min(...atX(x30)) > Math.max(...atX(x0)), json({ start: atX(x0), raised: atX(x30) }));
const bare = traceRgba([], trace.range, { width: 200, height: 100, marks: [20] }), markX = Math.round(12 + (20 / 47) * 176);
const light = Array.from({ length: 76 }, (_, i) => Array.from(bare.data.subarray(((12 + i) * 200 + markX) * 4, ((12 + i) * 200 + markX) * 4 + 3))).filter(p => json(p) === "[150,154,164]").length;
expect("trace raster: a mark draws a light vertical inside the plot margins", light === 76, String(light));
expect("trace raster: no series still draws an empty plot", traceRgba([], [0, 0], { width: 10, height: 10 }).data.length === 400);

// ---- the binding path: studioVisual with ports and a state as the binding passes them -----
const take = { schema: "cozyclay.take.v3", rig: sk.model, spec };
const state = (motion = take) => ({ revision: 7, frameCount: 48, objects: SCENE_OBJECTS, characters: [CHARACTER], targets: new Map([[CHARACTER.id, { motion }]]) });
const rendered = [], encoded = [];
const ports = {
	renderFrameBuffer: frame => { rendered.push(frame); return { data: new Uint8Array(8 * 4 * 4).fill(frame), width: 8, height: 4 }; },
	encodePng: (data, size) => { encoded.push({ length: data.length, width: size.width, height: size.height }); return "data:image/png;base64,AAAA"; },
	capture: () => ({ dataUrl: "data:image/png;base64,BBBB", width: 4, height: 4 }),
};
const run = (args, s = state()) => {
	const images = new Map(), result = { receiptId: null, visualRefs: [] };
	rendered.length = 0; encoded.length = 0;
	studioVisual({ visual: "none", ...args }, { s, receipt: null, result, images, ports });
	return { images, ref: result.visualRefs[0] };
};
const evenRun = run({ visual: "contact_sheet", targets: [CHARACTER.id], range: "whole_clip" });
const evenFrames = sampleContactSheetFrames("whole_clip", 48);
expect("even (default): the same frames, layout and image record as before", json(evenRun.ref.frames) === json(evenFrames) && evenRun.ref.layout === CONTACT_SHEET_LAYOUT && !("picks" in evenRun.ref)
	&& json(Object.keys(evenRun.images.get(evenRun.ref.imageId))) === json(["dataUrl", "width", "height", "frames", "layout", "revision", "receiptId"]) && json(rendered) === json(evenFrames), json(evenRun.ref));
const beatRun = run({ visual: "contact_sheet", frames: "beats", targets: [CHARACTER.id], range: "whole_clip" });
expect("beats: the installed take's spec is compiled again; its grab and release are picked", beatRun.ref.picks.some(p => p.f === 20 && p.why === "grab cylinder") && beatRun.ref.picks.some(p => p.f === 40 && p.why === "release cylinder")
	&& beatRun.ref.frames.length <= 6 && json(rendered) === json(beatRun.ref.frames), json(beatRun.ref));
const noTake = run({ visual: "contact_sheet", frames: "beats", targets: [CHARACTER.id], range: "whole_clip" }, state(null));
expect("beats without a take: the even frames", json(noTake.ref.frames) === json(evenFrames) && noTake.ref.picks.every(p => p.why === "even"), json(noTake.ref));
const traceRun = run({ visual: "trace", targets: [CHARACTER.id] });
expect("trace: visualRefs[0] = { imageId, kind, range, series } without the raw values", traceRun.ref.kind === "trace" && json(traceRun.ref.range) === "[0,47]" && traceRun.ref.series.length === 4
	&& traceRun.ref.series.every(s => !("values" in s) && "minAt" in s && "maxAt" in s), json(traceRun.ref));
expect("trace: one PNG through the encodePng port, kept for resolve_studio_image", encoded.length === 1 && encoded[0].length === encoded[0].width * encoded[0].height * 4 && traceRun.images.get(traceRun.ref.imageId)?.kind === "trace", json(encoded));
let refused = "";
try { run({ visual: "trace", targets: [CHARACTER.id] }, state(null)); } catch (error) { refused = `${error.code}: ${error.message}`; }
expect("trace without a take is TARGET_NOT_READY", refused.startsWith("TARGET_NOT_READY"), refused);
const frameRun = run({ visual: "frame", targets: [CHARACTER.id] });
expect("frame: the capture port, unchanged", frameRun.ref && Object.keys(frameRun.ref).length === 1 && frameRun.images.get(frameRun.ref.imageId)?.revision === 7);

if (failures) process.exit(1);
console.log("verify-motion3-visual: all checks PASS");
