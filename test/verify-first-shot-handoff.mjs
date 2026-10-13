#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createFirstShotHandoff, cameraTutorialSuppressed, rememberCameraTutorialTerminal } from "../src/first-shot-handoff.js";
import { shotIndexAtFrame } from "../src/cuts.js";
import { createAppContext } from "../src/app-context.js";

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const all = new Set(["fly", "walk", "dolly", "orbit", "shot", "rail", "play"]);
const authoredPlay = new Set(["shot", "rail", "play"]);

// Given a fresh attempt, navigation and seeding alone never qualify.
const fresh = createFirstShotHandoff(storage);
for (const steps of [[], ["fly", "walk", "dolly", "orbit"], ["play"], ["shot", "play"], ["shot", "rail"]]) {
	assert.equal(fresh.canShow(new Set(steps)), false);
}
assert.equal(fresh.canShow(authoredPlay), true, "the unchanged play milestone qualifies with authored shot and rail");
fresh.complete();
assert.equal(fresh.canShow(all), true, "persisting completion must not suppress the current attempt");
assert.equal(cameraTutorialSuppressed(storage), true);
assert.equal(createFirstShotHandoff(storage).canShow(all), false, "a returning completed user is not prompted");
console.log("PASS fresh milestone and prior completion policy");

// Given an eligible attempt, dismissal survives repeated signals and restarts.
values.clear();
const dismissed = createFirstShotHandoff(storage);
dismissed.dismiss();
assert.equal(dismissed.canShow(authoredPlay), false);
assert.equal(dismissed.canShow(all), false);
assert.equal(createFirstShotHandoff(storage).canShow(all), false);
console.log("PASS dismissal is terminal and survives reload");

// Given an export through any ordinary entry point, later tutorials stay quiet.
values.clear();
const exporting = createFirstShotHandoff(storage);
exporting.exportStarted();
assert.equal(exporting.canShow(all), false);
assert.equal(createFirstShotHandoff(storage).canShow(all), false);
values.clear();
rememberCameraTutorialTerminal("export_started", storage);
assert.equal(createFirstShotHandoff(storage).canShow(all), false);
console.log("PASS ordinary export starts suppress the handoff");

// Given optional storage is unavailable, current-attempt dismissal still works.
const unavailable = { getItem() { throw new Error("unavailable"); }, setItem() { throw new Error("unavailable"); } };
const memoryOnly = createFirstShotHandoff(unavailable);
assert.equal(memoryOnly.canShow(all), true);
memoryOnly.dismiss();
assert.equal(memoryOnly.canShow(all), false);
console.log("PASS unavailable storage cannot break current-attempt dismissal");

// Given malformed or non-boolean preferences, do not invent a terminal action.
values.clear();
values.set("cozyclay.camera-tutorial-terminal.v1", "{");
assert.equal(cameraTutorialSuppressed(storage), false);
values.set("cozyclay.camera-tutorial-terminal.v1", JSON.stringify({ completed: "true" }));
assert.equal(cameraTutorialSuppressed(storage), false);
console.log("PASS malformed preferences do not invent completion");

// Execute the production entry, with the encoder request as the observation
// seam. The real browser suite separately renders and downloads these frames.
import { readStudioSource, readStudioFunction } from "./bus/verify-domain-modules.mjs";
const app = readStudioSource();
const videoEntry = readStudioFunction("exportShotVideo");
for (const kind of ["keyed", "keyless", "deleted"]) {
	const target = { id: "target", startFrame: 80, endFrame: 119, cameraKeys: kind === "keyed" ? [{}] : [] };
	const shots = [{ id: "other", startFrame: 0, endFrame: 39, cameraKeys: [{}] }, target];
	const calls = [];
	const runtime = {
		recRef: { current: null }, shots, tlFrame: 5, motion: { frames: 432 }, shotIndexAtFrame,
		captureCurrentFraming: () => { throw new Error("contextual export must not author a key"); },
		recordShotUndo: () => { throw new Error("contextual export must not touch history"); },
		setShots: () => { throw new Error("contextual export must not change the shots"); },
		currentRecordFrameCount: () => 432,
		exportRequest: (exportKind, run, options) => ({ exportKind, run, options }),
		executeExportRequest: (request) => request.run({}),
		runShotExport: (range) => calls.push(JSON.parse(JSON.stringify(range))),
	};
	runtime.appContext = createAppContext().forRender(runtime);
	await runInNewContext(`(${videoEntry})({ shotId: ${JSON.stringify(kind === "deleted" ? "missing" : "target")} })`, runtime);
	assert.deepEqual(calls, kind === "deleted" ? [] : [{ startFrame: 80, endFrame: 119, download: true }]);
}
console.log("PASS contextual video preserves the named shot range with motion and refuses a deleted target");

// Given a starter fetch is held, an edit or document switch before its result
// must prevent applyProject. Resolve the exact fetch promise; no timing waits.
const starterEntry = readStudioFunction('openStarterScene');
for (const change of ["none", "edit", "project"]) {
	let release;
	let snapshot = "before";
	const project = { name: "sample" };
	const applied = [];
	const runtime = {
		collectProjectSnapshot: () => snapshot, tutorialProjectEpochRef: { current: 0 },
		playgroundSceneUrl: () => "/sample", fetchSceneProject: () => new Promise((resolve) => { release = resolve; }),
		setToast() {}, ko: (en) => en, applyProject: (value) => applied.push(value),
		projectHandleRef: { current: null }, track() {},
	};
	runtime.appContext = createAppContext({ notify: (...args) => runtime.setToast(...args) }).forRender(runtime);
	const opening = runInNewContext(`(${starterEntry})("city-block", "tutorial")`, runtime);
	if (change === "edit") snapshot = "authored";
	if (change === "project") runtime.tutorialProjectEpochRef.current += 1;
	release(project);
	assert.equal(await opening, change === "none");
	assert.equal(applied.length, change === "none" ? 1 : 0);
}
console.log("PASS pending sample fetch cannot overwrite edits or a switched project");

// Compose the real start, authoring notification, pre-rig seed effect and
// loader. The arm-time epoch must survive both asynchronous gaps.
const startEntry = app.slice(app.indexOf("async function startCameraTutorial("), app.indexOf("startCameraTutorialRef.current ="));
const markEntry = app.slice(app.indexOf("const markSemanticEdit ="), app.indexOf("const craftActionTrackedRef"));
const seedEnd = "}, [tutorialSeedPending, activeRig]);";
const seedEntry = app.slice(app.indexOf("\tuseEffect(() => {", app.indexOf("// The camera tutorial's seed (#209)")), app.indexOf(seedEnd) + seedEnd.length);
const { motionFixture } = await import('./bus/motion-fixture.mjs');
const { tutorialWalkSpec } = await import('../src/tutorial-walk.js');
for (const timing of ["before-rig", "unchanged"]) {
	let effect;
	const compiles = [];
	const f = motionFixture();
	const character = f.scope.activeChar, rig = f.scope.activeRig;
	const context = f.scope;
	Object.assign(context, {
		window: {}, embedMode: false, playgroundMode: false, startupCreatedScene: true,
		projectName: null, projectDirty: false, cameraTutorialSuppressed: () => false,
		tutorialLoadingRef: { current: false }, tutorialStarterRef: { current: false },
		tutorialInitialSnapshotRef: { current: "initial" }, collectProjectSnapshot: () => "initial",
		tutorialProjectEpochRef: { current: 2 }, tutorialSeedEpochRef: { current: null },
		firstEditRef: { current: () => true }, tutorialSeedPending: false,
		activeRig: null, frame: 0, frameCount: 72, motion: null, isKo: false,
		tutorialWalkSpec,
		runStudioAction(id, args) { compiles.push(id); const receipt = f.run(id, args); return receipt.ok ? receipt : null; },
		openStarterScene: async () => true, exitPreview() {}, setProjectStartupOpen() {}, setFirstSuccessGuideOpen() {},
		setCameraTutorialHandoff() {}, createFirstShotHandoff: () => ({}),
		cameraTutorialAnalytics: { current: null }, createTutorialAnalytics: () => ({}),
		setCameraTutorialAttempt() {}, setCameraTutorial() {}, cameraTutorialCompletedRef: { current: false },
		setTutorialSeedPending(value) { context.tutorialSeedPending = value; },
		useEffect(callback) { effect = callback; },
		setTlFrame(value) { context.frame = value; }, setTlPlaying() {}, setToast() {}, ko: (en) => en,
	});
	try {
		await runInNewContext(`(${startEntry})()`, context);
		const edit = runInNewContext(`${markEntry}; markSemanticEdit`, context);
		runInNewContext(seedEntry, context);
		effect();
		assert.equal(compiles.length, 0, "no seed while the rig is absent");
		if (timing === "before-rig") edit("shots", [], [{ id: "user-shot" }]);
		context.frame = 90;
		context.activeRig = rig;
		runInNewContext(seedEntry, context);
		effect();
		if (timing === "unchanged") {
			assert.deepEqual(compiles, ["motion.compile"]);
			assert.equal(context.frame, 0);
			// Installed by the time the effect returns: nothing can land in between.
			assert.equal(f.motion.motionFor(character.id)?.schema, "cozyclay.take.v3");
			assert.equal(f.motion.motionFor(character.id).frames, 216);
		} else {
			assert.equal(compiles.length, 0, `${timing}: a stale seed compiles nothing`);
			assert.equal(context.frame, 90, `${timing}: stale seed must preserve the user's playhead`);
			assert.equal(f.motion.motionFor(character.id), null, `${timing}: stale seed must not replace the motion`);
		}
		assert.equal(context.tutorialSeedPending, false, `${timing}: the seed flag is consumed once`);
	} finally { f.dispose(); }
}
console.log("PASS seed authorization survives rig readiness; the compiled walk installs synchronously");
console.log("all first-shot handoff checks PASS");
