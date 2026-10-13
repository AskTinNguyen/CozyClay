import { useState, useEffect, useSyncExternalStore, useRef, useMemo } from "react";
import { createDocumentStore } from '../document-store.js';
import { useDocumentDomain } from '../store/use-document-store.js';
import {
	TIMELINE_FPS,
	hierarchyIdForIkFocus,
	REST_BONES,
	ARDY_FPS,
} from "../app-stage.jsx";
import { copyPhysicsKeys } from "../ardy/physics-review.js";
import {
	createIkState,
	ikTouch,
	ikKeyframes,
	ikRemoveKeyframe,
	ikSeedTargets,
	clampIkTargetToFloor,
	solveIk,
	MID_TRACKS,
	solveMidJoint,
	solveEffectorSwing,
	ikPlantFeet,
	solveHipsTranslateToFloor,
	solveHipsTranslate,
	solveSwingAngle,
	ikSolvePlantedFeet,
	applyBodyContact,
	ikBakeKeyframe,
	ikEvaluate,
	resolveIkRig,
} from "../ardy/ik.js";
import * as THREE from "three";
import { StudioProtocolError } from "../studio-agent-protocol.js";
import { restorePlaybackBones, snapshotPlaybackBones, applyMotionFrame } from "../ardy/playback.js";
import { isKo, ko } from "../locale.js";
import { characterScaleFor, loadMotionFromUrl } from "../ardy/npz.js";
import { supportHeightForObject } from "../scene-objects.js";
import { applySupportRise, autoRoofDrop, applyAutoFall, applyRootDrop, normalizeRootDrop } from "../ardy/root-drop.js";
import { isProxyFigure } from "../scenes.js";
import { refuseRigOnly } from "../character-kind.js";
import { retimeMotion } from "../ardy/retime.js";
import {
	createMotionEdit,
	motionEditLayout,
	renderMotionEdit,
	remapFrameKeyMap,
	remapTimelineFrame,
} from "../ardy/motion-edit.js";
import { DEFAULT_POSE, restoreBindPositions, applyPose, applyHipsOffset } from "../poses.js";
import { normalizeMotionCalibration, applyMotionCalibration } from "../ardy/motion-calibration.js";
import {
	pushTakeVersion,
	TAKE_VERSIONS_MAX,
} from "../take-recipe.js";
import { TRAIL_TRACKS, applyTrailFalloffDelta, restoreTrailEdits, trailEditRange, worldDeltaToTrailClip } from "../motion-trail.js";
import { bakeIkDragKey, bakeIkDragRange, chainsChangedBy, ikDragRecord, ikDragTouch } from "../ardy/ik-drag.js";
import { ikKeyJson, ikTrackKeyFromJson } from "../ardy/ik-key-json.js";
import { findAbsoluteIkKeyConflicts } from "../trail-key-conflicts.js";
import { chooseIkEntryPose } from "../ik-camera.js";
import { openMotionDb, getMotion, putMotion } from "../motion-store.js";
import { resolveMotionSource, decodeMotionResource, encodeMotionResource, sha256Hex } from "../motion-resources.js";
import { applyRangePin, captureRangePinTarget, normalizeRangePin, rangePinTargetWorld, rangePinTracks, removeRangePinKeys } from "../ardy/range-pin.js";
import { rangePinObjectMatrixAt } from "../range-pin-object-transform.js";
import { ensureRangePinState, overlappingRangePin, rangePinConflictFrames, rangePinOverlapMessage } from "./motion/motion-range-pin-rules.js";

import { sameMotionIntent, emptyMotionLayer, encodeMotionKeys, decodeMotionKeys, cloneRangePin, encodeRangePins, decodeRangePins, encodeRangePinResiduals, decodeRangePinResiduals } from "./motion/motion-intent-codec.js";
// Plain intent owns take identities and JSON keys. Decoded buffers and rig
// preimages are copy-on-record runtime resources, never mutable store values.
export function createMotionDomain(appContext, characters) {
	const takes = new Map(), decoded = new WeakMap(), rigImages = new WeakMap(), previews = new Map(), prepared = new Map();
	let running = 0;
	const references = entries => entries.map(entry => {
		const ref = entry.motionRef;
		const take = ref ? { resourceId: `restore:${entry.id}:${ref.motionId ?? ref.url}`, url: ref.url ?? null, anchorX: ref.anchorX, anchorZ: ref.anchorZ,
			rotationDeg: ref.rotationDeg, prompt: ref.prompt ?? '', ...(ref.trailEdits ? { trailEdits: ref.trailEdits } : {}), ...(ref.studioTakeId ? { studioTakeId: ref.studioTakeId } : {}) } : null;
		// The saved Pose-mode / IK edits come back with the scene (scenes.js ikEdits).
		const edits = entry.ikEdits;
		return { id: entry.id, take, fullTake: take, takeVersions: ref?.url ? [{ motionUrl: ref.url, recipe: null, savedAt: Date.now(), label: ko('Loaded', '불러옴') }] : [],
			ikKeys: edits?.keys ?? [], ikPins: edits?.pins ?? [], ikPinResiduals: edits?.pinResiduals ?? [] };
	});
	function snapshotTake(take) {
		if (!take) return null;
		if (take.resourceId) return { ...take };
		const resourceId = crypto.randomUUID(), copy = structuredClone(take);
		takes.set(resourceId, copy);
		return { resourceId, frames: take.frames, fps: take.fps, url: take.url ?? null, prompt: take.prompt ?? '',
			anchorX: take.anchorX ?? 0, anchorZ: take.anchorZ ?? 0, anchorFrame: take.anchorFrame ?? 0, rotationDeg: take.rotationDeg ?? 0,
			...(take.trailEdits ? { trailEdits: take.trailEdits } : {}),
			editSegments: take.editSegments ?? createMotionEdit(take.frames), studioTakeId: take.studioTakeId ?? resourceId };
	}
	const normalize = rows => rows.map(row => ({ ...emptyMotionLayer(row.id), ...row,
		take: snapshotTake(row.take), fullTake: snapshotTake(row.fullTake ?? row.take),
		ikKeys: row.ikKeys ?? [], ikPins: row.ikPins ?? [], ikPinResiduals: row.ikPinResiduals ?? [], committedIkEdits: row.committedIkEdits ?? [] }));
	let native = createDocumentStore({ owned: { motion: normalize(references(characters)) } });
	const listeners = new Set(), notify = () => { for (const listener of listeners) listener(); };
	let release = native.subscribe(notify), viewRevision = 0;
	const documentStore = { ...Object.fromEntries(Object.keys(native).map(key => [key, (...args) => native[key](...args)])),
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
	const read = () => documentStore.read('motion');
	const layer = id => read().find(row => row.id === id) ?? emptyMotionLayer(id);
	function materialize(take) {
		if (!take || !takes.has(take.resourceId)) return null;
		if (!decoded.has(take)) {
			const { resourceId, ...metadata } = take;
			decoded.set(take, { ...takes.get(resourceId), ...metadata });
		}
		return decoded.get(take);
	}
	const motionFor = id => materialize(layer(id).take), fullMotionFor = id => materialize(layer(id).fullTake);
	const visibleMotion = id => previews.get(id) ?? motionFor(id);
	const frame = () => appContext.live.state?.timeline.currentFrame ?? 0;
	const rigFor = id => appContext.shared.rigs[id];
	// Rig-only tools refuse a capsule figure by name before looking for its rig.
	const rigOnly = (id, feature) => refuseRigOnly(appContext.storeDomain('cast')?.read().find(row => row.id === id), feature);
	function rigSnapshots() {
		return new Map(Object.entries(appContext.shared.rigs).map(([id, rig]) => [id, appContext.shared.snapshotExportRig(rig)]));
	}
	let publishedIds = new Set();
	function project() {
		const cast = appContext.storeDomain('cast'), states = appContext.shared.ikStatesRef.current, savedRigs = rigImages.get(read());
		const ids = new Set([...publishedIds, ...read().map(row => row.id)]);
		for (const id of ids) {
			const row = layer(id), take = visibleMotion(id), full = fullMotionFor(id);
			cast.publishMotion(id, take);
			if (full) appContext.shared.motionFullRef.current.set(id, full); else appContext.shared.motionFullRef.current.delete(id);
			const state = states.get(id) ?? createIkState();
			state.keys = decodeMotionKeys(row.ikKeys); state.tracked = new Set([...state.keys.values()].flatMap(entry => [...entry.keys()]));
			state.pins = decodeRangePins(row.ikPins);
			state.pinResiduals = decodeRangePinResiduals(row.ikPinResiduals);
			states.set(id, state);
			const rig = rigFor(id);
			if (rig) {
				const resolved = resolveIkRig(rig); if (resolved) Object.assign(state, resolved, { rig });
				if (savedRigs?.has(id) && !previews.has(id)) appContext.shared.restoreExportRig(savedRigs.get(id));
				else if (resolved) {
					if (take) applyMotionFrame(rig, take, Math.min(frame(), take.frames - 1));
					else {
						const character = cast.read().find(entry => entry.id === id);
						restoreBindPositions(rig); applyPose(rig, { ...REST_BONES, ...(character?.pose ?? DEFAULT_POSE).bones });
						applyHipsOffset(rig, character?.pose?.rootY ?? 0);
					}
					ikEvaluate(resolved.chains, state, frame(), resolved.fkJoints, take ? 6 : 0);
				}
			}
		}
		publishedIds = new Set(read().map(row => row.id));
		const id = appContext.shared.loadedLayerCharRef.current;
		appContext.shared.ikStateRef.current = states.get(id) ?? createIkState();
		appContext.shared.bufferRef.current = { ...appContext.shared.bufferRef.current, motion: visibleMotion(id), ik: appContext.shared.ikStateRef.current };
		domain.onProject?.(); viewRevision++;
	}
	const unsubscribe = documentStore.subscribe(project);
	function write(update) {
		return documentStore.write('motion', before => {
			const next = normalize(typeof update === 'function' ? update(before) : update);
			return sameMotionIntent(before, next) ? before : next;
		});
	}
	function writeLayer(id, patch) {
		return write(rows => rows.some(row => row.id === id) ? rows.map(row => row.id === id ? { ...row, ...patch } : row) : [...rows, { ...emptyMotionLayer(id), ...patch }]);
	}
	function pruneTakes() {
		const history = documentStore.history(), ids = new Set([read(), ...[...history.past, history.present, ...history.future].map(entry => entry.snapshot.motion)]
			.flatMap(rows => rows.flatMap(row => [row.take?.resourceId, row.fullTake?.resourceId])).filter(Boolean));
		for (const id of takes.keys()) if (!ids.has(id)) takes.delete(id);
	}
	function beginAction(preimages = null) {
		// The bus passes a target id; an explicit preview commit can override
		// only its rig's preimage without retaining the preview in Undo.
		rigImages.set(read(), new Map([...(gesture?.rigs ?? rigSnapshots()), ...(preimages instanceof Map ? preimages : [])]));
		const session = documentStore.beginAction('motion');
		return { ...session,
			run(fn) { return session.run(() => { running++; try { return fn(); } finally { running--; } }); },
			commit() { const result = session.commit(); rigImages.set(read(), rigSnapshots()); pruneTakes(); return result; },
		};
	}
	function setKeys(id, keys) { return writeLayer(id, { ikKeys: encodeMotionKeys(keys) }); }
	function setRangePinState(id, state) {
		return writeLayer(id, { ikKeys: encodeMotionKeys(state.keys), ikPins: encodeRangePins(state.pins), ikPinResiduals: encodeRangePinResiduals(state.pinResiduals) });
	}
	function rangePinState(id) {
		const row = layer(id), keys = decodeMotionKeys(row.ikKeys);
		return { ...createIkState(), keys, tracked: new Set([...keys.values()].flatMap(entry => [...entry.keys()])), pins: decodeRangePins(row.ikPins), pinResiduals: decodeRangePinResiduals(row.ikPinResiduals) };
	}
	function removePin(id, pinId) {
		const state = rangePinState(id);
		removeRangePinKeys(state, pinId); state.pins.delete(pinId); state.pinResiduals.delete(pinId);
		setRangePinState(id, state);
	}
	function bakeRangePin(id, spec, replaceExisting = false, projectionOnly = false) {
		rigOnly(id, 'ik');
		const motion = motionFor(id), rig = rigFor(id), resolved = rig && resolveIkRig(rig);
		if (!motion || !resolved) throw new StudioProtocolError('TARGET_NOT_READY', 'Load a take and rig for this character first.');
		const pin = normalizeRangePin(spec, { clipFrames: motion.frames }), state = rangePinState(id);
		const tracks = rangePinTracks(pin);
		const overlap = [...state.pins.values()].find(other => other.id !== pin.id && rangePinTracks(other).some(track => tracks.includes(track)) && Math.max(pin.startFrame, other.startFrame) <= Math.min(pin.endFrame, other.endFrame));
		if (overlap) throw new StudioProtocolError('INVALID_ARGUMENT', 'A required track already has an overlapping pin.');
		for (let at = pin.startFrame; at <= pin.endFrame; at++) {
			const entry = state.keys.get(at); if (!entry) continue;
			for (const track of tracks) if (entry.has(track) && entry.get(track).pin !== pin.id) {
				if (!replaceExisting) throw new StudioProtocolError('INVALID_ARGUMENT', 'Confirm Replace existing keys before applying this pin.');
				entry.delete(track);
			}
			if (!entry.size) state.keys.delete(at);
		}
		const objectWorldMatrix = (objectId, at) => {
			const object = appContext.shared.sceneObjects.find(entry => entry.id === objectId);
			if (!object) return null;
			const local = rangePinObjectMatrixAt(object, at, { frameCount: motion.frames, fps: motion.fps }, new THREE.Matrix4());
			const parent = object.attach && appContext.shared.attachFrameRef?.current?.(object.attach.characterId, object.attach.bone ?? null, new THREE.Matrix4());
			return parent ? parent.multiply(local) : local;
		};
		const applyRaw = at => appContext.shared.poseMemberAtFrame(rig, motion, null, at);
		const savedKeys = state.keys;
		let result;
		try {
			result = applyRangePin({ ...resolved, ikState: state, pin, objectWorldMatrix, applyRaw,
				applyLayer(at) { applyRaw(at); ikEvaluate(resolved.chains, state, at, resolved.fkJoints, 6); } });
		} finally { state.keys = savedKeys; }
		removeRangePinKeys(state, pin.id);
		for (const [at, entry] of result.entries) {
			let frameEntry = state.keys.get(at); if (!frameEntry) state.keys.set(at, (frameEntry = new Map()));
			for (const [track, key] of entry) { frameEntry.set(track, key); state.tracked.add(track); }
		}
		state.pins.set(pin.id, cloneRangePin(pin));
		state.pinResiduals.set(pin.id, result.residuals.map(entry => ({ ...entry })));
		// A reload refreshes only the projected bake; authored edits use the bus.
		if (projectionOnly) Object.assign(appContext.shared.ikStatesRef.current.get(id), state);
		else setRangePinState(id, state);
		return { residuals: result.residuals };
	}
	function editKeys(id, mutate) {
		const state = { ...createIkState(), keys: decodeMotionKeys(layer(id).ikKeys) };
		state.tracked = new Set([...state.keys.values()].flatMap(entry => [...entry.keys()]));
		const result = mutate(state); setKeys(id, state.keys); return result;
	}
	function setKey(id, at, tracks) {
		editKeys(id, state => {
			const incoming = decodeMotionKeys([{ frame: at, tracks }]).get(at), entry = state.keys.get(at) ?? new Map();
			for (const [track, key] of incoming) entry.set(track, key); state.keys.set(at, entry);
		});
	}
	function castWrite(update) { return appContext.recordAction('cast', () => appContext.storeDomain('cast').write(update), null, true); }
	function synchronizeTimeline() { appContext.storeDomain('cast').syncTimeline(); }
	function replace(id, take, { fullTake = take, ikKeys = [], ikPins = [], ikPinResiduals = [],
		recipe = take ? { seed: null, blocks: [{ prompt: take.prompt ?? '', duration: take.frames / take.fps }], lineEdits: [] } : null,
		versions = take?.url ? pushTakeVersion(layer(id).takeVersions, { motionUrl: take.url, recipe, savedAt: Date.now(), label: ko('Loaded', '불러옴') }, TAKE_VERSIONS_MAX) : layer(id).takeVersions,
	} = {}) {
		previews.delete(id);
		writeLayer(id, { take: snapshotTake(take), fullTake: snapshotTake(fullTake), ikKeys, ikPins, ikPinResiduals, takeRecipe: recipe, takeVersions: versions, committedIkEdits: [] });
		synchronizeTimeline();
	}
	function clear(id) {
		previews.delete(id);
		writeLayer(id, { take: null, fullTake: null, ikKeys: [], ikPins: [], ikPinResiduals: [], committedIkEdits: [], takeRecipe: null });
		castWrite(rows => rows.map(row => row.id === id ? { ...row, scale: 1, motionRef: null,
			layer: { ...row.layer, promptClips: [] } } : row));
		synchronizeTimeline();
	}
	function editSegments(id, segments) {
		const full = fullMotionFor(id), take = motionFor(id);
		if (!full || !take) throw new StudioProtocolError('TARGET_NOT_READY', 'This character has no take to edit.');
		const previous = take.editSegments, rendered = { ...renderMotionEdit(full, segments), url: null };
		const keys = remapFrameKeyMap(decodeMotionKeys(layer(id).ikKeys), previous, segments);
		writeLayer(id, { take: snapshotTake(rendered), ikKeys: encodeMotionKeys(keys) });
		castWrite(rows => rows.map(row => row.id !== id ? row : { ...row, layer: { ...row.layer,
			promptClips: row.layer.promptClips.flatMap(clip => {
				const start = remapTimelineFrame(previous, segments, clip.startFrame), end = remapTimelineFrame(previous, segments, clip.endFrame);
				if (start === null && end === null) return [];
				const startFrame = Math.max(0, Math.min(start ?? 0, rendered.frames - 1));
				const endFrame = Math.max(0, Math.min(end ?? rendered.frames - 1, rendered.frames - 1));
				return startFrame <= endFrame ? [{ ...clip, startFrame, endFrame }] : [];
			}) } }));
		synchronizeTimeline();
	}
	function bakeCurrentKey(id, at, dragIds = null) {
		const rig = rigFor(id), resolved = rig && resolveIkRig(rig);
		if (!resolved) return null;
		const take = motionFor(id);
		if (dragIds) {
			const keyed = bakeIkDragKey(resolved.chains, resolved.fkJoints, at, dragIds, take
				? (rawRig) => applyMotionFrame(rawRig, take, at)
				: null);
			if (keyed && take) for (const key of keyed.values()) key.blend = 6;
			return keyed ? run('ik.setKey', { characterId: id, frame: at, tracks: ikKeyJson(keyed) }) : null;
		}
		const scratch = { ...createIkState(), tracked: new Set(appContext.shared.ikStatesRef.current.get(id)?.tracked) };
		ikBakeKeyframe(resolved.chains, scratch, at, resolved.fkJoints);
		const keyed = encodeMotionKeys(scratch.keys)[0];
		return keyed ? run('ik.setKey', { characterId: id, frame: at, tracks: keyed.tracks }) : null;
	}
	function keyPose(id, at, pose) {
		rigOnly(id, 'pose');
		const rig = rigFor(id), resolved = rig && resolveIkRig(rig);
		if (!resolved) throw new StudioProtocolError('TARGET_NOT_READY', 'The character rig is not loaded.');
		restoreBindPositions(rig); applyPose(rig, { ...REST_BONES, ...pose.bones }); applyHipsOffset(rig, pose.rootY ?? 0);
		editKeys(id, state => {
			state.tracked = new Set([...resolved.chains.keys(), ...resolved.fkJoints.keys()]);
			ikBakeKeyframe(resolved.chains, state, at, resolved.fkJoints);
		});
	}
	function editTrail(id, { track = "hips", grabFrame, radiusFrames, delta }) {
		rigOnly(id, 'trails');
		const take = motionFor(id), character = appContext.storeDomain('cast').read().find(row => row.id === id);
		if (!take) throw new StudioProtocolError('TARGET_NOT_READY', 'Load a take first.');
		const scale = character.scale ?? 1;
		const rig = rigFor(id);
		const clipDelta = worldDeltaToTrailClip(take, delta, { track, grabFrame, radiusFrames, rig, scale });
		const edited = snapshotTake(applyTrailFalloffDelta(take, { track, grabFrame, radiusFrames, clipDelta }));
		writeLayer(id, { take: edited });
		castWrite(rows => rows.map(row => row.id === id ? { ...row, motionRef: { ...row.motionRef, trailEdits: edited.trailEdits } } : row));
	}
	function runPrepared(characterId, apply) {
		if (running) return apply();
		let result;
		const token = crypto.randomUUID(); prepared.set(token, () => { result = apply(); return result; });
		try { run('motion.applyPrepared', { characterId, token }); return result; }
		finally { prepared.delete(token); }
	}
	function persistTake(take, motionRef) {
		if (!take?.sourceBytes) return;
		(async () => {
			let record = appContext.shared.motionEncodingCacheRef.current.get(take.sourceBytes);
			if (!record) { record = await encodeMotionResource(take.sourceBytes, { prompt: motionRef?.prompt, sourceUrl: motionRef?.url }); appContext.shared.motionEncodingCacheRef.current.set(take.sourceBytes, record); }
			appContext.shared.projectMotionsRef.current.set(record.motionId.toLowerCase(), record);
			const db = await openMotionDb(); try { await putMotion(db, record); } finally { db.close(); }
		})().catch(error => console.warn('[cozyclay] could not cache motions', error));
	}
	function run(id, args) {
		const result = appContext.bus.run(id, args);
		const checked = receipt => { if (!receipt.ok) throw new StudioProtocolError(receipt.code, receipt.message); return receipt; };
		return result?.then ? result.then(checked) : checked(result);
	}
	let gesture = null;
	function finishGesture(cancel = false) {
		if (!gesture) return;
		const active = gesture; gesture = null; active.unsubscribe?.(); active.release?.();
		if (cancel && !active.txId) for (const image of active.rigs.values()) appContext.shared.restoreExportRig(image);
		if (active.txId) return run(cancel ? 'run.cancel' : 'run.commit', { txId: active.txId });
	}
	function beginGesture() {
		if (gesture) return;
		const commit = () => finishGesture(), cancel = () => finishGesture(true), key = event => { if (event.key === 'Escape') cancel(); };
		const events = { pointerup: commit, pointercancel: cancel, blur: commit, keydown: key };
		for (const [name, handler] of Object.entries(events)) globalThis.window?.addEventListener?.(name, handler);
		gesture = { rigs: rigSnapshots(), release() { for (const [name, handler] of Object.entries(events)) globalThis.window?.removeEventListener?.(name, handler); } };
	}
	function edit(id, args) {
		if (!gesture) return run(id, args);
		if (gesture.id && gesture.id !== id) { finishGesture(); beginGesture(); }
		if (!gesture.txId) {
			gesture.id = id; gesture.txId = run('run.begin', { id, args }).txId;
			gesture.unsubscribe = appContext.bus.subscribe(event => { if (event.type === 'transaction.cancelled' && event.txId === gesture?.txId) { const current = gesture; gesture = null; current.unsubscribe(); current.release(); } });
		}
		return run('run.update', { txId: gesture.txId, args });
	}
	const domain = { documentStore, read, write, layer, writeLayer, motionFor, fullMotionFor, visibleMotion, snapshotTake, project,
		setKeys, setRangePinState, bakeRangePin, removePin, editKeys, setKey, replace, clear, editSegments, castWrite, run, edit, beginGesture, finishGesture, beginAction, runPrepared, persistTake,
		insideAction: () => running > 0, bakeCurrentKey, keyPose, editTrail,
		applyPrepared(token) { const apply = prepared.get(token); if (!apply) throw new StudioProtocolError('STALE_TARGET', 'Prepared motion is no longer available.'); return apply(); },
		bindRender(context) { appContext = context; },
		viewRevision: () => viewRevision, canUndo: id => documentStore.canUndo(id),
		stepHistory: redo => { finishGesture(); return Boolean((redo ? documentStore.redo : documentStore.undo)()); },
		document: () => ({ motion: read().map(row => {
			const take = motionFor(row.id);
			return take ? { ...row, take: { ...row.take, frames: take.frames, fps: take.fps, editSegments: take.editSegments } } : row;
		}) }), sceneSlice: slices => slices.motion ?? references(slices.cast),
		publish: rows => write(rows), commitDraft: write,
		switchLayer(id) { appContext.shared.loadedLayerCharRef.current = id; project(); notify(); },
		snapshotLegacy: () => read(), restoreLegacy: write,
		snapshotTarget(id) {
			const state = appContext.shared.readStudioState(), keys = decodeMotionKeys(layer(id).ikKeys), rig = rigFor(id);
			return { character: state.characters.find(row => row.id === id), fullMotion: fullMotionFor(id),
				ikState: { ...createIkState(), keys, tracked: new Set([...keys.values()].flatMap(entry => [...entry.keys()])) },
				frameCount: state.frameCount, committedIkEdits: layer(id).committedIkEdits, renderer: rig ? appContext.shared.snapshotExportRig(rig) : null };
		},
		removeLayer(id) { write(rows => rows.filter(row => row.id !== id)); },
		preview(id, take) { if (take) previews.set(id, take); else previews.delete(id); project(); notify(); },
		hydrate(id, take, reference) {
			const current = appContext.storeDomain('cast').read().find(row => row.id === id);
			const descriptor = layer(id).take;
			if (!descriptor || !sameMotionIntent(current?.motionRef, reference)) return false;
			takes.set(descriptor.resourceId, structuredClone(take));
			for (const rows of [read(), ...documentStore.history().past.map(entry => entry.snapshot.motion), ...documentStore.history().future.map(entry => entry.snapshot.motion)]) {
				for (const row of rows) for (const value of [row.take, row.fullTake]) if (value?.resourceId === descriptor.resourceId) decoded.delete(value);
			}
			notify(); return true;
		},
		load(rows) { finishGesture(true); previews.clear(); release(); native.dispose(); native = createDocumentStore({ owned: { motion: normalize(rows) } }); release = native.subscribe(notify); pruneTakes(); notify(); },
		dispose() { finishGesture(true); unregister(); unsubscribe(); release(); native.dispose(); listeners.clear(); takes.clear(); },
	};
	const unregister = appContext.registerStoreDomain('motion', domain);
	return domain;
}

export function useMotion(appContext) {
	const [domain] = useState(() => appContext.storeDomain('motion') ?? createMotionDomain(appContext, appContext.shared.characters));
	domain.bindRender(appContext);
	useDocumentDomain(domain.documentStore, 'motion');
	useSyncExternalStore(domain.documentStore.subscribe, domain.viewRevision, domain.viewRevision);
	useEffect(() => {
		domain.switchLayer(appContext.shared.activeChar.id);
		const start = () => domain.beginGesture(); window.addEventListener('pointerdown', start, true);
		return () => { window.removeEventListener('pointerdown', start, true); domain.finishGesture(true); };
	}, [domain, appContext.shared.activeChar.id]);
	// IK posing for Subject 1: dragging a wrist/ankle handle FOCUSES that
	// joint and solves its chain backward (two-bone analytic IK) on top of
	// the current pose; joints never dragged stay purely on the FK pose.
	// Keys land on the Full-Body lane as sparse per-chain world targets and
	// evaluate as the playhead moves. State lives in a ref — it changes
	// every drag tick and must not re-render the scene; ikTick re-renders
	// only the timeline markers.
	const [ikMode, setIkMode] = useState(false);
	// A drag records only the tracks it actually writes. The record is kept
	// outside React renders so pointer moves stay cheap and the drag-end bake
	// can create a delta key over the raw clip.
	const ikDragRef = useRef(null);
	const ikPreDragRef = useRef(null);
	const pendingIkEditRef = useRef(null);
	const ikCameraMemoryRef = useRef(new Map());

	const [ikChains, setIkChains] = useState(null);

	const [ikFkJoints, setIkFkJoints] = useState(null);

	const [ikFocus, setIkFocus] = useState(null);
	const [pendingIkEdit, setPendingIkEdit] = useState(null);

	// Foot snap (ground plant): while ON, body (hips) drags keep the feet at
	// the positions captured when the drag started — the knees bend instead
	// of the feet sinking through the floor. Toggleable in the timeline.
	const [footSnap, setFootSnap] = useState(true);

	const [bodyContact, setBodyContact] = useState(true);

	// How far (in frames) a correction eases back to the underlying motion
	// outside its keyed range. 6 frames @ 24 fps = 0.25 s — long enough to
	// hide the seam, short enough that a mid-clip fix stays visibly local.
	const IK_CORRECTION_BLEND_FRAMES = 6;

	const [ikTick, setIkTick] = useState(0);

	const committedIkEdits = domain.layer(appContext.shared.activeChar.id).committedIkEdits;
	const setCommittedIkEdits = update => domain.writeLayer(appContext.shared.activeChar.id, { committedIkEdits: typeof update === 'function' ? update(domain.layer(appContext.shared.activeChar.id).committedIkEdits) : update });
	domain.onProject = () => setIkTick(value => value + 1);

	/* Grabbing the viewport trajectory line deforms the loaded take with a
	 * smoothstep falloff around the grab frame (pure local preview). The last
	 * finished drag stays pending so "Regenerate from trail edit" can send the
	 * auto-derived window through the existing motionEdit pipeline. */
	const [trailFalloffS, setTrailFalloffS] = useState(0.5);

	const [showTrails, setShowTrails] = useState(true);

	const [ikEditTool, setIkEditTool] = useState("ik");

	const [trailEdit, setTrailEdit] = useState(null);
	const [trailTrackFocus, setTrailTrackFocus] = useState("hips");
	const [rangePinSelection, setRangePinSelection] = useState(null);
	const [rangePinPartPick, setRangePinPartPick] = useState(null);
	const [rangePinPreview, setRangePinPreview] = useState(null);
	const pinLayer = domain.layer(appContext.shared.activeChar.id);
	const rangePins = useMemo(() => encodeRangePins(pinLayer.ikPins), [pinLayer.ikPins]);
	const rangePinResiduals = useMemo(() => decodeRangePinResiduals(pinLayer.ikPinResiduals), [pinLayer.ikPinResiduals]);

	const trailFalloffFrames = Math.max(1, Math.round(trailFalloffS * TIMELINE_FPS));

	function focusIkHandle(focus) {
		setIkFocus(focus);
		const hierarchyId = hierarchyIdForIkFocus(focus, appContext.shared.rowIdForCharIndex(appContext.shared.activeCharIndex));
		if (hierarchyId) {
			appContext.shared.setSelectedHierarchyId(hierarchyId);
		}
	}

	function selectedIkRange(frame = appContext.shared.tlFrame) {
		const count = Math.max(1, motion?.frames ?? appContext.shared.tlFrameCount ?? 1);
		if (!motion) return { startFrame: 0, endFrame: count - 1 };
		const edit = motion.editSegments ?? createMotionEdit(count);
		const layout = motionEditLayout(edit);
		const at = Math.max(0, Math.min(count - 1, Math.round(frame) || 0));
		const selected = layout.find((segment) => at >= segment.timelineStart && at <= segment.timelineEnd) ?? layout[0];
		return {
			startFrame: Math.max(0, selected?.timelineStart ?? 0),
			endFrame: Math.min(count - 1, selected?.timelineEnd ?? count - 1),
		};
	}

	function setPendingIkEditValue(value) {
		pendingIkEditRef.current = value;
		setPendingIkEdit(value);
	}

	function restorePendingIkState(pending) {
		// A replaced take or another authored edit owns the newer state.
		if (domain.layer(pending.characterId) !== pending.sourceLayer) return;
		const state = pending.state;
		state.keys = copyPhysicsKeys(pending.beforeKeys);
		state.tracked = new Set(pending.beforeTracked);
		state.targets = new Map([...pending.beforeTargets].map(([id, target]) => [id, target.clone()]));
		state.plants = new Map([...pending.beforePlants].map(([id, target]) => [id, target.clone()]));
		if (pending.rig) {
			if (pending.beforeFrame === appContext.shared.tlFrame) appContext.shared.restoreExportRig(pending.beforeRig);
			else appContext.shared.poseMemberAtFrame(pending.rig, pending.motion, state, appContext.shared.tlFrame, IK_CORRECTION_BLEND_FRAMES);
			if (state.chains) ikSeedTargets(state.chains, state);
		}
	}

	function cancelPendingIkEdit() {
		const pending = pendingIkEditRef.current;
		if (!pending) return false;
		restorePendingIkState(pending);
		setPendingIkEditValue(null);
		ikDragRef.current = null;
		ikPreDragRef.current = null;
		setIkTick((value) => value + 1);
		return true;
	}

	function applyPendingIkEdit() {
		const pending = pendingIkEditRef.current;
		if (!pending) return false;
		if (pending.characterId !== appContext.shared.activeChar.id || domain.layer(pending.characterId) !== pending.sourceLayer) {
			cancelPendingIkEdit();
			return false;
		}
		const session = domain.beginAction(new Map([[pending.characterId, pending.beforeRig]]));
		try {
			session.run(() => domain.setKeys(pending.characterId, pending.candidate.keys));
			session.commit();
		} catch (error) {
			session.cancel();
			throw error;
		}
		setPendingIkEditValue(null);
		ikDragRef.current = null;
		ikPreDragRef.current = null;
		if (pending.rig) appContext.shared.poseMemberAtFrame(pending.rig, motion, pending.state, appContext.shared.tlFrame, IK_CORRECTION_BLEND_FRAMES);
		setIkTick((value) => value + 1);
		appContext.notify(isKo
			? `IK 보정을 ${pending.startFrame}–${pending.endFrame}프레임에 적용했어요`
			: `Applied IK correction across frames ${pending.startFrame}–${pending.endFrame}`);
		return true;
	}

	function clearTrailTrackFocus() {
		setTrailTrackFocus(null);
		setIkFocus(null);
	}
	function selectTrailTrack(track) {
		setTrailTrackFocus(track);
		focusIkHandle(track);
	}

	useEffect(() => {
		if (!ikMode || ikEditTool !== "trail") setTrailTrackFocus(TRAIL_TRACKS.some(track => track.id === ikFocus) ? ikFocus : "hips");
	}, [ikMode, ikEditTool, ikFocus]);

	function rangePinObjectWorldMatrix(objectId, frame) {
		const object = appContext.shared.sceneObjects.find((entry) => entry.id === objectId);
		if (!object) return null;
		const local = rangePinObjectMatrixAt(object, frame, { frameCount: motion?.frames ?? appContext.shared.tlFrameCount, fps: motion?.fps ?? appContext.shared.tlFps }, new THREE.Matrix4());
		if (!object.attach) return local;
		const attachRef = appContext.shared.attachFrameRef?.current;
		if (!attachRef) return local;
		const parent = attachRef(object.attach.characterId, object.attach.bone ?? null, new THREE.Matrix4());
		return parent ? parent.multiply(local) : local;
	}
	function rangePinApplyFrame(frame, state = appContext.shared.ikStateRef.current) {
		appContext.shared.poseMemberAtFrame(appContext.shared.activeRig, motion, null, frame);
		if (ikChains && state.keys.size > 0) ikEvaluate(ikChains, state, frame, ikFkJoints, IK_CORRECTION_BLEND_FRAMES);
	}
	function captureRangePinTargetForDraft(draft) {
		if (!motion || !appContext.shared.activeRig || !ikChains) return null;
		const objectWorldMatrix = draft.targetKind === "object" ? (objectId, frame) => rangePinObjectWorldMatrix(objectId, frame) : null;
		const target = captureRangePinTarget({
			chains: ikChains, track: draft.track, frame: draft.startFrame,
			applyFrame: (frame) => rangePinApplyFrame(frame),
			space: draft.targetKind === "object" ? "object" : "world",
			objectId: draft.targetKind === "object" ? draft.objectId : null,
			objectWorldMatrix,
		});
		const pin = normalizeRangePin({ id: draft.id, track: draft.track, startFrame: draft.startFrame, endFrame: draft.endFrame, blend: draft.blend, reach: draft.reach ?? "body", target }, { clipFrames: motion.frames });
		return { pin, targetWorld: rangePinTargetWorld(pin, appContext.shared.tlFrame, { objectWorldMatrix }) };
	}
	function previewRangePinDraft(draft) {
		const state = ensureRangePinState(appContext.shared.ikStateRef.current);
		const conflictFrames = rangePinConflictFrames(draft, state);
		const overlapping = overlappingRangePin(draft, state);
		try {
			const resolved = captureRangePinTargetForDraft(draft);
			setRangePinPreview({ draft, track: draft.track, target: resolved?.targetWorld?.toArray() ?? null, conflictFrames, overlapError: rangePinOverlapMessage(overlapping) });
		} catch {
			setRangePinPreview({ draft, track: draft.track, target: null, conflictFrames, overlapError: rangePinOverlapMessage(overlapping) });
		}
	}
	function applyRangePinDraft(draft) {
		if (!motion || !appContext.shared.activeRig || !ikChains) return;
		const state = ensureRangePinState(appContext.shared.ikStateRef.current);
		const overlap = overlappingRangePin(draft, state);
		if (overlap) { appContext.notify(rangePinOverlapMessage(overlap)); return; }
		const conflicts = rangePinConflictFrames(draft, state);
		if (conflicts.length && !draft.replaceExisting) { appContext.notify(ko("Confirm Replace existing keys before applying this pin.", "이 고정을 적용하려면 기존 키 교체를 확인하세요.")); return; }
		try {
			const resolved = captureRangePinTargetForDraft(draft);
			domain.run('motion.rangePin.apply', { characterId: appContext.shared.activeChar.id, pin: resolved.pin, replaceExisting: Boolean(draft.replaceExisting) });
			setRangePinSelection(resolved.pin.id);
			setRangePinPreview({ draft: { ...draft, id: resolved.pin.id }, track: resolved.pin.track, target: resolved.targetWorld.toArray(), conflictFrames: [], overlapError: "" });
			appContext.shared.setTlPlaying(false);
			appContext.notify(isKo ? `${resolved.pin.track} 고정을 적용했어요 · ${resolved.pin.startFrame}–${resolved.pin.endFrame}프레임` : `Applied ${resolved.pin.track} pin · frames ${resolved.pin.startFrame}–${resolved.pin.endFrame}`);
		} catch (error) { appContext.notify(ko(`Could not apply pin — ${error.message}`, `고정을 적용하지 못했어요 — ${error.message}`)); }
	}
	function deleteRangePin(pinId) {
		const state = ensureRangePinState(appContext.shared.ikStateRef.current), pin = state.pins.get(pinId);
		if (!pin) return;
		domain.run('motion.rangePin.remove', { characterId: appContext.shared.activeChar.id, pinId });
		// Persisting the command updates the document before React publishes the
		// next render. Clear the live evaluator now too, so a draft preview made
		// during that transition cannot report the deleted pin as overlapping.
		const liveState = ensureRangePinState(appContext.shared.ikStateRef.current);
		removeRangePinKeys(liveState, pinId);
		liveState.pins.delete(pinId);
		liveState.pinResiduals.delete(pinId);
		liveState.tracked = new Set([...liveState.keys.values()].flatMap((entry) => [...entry.keys()]));
		setRangePinSelection(null); setRangePinPreview(null); setIkTick((value) => value + 1);
		appContext.notify(isKo ? `${pin.track} 고정을 삭제했어요` : `Deleted ${pin.track} pin`);
	}

	/** Deep copy of an IK state's key map: frame → Map(trackId → {q,p}), with
	 * every quaternion/position cloned so a snapshot never shares references
	 * with the live rig state (a later bake would otherwise rewrite history). */
	function snapshotIkKeys(ikState) {
		return copyPhysicsKeys(ikState?.keys ?? new Map());
	}

	function editIkKeys(mutate) {
		const before = snapshotIkKeys(appContext.shared.ikStateRef.current);
		const result = mutate();
		const owned = appContext.storeDomain('motion');
		if (owned) owned.setKeys(appContext.shared.loadedLayerCharRef.current, appContext.shared.ikStateRef.current.keys);
		else appContext.shared.markSemanticEdit("pose", before, appContext.shared.ikStateRef.current.keys);
		return result;
	}

	/* One IK-key core for every cast member, shared by the Key button, a pose
	 * drag's bake, the Full-Body lane's delete and run_action. The loaded
	 * layer's keys live on the live IK state, every other character's on its
	 * stored one (created on its first key). */
	function ikStateFor(characterId) {
		if (characterId === appContext.shared.loadedLayerCharRef.current) return appContext.shared.ikStateRef.current;
		let state = appContext.shared.ikStatesRef.current.get(characterId);
		if (!state) appContext.shared.ikStatesRef.current.set(characterId, (state = createIkState()));
		return state;
	}

	function editCharacterIkKeys(characterId, mutate) {
		if (appContext.storeDomain('motion')) return appContext.storeDomain('motion').editKeys(characterId, mutate);
		const state = ikStateFor(characterId);
		const before = snapshotIkKeys(state);
		mutate(state);
		appContext.shared.markSemanticEdit("pose", before, state.keys);
		setIkTick((value) => value + 1);
	}

	/** Write one key from its JSON form (studio-actions.js character.setIkKey):
	 * each named track replaces its key at `frame` and joins the tracked set. */
	function setCharacterIkKey(characterId, frame, tracks) {
		refuseRigOnly(appContext.shared.castMemberOf(characterId), 'ik');
		if (appContext.storeDomain('motion')) return appContext.storeDomain('motion').setKey(characterId, frame, tracks);
		editCharacterIkKeys(characterId, (state) => {
			let entry = state.keys.get(frame);
			if (!entry) state.keys.set(frame, (entry = new Map()));
			for (const [track, key] of Object.entries(tracks)) {
				entry.set(track, ikTrackKeyFromJson(key));
				ikTouch(state, track);
			}
		});
	}

	function removeCharacterIkKey(characterId, frame) {
		const character = appContext.shared.castMemberOf(characterId);
		const state = ikStateFor(characterId);
		if (!state.keys.has(frame)) {
			const keyed = ikKeyframes(state);
			throw new StudioProtocolError("STALE_TARGET", `${character.subject || character.id} has no IK key at frame ${frame}${keyed.length ? `; keyed frames: ${keyed.join(", ")}` : ""}.`);
		}
		editCharacterIkKeys(characterId, (target) => ikRemoveKeyframe(target, frame));
	}

	function clearCharacterIkKeys(characterId) {
		appContext.shared.castMemberOf(characterId);
		const count = ikStateFor(characterId).keys.size;
		if (!count) return 0;
		editCharacterIkKeys(characterId, (target) => {
			target.keys.clear();
			target.tracked.clear();
			target.plants.clear();
			target.pins?.clear();
			target.pinResiduals?.clear();
		});
		return count;
	}

	// Loaded motion: decoded arrays plus the world anchor captured at load.
	const motion = domain.visibleMotion(appContext.shared.activeChar.id);
	useEffect(() => {
		const pending = pendingIkEditRef.current;
		if (pending && (pending.characterId !== appContext.shared.activeChar.id
			|| pending.rig !== appContext.shared.activeRig || pending.motion !== motion
			|| pending.sourceLayer !== domain.layer(pending.characterId)
			|| !ikMode || ikEditTool !== "ik")) cancelPendingIkEdit();
	}, [appContext.shared.activeChar.id, appContext.shared.activeRig, motion, pinLayer, ikMode, ikEditTool]);
	const rangePinRebuildRef = useRef(null);
	const rangePinSourceStamp = JSON.stringify([pinLayer.take, appContext.shared.activeChar.id]);
	// Object-bound pins follow edited prop transforms and paths, as in the
	// source branch. Rebuilding derived keys must not create an undo entry.
	useEffect(() => {
		if (!motion || !ikChains || rangePinRebuildRef.current === rangePinSourceStamp) return;
		const timer = setTimeout(() => {
			rangePinRebuildRef.current = rangePinSourceStamp;
			const state = ensureRangePinState(appContext.shared.ikStateRef.current);
			for (const pin of [...state.pins.values()].filter(pin => pin.target.space === "object")) {
				if (!appContext.shared.sceneObjects.some(object => object.id === pin.target.objectId)) {
					removeRangePinKeys(state, pin.id);
					state.pinResiduals.set(pin.id, []);
				} else {
					try { domain.bakeRangePin(appContext.shared.activeChar.id, pin, false, true); }
					catch { /* A prop can be unavailable while its transform remounts. */ }
				}
			}
		}, 150);
		return () => clearTimeout(timer);
	}, [rangePinSourceStamp, ikChains]);


	const [motionBusy, setMotionBusy] = useState(false);


	function advanceFrame(steps = 1) {
		const count = Math.max(1, Math.floor(steps));
		const previewEnd = appContext.shared.cameraPreviewEndRef.current;
		if (previewEnd != null && appContext.shared.tlFrameRef.current + count >= previewEnd) {
			appContext.shared.cameraPreviewEndRef.current = null;
			appContext.shared.setTlFrame(previewEnd);
			appContext.shared.setTlPlaying(false);
			return;
		}
		appContext.shared.setTlFrame((f) => (f + count) % appContext.shared.frameCountRef.current);
	}

	function stepFrame(delta) {
		appContext.shared.setTlFrame((f) => Math.max(0, Math.min(f + delta, appContext.shared.frameCountRef.current - 1)));
	}

	function leaveIkMode() {
		cancelPendingIkEdit();
		const poserCam = appContext.shared.poserCamRef?.current;
		if (ikMode && poserCam && appContext.shared.activeChar?.id) {
			const look = appContext.shared.poserLook?.current ?? {};
			ikCameraMemoryRef.current.set(appContext.shared.activeChar.id, {
				position: poserCam.position.clone(),
				quaternion: poserCam.quaternion.clone(),
				yaw: look.yaw ?? poserCam.rotation.y,
				pitch: look.pitch ?? poserCam.rotation.x,
			});
		}
		setIkMode(false);
		setIkFocus(null);
	}

	/** Hand `rig` over to playback. Every path that starts a clip — a loaded
	 *  take, a browser-baked one — does the same two things: drop out of IK
	 *  EDIT mode (playback is the new context; the IK KEYS stay and keep
	 *  correcting the clip layer-style) and swap the pre-playback bone
	 *  baseline, so a re-load never snapshots mid-animation and clearing
	 *  always returns to the blocking pose. */
	function beginPlaybackOn(rig) {
		leaveIkMode();
		const previous = appContext.shared.restoreRef.current;
		appContext.shared.restoreRef.current = null;
		if (previous) restorePlaybackBones(previous.rig, previous.bones);
		appContext.shared.restoreRef.current = { rig, bones: snapshotPlaybackBones(rig) };
	}

	/** Land takes 1..N-1 on the rest of the cast. Each extra take is its OWN
	 *  layer: it goes to that entry's sessionMotion, NOT through the editing
	 *  buffer, which holds the active character's clip alone. Returns how many
	 *  performers actually landed. */
	const authoredSupportDescriptors = () => appContext.shared.sceneObjects.map((object) => ({
		x: object.x,
		z: object.z,
		rotDeg: object.rot ?? 0,
		supportY: (object.y ?? 0) + supportHeightForObject(object) * (object.scaleY ?? 1),
		topY: (object.y ?? 0) + supportHeightForObject(object) * (object.scaleY ?? 1),
		width: (object.footprint?.width ?? 0) * (object.scaleX ?? 1),
		depth: (object.footprint?.depth ?? 0) * (object.scaleZ ?? 1),
	}));


	function commitLoadedTake(characterId, take, { recipe = null, job = null, promptClips = null, scale = characterScaleFor(take) } = {}) {
		const owned = appContext.storeDomain('motion');
		const previous = owned.layer(characterId);
		const imported = recipe ?? (job ? previous.takeRecipe : { seed: null, blocks: [{ prompt: take.prompt, duration: take.frames / take.fps }], lineEdits: [] });
		const versions = recipe || job ? previous.takeVersions : pushTakeVersion(previous.takeVersions, {
			motionUrl: take.url, recipe: imported, savedAt: Date.now(), label: ko('Loaded', '불러옴'),
		}, TAKE_VERSIONS_MAX);
		owned.replace(characterId, take, { recipe: imported, versions });
		const motionRef = { url: take.url, prompt: take.prompt, rotationDeg: take.rotationDeg, anchorX: take.anchorX, anchorZ: take.anchorZ,
			calibration: take.sceneCalibration, ...(take.trailEdits ? { trailEdits: take.trailEdits } : {}), ...(take.motionId ? { motionId: take.motionId } : {}) };
		owned.castWrite(rows => rows.map(row => row.id === characterId ? { ...row, scale, motionRef,
			layer: promptClips ? { ...row.layer, promptClips } : row.layer } : row));
		owned.persistTake(take, motionRef);
	}

	// Decoded motion + the world anchor: frame 0 always starts at Subject 1.
	// Authored root destinations are generated by ARDY as sparse constraints,
	// so playback consumes the returned trajectory without coordinate warping.
	async function loadMotion(
		url,
		prompt,
		rotationDeg = appContext.shared.charA.rot,
		drop = null,
		targetCharacterId = appContext.shared.activeChar.id,
		targetPromptClips = null,
		// `preview: true` means "put this clip on screen, do not treat it as a
		// new take". The line-edit preview loop swaps the viewport several times
		// a minute, and every announcement this function normally makes — the
		// load toast, the auto-drop toast, clearing the IK keys, snapping the
		// playhead back to 0 — is an announcement about a take CHANGING. A
		// preview is the same take seen a second time, so it makes none of them.
		{ preview = false, calibration = null, tutorialEpoch = null, commandContext = null, recipe = null, job = null, personScaleFallback = null } = {},
	) {
		setMotionBusy(true);
		try {
			refuseRigOnly(appContext.live.characters.find((entry) => entry.id === targetCharacterId), "take");
			// Inbound boundary: an ARDY take (20 fps) or a filmed one (30/60)
			// becomes a production-clock clip here, once, before anything on
			// the timeline counts its frames. Same-rate input rides through.
			// A drop is staging applied to the clip itself, so it happens at
			// the same boundary — trims and IK then see the dropped take.
			const retimed = retimeMotion(await loadMotionFromUrl(url), TIMELINE_FPS);
			if (retimed.sourceBytes) retimed.motionId = await sha256Hex(retimed.sourceBytes);
			if (tutorialEpoch !== null && tutorialEpoch !== appContext.shared.tutorialProjectEpochRef.current) return null;
			const normalizedCalibration = normalizeMotionCalibration(calibration);
			// Scene yaw/XY translation belong to the character's scene transform.
			// Applying them to both the arrays and the Character group would rotate
			// the trajectory twice and leave rotMats facing the old direction.
			const playbackCalibration = { ...normalizedCalibration, yawDeg: 0, offsetX: 0, offsetZ: 0 };
			// Scene calibration is optional metadata from the capture boundary. It
			// runs before support/fall staging so every downstream measurement uses
			// the same scene-space coordinates.
			const raw = applyMotionCalibration(retimed, playbackCalibration).motion;
			// Staging descriptors are authored in scene metres while decoded
			// trajectories are canonical-body units. Resolve stature before any
			// support or fall math so a 0.8x/1.2x performer still lands exactly on
			// the same authored surface after playback multiplies the clip.
			const motionScale = characterScaleFor(raw);
			const targetCharacter = appContext.live.characters.find((entry) => entry.id === targetCharacterId);
			if (!targetCharacter) throw new Error(`Motion target ${targetCharacterId} no longer exists.`);
			const sceneAnchorX = targetCharacter.x + normalizedCalibration.offsetX;
			const sceneAnchorZ = targetCharacter.z + normalizedCalibration.offsetZ;
			const sceneRotationDeg = rotationDeg + normalizedCalibration.yawDeg;
			const rig = appContext.shared.rigs[targetCharacter.id] ?? await appContext.shared.waitForRig(targetCharacter.id);
			if (tutorialEpoch !== null && tutorialEpoch !== appContext.shared.tutorialProjectEpochRef.current) return null;
			// No explicit drop staged: a character standing on a raised object
			// whose take walks off the edge falls on its own — ARDY motion is
			// flat-ground, so the stage supplies the gravity.
			const supports = authoredSupportDescriptors();
			// A support's top is scene data, never guessed from the motion.  Apply
			// only when the clip shows an upward root trend entering its footprint;
			// ordinary deck walks remain byte-for-byte unchanged.
			const raised = drop ? raw : applySupportRise(raw, supports, {
				subjectX: sceneAnchorX,
				subjectY: targetCharacter.y ?? 0,
				subjectZ: sceneAnchorZ,
				rotationDeg: sceneRotationDeg,
				worldScale: motionScale,
			});
			const staging = drop ?? autoRoofDrop(
				raised,
				{ x: sceneAnchorX, z: sceneAnchorZ, y: targetCharacter.y ?? 0, rotationDeg: sceneRotationDeg },
				supports,
				{ worldScale: motionScale },
			);
			const decoded = drop ? applyRootDrop(raised, staging, { worldScale: motionScale }) : applyAutoFall(raised, staging, { worldScale: motionScale });
			if (!drop && staging && !preview) {
				appContext.notify((isKo, ko) => ko(
					`Auto drop staged: the take leaves its support at ${staging.fromS.toFixed(1)}s and falls ${staging.meters.toFixed(1)}m`,
					`자동 낙하 적용: ${staging.fromS.toFixed(1)}초에 지지면을 벗어나 ${staging.meters.toFixed(1)}m 낙하`,
				));
			}
			const targetStillExists = appContext.live.characters.some((entry) => entry.id === targetCharacter.id);
			if (!targetStillExists) throw new Error(`Motion target ${targetCharacterId} no longer exists.`);
			const apply = () => {
			const bufferOwnsTarget = targetCharacter.id === appContext.shared.loadedLayerCharRef.current;
			beginPlaybackOn(rig);
			// THE INVARIANT: the take's travel assumes the character is scaled.
			// Extraction divided the root translation by the filmed person's
			// stature, so the clip and that stature have to be applied together
			// or every stride overshoots by the same factor and the feet skate.
			// The scale rides INSIDE the npz, so this one line covers every path
			// that loads a motion; an ARDY-generated take stores none and is
			// canonical, 1.
			const measuredScale = characterScaleFor(decoded);
			const scale = measuredScale === 1 && Number.isFinite(personScaleFallback) ? characterScaleFor(null, personScaleFallback) : measuredScale;
			const loaded = {
			// Identity calibration retains the legacy frame-zero anchorX: targetCharacter.x
			// and anchorZ: targetCharacter.z contract; calibrated takes use the scene anchor.
			// Capture the exact prompt this motion was generated from; the
			// timeline keeps showing it even if the input field is edited
			// afterwards.
			prompt: typeof prompt === "string" ? prompt : "",
				...decoded,
				url,
				anchorX: sceneAnchorX,
				anchorZ: sceneAnchorZ,
				anchorFrame: 0,
				rotationDeg: sceneRotationDeg,
				sceneCalibration: normalizedCalibration,
				editSegments: createMotionEdit(decoded.frames),
			};
			const owned = appContext.storeDomain('motion');
			if (preview) owned.preview(targetCharacter.id, url === owned.motionFor(targetCharacter.id)?.url ? null : loaded);
			else {
				commitLoadedTake(targetCharacter.id, loaded, { recipe, job, promptClips: targetPromptClips, scale });
				if (bufferOwnsTarget) { appContext.shared.setTlFrame(0); appContext.shared.setTlPlaying(false); }
			}
			return scale;
			};
			return preview ? apply() : commandContext ? commandContext.commit(apply)
				: appContext.storeDomain('motion').runPrepared(targetCharacterId, apply);
		} catch (err) {
			if (tutorialEpoch !== null && tutorialEpoch !== appContext.shared.tutorialProjectEpochRef.current) return null;
			throw err;
		} finally {
			setMotionBusy(false);
		}
	}

	/** Drop the ACTIVE character's take, its IK corrections, prompt blocks and
	 * the stature the take imposed. One Ctrl+Z entry brings all four back; nothing to clear
	 * records nothing, so the shortcut never becomes a dead press.
	 *
	 * The pose flows (studio Apply/Reset, pose tiles, photo pose) call this
	 * first and then write the pose: the snapshot taken here predates both, so
	 * one undo restores the take AND the pose it replaced. */
	function clearMotion() {
		return appContext.storeDomain('motion').clear(appContext.shared.activeChar.id);
	}

	/** Cut the ACTIVE character's take to [start, end] of the CURRENT view.
	 *  Offsets compose, so a second cut still slices the original take; a cut
	 *  take drops its bridge url — its frames no longer match the source npz,
	 *  and IK-edit regeneration must not pretend they do. Per-character layers
	 *  mean the cut lands on this layer only; nobody else's clip moves. */
	function applyMotionTrim(start, end) {
		return appContext.storeDomain('motion').edit('motion.trim', { characterId: appContext.shared.activeChar.id, start, end });
	}

	function resetMotionTrim() {
		return appContext.storeDomain('motion').run('motion.resetTrim', { characterId: appContext.shared.activeChar.id });
	}

	function cutMotionAtPlayhead() {
		return appContext.storeDomain('motion').run('motion.cut', { characterId: appContext.shared.activeChar.id, frame: appContext.shared.tlFrame });
	}

	function changeMotionSegmentSpeed(id, speed) {
		return appContext.storeDomain('motion').run('motion.setSegmentSpeed', { characterId: appContext.shared.activeChar.id, id, speed });
	}

	/** Drop one Full-Body segment from the take. The removal composes like a
	 * trim: the source frames stay untouched, so the trim-reset path (right-click
	 * an outer handle) still restores the whole take. */
	function removeMotionSegmentById(id) {
		return appContext.storeDomain('motion').run('motion.removeSegment', { characterId: appContext.shared.activeChar.id, id });
	}

	// Everyone EXCEPT the active character, posed at an absolute frame from
	// their own session clips and their STORED IK corrections (#77).
	const poseOtherCastMembers = (frame) => {
		for (const entry of appContext.shared.characters) {
			if (entry.id === appContext.shared.activeChar.id || isProxyFigure(entry)) continue;
			appContext.shared.poseMemberAtFrame(appContext.shared.rigs[entry.id], entry.sessionMotion, appContext.shared.ikStatesRef.current.get(entry.id), frame, IK_CORRECTION_BLEND_FRAMES);
		}
	};

	function toggleIkMode() {
		const next = !ikMode;
		// Authoring modes are mutually exclusive: IK mode swaps the main pane to
		// the poser camera, which would silently invalidate any pulled path
		// anyway. Leaving the line mode explicitly says so instead.
		if (next) {
			// Always enter on the safe, detailed IK tool. Trail editing is an
			// explicit second tool and must never leave the regular handles
			// locked when the user re-enters IK mode.
			setIkEditTool("ik");
			// With a motion loaded, IK edits ON TOP of it: the motion is the
			// rough base layer, the IK keys the correction layer. Every frame
			// applies the clip first and the keyed corrections after, so the
			// composite is what gets pinned for re-generation. Pause playback
			// so a running playhead cannot fight the drag.
			appContext.shared.setTlPlaying(false);
			// Self-heal the ref after a hot-reload with an older state shape:
			// a missing `tracked` set would throw on the first drag.
			if (!appContext.shared.ikStateRef.current.tracked) appContext.shared.ikStateRef.current = createIkState();
			appContext.shared.ikStateRef.current.chains = ikChains;
			appContext.shared.ikStateRef.current.fkJoints = ikFkJoints;
			appContext.shared.ikStateRef.current.rig = appContext.shared.activeRig;
			// Handles open exactly on the effectors of the CURRENT pose —
			// non-destructive entry. (The evaluate effect applies the keyed
			// pose at this frame right after ikMode flips, so re-seating on
			// frame changes is handled there.)
			if (ikChains) ikSeedTargets(ikChains, appContext.shared.ikStateRef.current);
			// The main view switches to the poser camera: start it exactly on
			// the shot camera's pose so nothing jumps, then navigation moves
			// the POSER only — the shot camera (inset) stays frozen.
			const shotCam = appContext.shared.shotCamRef.current;
			const editorCam = appContext.shared.editorCamRef?.current;
			const poserCam = appContext.shared.poserCamRef.current;
			const pose = chooseIkEntryPose({
				rememberedPose: ikCameraMemoryRef.current.get(appContext.shared.activeChar.id) ?? null,
				editorPose: editorCam ? { position: editorCam.position, quaternion: editorCam.quaternion, yaw: appContext.shared.editorLook?.current?.yaw, pitch: appContext.shared.editorLook?.current?.pitch } : null,
				shotPose: shotCam ? { position: shotCam.position, quaternion: shotCam.quaternion, yaw: shotCam.rotation.y, pitch: shotCam.rotation.x } : null,
				lookThroughShot: appContext.shared.lookThroughShot,
			});
			if (pose && poserCam) {
				poserCam.position.copy(pose.position);
				poserCam.quaternion.copy(pose.quaternion);
				poserCam.rotation.order = "YXZ";
				appContext.shared.poserLook.current = { yaw: pose.yaw ?? poserCam.rotation.y, pitch: pose.pitch ?? poserCam.rotation.x };
			}
			setIkMode(true);
			appContext.notify(motion
				? ko("Pose mode — preview the correction, then apply it to the selected motion block", "포즈 모드 — 보정을 미리 본 뒤 선택한 모션 구간에 적용하세요")
				: ko("Pose mode — drag handles in the main view; the shot camera stays frozen in the inset", "포즈 모드 — 메인 뷰에서 핸들을 드래그하세요. 샷 카메라는 인셋에 고정됩니다"));
			return;
		}
		// Exit: the keyed pose stays — the evaluate effect re-applies the
		// current frame's keyed rotations the moment ikMode flips, so nothing
		// the user authored is lost by toggling. Untracked/unkeyed parts keep
		// their current (FK) pose.
		leaveIkMode();
		appContext.notify(ko("Pose mode off — keyed poses keep playing", "포즈 모드 꺼짐 — 키로 찍은 포즈는 계속 재생됩니다"));
	}

	// Drag solve, routed by handle kind: chain targets solve the two-bone
	// chain toward the target; mid joints reposition the elbow/knee with both
	// ends pinned (the handle snaps to the clamped position); FK joints swing
	// toward the pointer. The solved pose stays a preview until Apply.
	function ikSolve(kind, trackId, targetWorld) {
		const state = appContext.shared.ikStateRef.current;
		const ikChains = state.chains;
		const ikFkJoints = state.fkJoints;
		if (!ikDragRef.current) {
			const pending = pendingIkEditRef.current;
			ikPreDragRef.current = pending ?? {
				characterId: appContext.shared.activeChar.id,
				beforeFrame: appContext.shared.tlFrame,
				sourceLayer: domain.layer(appContext.shared.activeChar.id),
				state, rig: appContext.shared.activeRig, motion,
				beforeRig: appContext.shared.snapshotExportRig(appContext.shared.activeRig),
				beforeKeys: snapshotIkKeys(state),
				beforeTracked: new Set(state.tracked),
				beforeTargets: new Map([...state.targets].map(([id, target]) => [id, target.clone()])),
				beforePlants: new Map([...state.plants].map(([id, target]) => [id, target.clone()])),
			};
			ikDragRef.current = { frame: appContext.shared.tlFrame, ids: new Set(pending?.ids ?? []) };
		}
		ikDragRef.current = ikDragRecord(ikDragRef.current, appContext.shared.tlFrame);
		const touch = (id) => ikDragTouch(appContext.shared.ikStateRef.current, ikDragRef.current, id);
		if (kind === "chain") {
			const chain = appContext.shared.ikStateRef.current.chains?.get(trackId);
			if (!chain) return;
			touch(trackId);
			const clampedTarget = bodyContact ? clampIkTargetToFloor(trackId, targetWorld, 0, ikChains?.get(trackId)?.contactHeights ?? ikChains?.values().next().value?.contactHeights) : targetWorld;
			appContext.shared.ikStateRef.current.targets.set(trackId, clampedTarget.clone());
			solveIk(chain, clampedTarget);
			return;
		}
		if (kind === "mid") {
			// Mid tracks reference their parent chain through MID_TRACKS.
			const midDef = MID_TRACKS.find((t) => t.id === trackId);
			const chain = midDef ? appContext.shared.ikStateRef.current.chains?.get(midDef.chain) : null;
			if (!chain) return;
			touch(chain.track.id);
			solveMidJoint(chain, bodyContact ? clampIkTargetToFloor(trackId, targetWorld, 0, chain.contactHeights) : targetWorld);
			return;
		}
		// Effector swing: the rotation ring on a focused hand/foot. Rotates
		// only the end bone — the solved limb position is untouched — and the
		// bake on drag end now stores b2's quaternion with the chain's.
		if (kind === "swing") {
			const chain = appContext.shared.ikStateRef.current.chains?.get(trackId);
			if (!chain || !targetWorld?.axis) return;
			touch(trackId);
			solveEffectorSwing(chain, targetWorld.axis, targetWorld.angle, targetWorld.startQuat, targetWorld.startParentQuat);
			return;
		}
		// Body root (hips): arrow drags translate ({ worldDelta, startLocalPos
		// }), the centre sphere swings ({ axis, angle, startQuat, ... }). With
		// foot snap ON the feet stay at the positions captured when the drag
		// started — the legs re-solve after every hips transform so the knees
		// bend instead of the feet sinking through the floor.
		if (kind === "body") {
			const joint = ikFkJoints?.get(trackId);
			if (!joint) return;
			touch(trackId);
			if (footSnap && !appContext.shared.ikBodyDragRef.current && ikChains) {
				// Capture the plant points once, BEFORE the first hips move.
				ikPlantFeet(ikChains, appContext.shared.ikStateRef.current);
				appContext.shared.ikBodyDragRef.current = true;
			}
			if (targetWorld?.worldDelta && targetWorld?.startLocalPos) {
				if (bodyContact) solveHipsTranslateToFloor(joint, targetWorld.worldDelta, targetWorld.startLocalPos, 0, ikChains?.get("leftHand")?.contactHeights);
				else solveHipsTranslate(joint, targetWorld.worldDelta, targetWorld.startLocalPos);
			} else if (targetWorld?.axis) solveSwingAngle(joint, targetWorld.axis, targetWorld.angle, targetWorld.startQuat, targetWorld.startParentQuat);
			if (footSnap && ikChains) {
				ikSolvePlantedFeet(ikChains, appContext.shared.ikStateRef.current);
				// the planted re-solve wrote the leg bones — key them too
				touch("leftFoot");
				touch("rightFoot");
			}
			if (bodyContact && ikChains) {
				for (const id of chainsChangedBy(ikChains, () => applyBodyContact(ikChains, ikFkJoints, 0, { skipFeet: footSnap }))) touch(id);
			}
			return;
		}
		// FK swing: targetWorld is the trackball payload { axis, angle,
		// startQuat, startParentQuat } from the drag layer.
		const joint = ikFkJoints?.get(trackId);
		if (!joint || !targetWorld?.axis) return;
		touch(trackId);
		solveSwingAngle(joint, targetWorld.axis, targetWorld.angle, targetWorld.startQuat, targetWorld.startParentQuat);
	}

	// Drag end: retain the solved pose as a preview. Apply creates keys at both
	// boundaries of the selected timeline motion segment.
	function ikDragEnd() {
		appContext.shared.ikBodyDragRef.current = false;
		const drag = ikDragRef.current;
		ikDragRef.current = null;
		if (!motion) {
			keyIkPoseAtPlayhead();
			ikPreDragRef.current = null;
			setIkTick((n) => n + 1);
			return;
		}
		if (!drag?.ids?.size) {
			ikPreDragRef.current = null;
			return;
		}
		const state = appContext.shared.ikStateRef.current;
		const raw = (rawRig, at) => appContext.shared.poseMemberAtFrame(rawRig, motion, null, at);
		const keyed = bakeIkDragKey(state.chains, state.fkJoints, drag.frame, drag.ids, raw);
		if (!keyed) {
			ikPreDragRef.current = null;
			return;
		}
		const before = ikPreDragRef.current;
		const range = pendingIkEditRef.current ?? selectedIkRange(drag.frame);
		const next = copyPhysicsKeys(before.beforeKeys);
		const boundaries = bakeIkDragRange(state.chains, state.fkJoints, keyed, range.startFrame, range.endFrame, drag.ids, raw);
		for (const [at, entry] of boundaries) {
			if (!entry) continue;
			let frameEntry = next.get(at);
			if (!frameEntry) next.set(at, (frameEntry = new Map()));
			for (const [track, key] of entry) frameEntry.set(track, { ...key, blend: IK_CORRECTION_BLEND_FRAMES });
		}
		setPendingIkEditValue({
			...before,
			frame: drag.frame,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			ids: [...drag.ids],
			candidate: { ...state, keys: next, tracked: new Set([...state.tracked, ...drag.ids]) },
		});
	}

	/** Bake the current tracked rotations at the playhead into a scratch layer
	 * and set them as a key through the shared registry. A bake only writes
	 * TRACKED parts: with nothing dragged yet there is no key, nothing is
	 * dispatched and Ctrl+Z never goes dead. */
	function keyIkPoseAtPlayhead(dragIds = null) {
		if (appContext.storeDomain('motion')) return appContext.storeDomain('motion').bakeCurrentKey(appContext.shared.activeChar.id, appContext.shared.tlFrame, dragIds);
		const scratch = { ...createIkState(), tracked: new Set(appContext.shared.ikStateRef.current.tracked) };
		ikBakeKeyframe(ikChains, scratch, appContext.shared.tlFrame, ikFkJoints);
		const baked = scratch.keys.get(appContext.shared.tlFrame);
		return baked ? appContext.shared.runStudioAction("character.setIkKey", { characterId: appContext.shared.activeChar.id, frame: appContext.shared.tlFrame, tracks: ikKeyJson(baked) }) : null;
	}

	// Manual key: bake the current tracked rotations at the playhead.
	function ikAddKeyframe() {
		if (!ikChains) return;
		if (!keyIkPoseAtPlayhead()) return;
		appContext.notify(isKo ? `${appContext.shared.tlFrame}프레임에 전신 IK 키를 추가했어요` : `Full-body IK key at frame ${appContext.shared.tlFrame}`);
	}

	function ikDeleteKeyframe(frame) {
		if (!appContext.shared.ikStateRef.current.keys.has(frame)) return;
		appContext.shared.runStudioAction("character.removeIkKey", { characterId: appContext.shared.activeChar.id, frame });
	}

	/** With IK mode on over a loaded take, a pose pick is a CORRECTION, not a
	 * replacement: write the saved pose onto the rig and bake every IK part
	 * into a full-body key at the current frame. The take survives, and the
	 * key blends back into the clip outside its window exactly like a dragged
	 * key would. Returns false when there is nothing to key against so the
	 * caller can fall through to the plain pose-apply path. */
	function ikApplyPoseAsKey(pose) {
		if (!appContext.shared.activeRig || !motion) return false;
		if (appContext.storeDomain('motion')) { appContext.storeDomain('motion').run('ik.applyPose', { characterId: appContext.shared.activeChar.id, frame: appContext.shared.tlFrame, pose }); return true; }
		if (!ikChains) return false;
		// The clip's positional skinning left per-bone translations the FK pose
		// math never produced. The bake below stores every FK joint's position
		// (p) as-is, so posing rotations over those clip translations would key
		// a torn-apart body — bind translations first, ALWAYS.
		restoreBindPositions(appContext.shared.activeRig);
		// Reset-then-pose, the same shape the Character effect applies: unlisted
		// joints return to rest instead of keeping stale limbs from the clip.
		applyPose(appContext.shared.activeRig, { ...REST_BONES, ...pose.bones });
		// The hips' measured height rides into the bake: the hips FK joint keys
		// its local position (p), so a crouched pose keys a crouched body.
		applyHipsOffset(appContext.shared.activeRig, pose.rootY ?? 0);
		// The pose authors the whole body, so every part is tracked — an
		// untracked chain would silently keep the clip's limb.
		for (const id of ikChains.keys()) ikTouch(appContext.shared.ikStateRef.current, id);
		if (ikFkJoints) for (const id of ikFkJoints.keys()) ikTouch(appContext.shared.ikStateRef.current, id);
		editIkKeys(() => ikBakeKeyframe(ikChains, appContext.shared.ikStateRef.current, appContext.shared.tlFrame, ikFkJoints));
		// Handles re-seat on the posed effectors, ready to drag into a refinement.
		ikSeedTargets(ikChains, appContext.shared.ikStateRef.current);
		setIkTick((n) => n + 1);
		appContext.notify(isKo
			? `${appContext.shared.tlFrame}프레임에 포즈를 전신 IK 보정 키로 추가했어요 — 모션은 그대로예요`
			: `Pose keyed as a full-body IK correction at frame ${appContext.shared.tlFrame} — the take stays`);
		return true;
	}

	function onTrailDragStart({ track, grabFrame } = {}) {
		if (!motion) return;
		if (track) {
			setTrailTrackFocus(track);
			focusIkHandle(track);
		}
		const frame = Math.round(grabFrame ?? appContext.shared.tlFrame);
		appContext.shared.setTlFrame(frame);
		// The pre-drag take is both the deformation base (repeated moves re-derive
		// from it, so deltas never accumulate) and the undo snapshot.
		appContext.shared.trailBaseMotionRef.current = motion;
		appContext.storeDomain('motion').beginGesture();
	}

	/** World drag delta -> clip delta, shedding the character's stature scale
	 * (the trail is drawn scaled by it). */
	function trailClipDelta(base, delta, track = "hips", grabFrame = appContext.shared.tlFrame) {
		const statureScale = appContext.shared.activeChar.scale ?? 1;
		return worldDeltaToTrailClip(base, delta, { track, grabFrame, radiusFrames: trailFalloffFrames, rig: appContext.shared.activeRig, scale: statureScale });
	}

	/** Per-rAF drag preview. Deliberately React-free: the deformed take lands in
	 * a ref and on the rig directly, so a drag never re-renders the app. The
	 * trail/highlight lines are rewritten in place by MotionTrails itself. */
	function onTrailDragPreview({ track, grabFrame, delta }) {
		const base = appContext.shared.trailBaseMotionRef.current;
		if (!base) return;
		const deformed = applyTrailFalloffDelta(base, {
			grabFrame,
			radiusFrames: trailFalloffFrames,
			track, clipDelta: trailClipDelta(base, delta, track, grabFrame),
		});
		appContext.shared.trailPreviewMotionRef.current = deformed;
		const rig = appContext.shared.activeRig;
		if (!rig) return;
		applyMotionFrame(rig, deformed, Math.round(grabFrame));
		if (ikChains && appContext.shared.ikStateRef.current.keys.size > 0) {
			ikEvaluate(ikChains, appContext.shared.ikStateRef.current, Math.round(grabFrame), ikFkJoints, IK_CORRECTION_BLEND_FRAMES);
		}
	}

	function onTrailDragEnd({ track, grabFrame, delta }) {
		const base = appContext.shared.trailBaseMotionRef.current;
		const deformed = appContext.shared.trailPreviewMotionRef.current;
		appContext.shared.trailBaseMotionRef.current = null;
		appContext.shared.trailPreviewMotionRef.current = null;
		const size = delta ? Math.hypot(delta.x, delta.y, delta.z) : 0;
		if (!base || !deformed || size < 0.01) {
			// A sub-centimetre nudge is a mis-grab, not an authored edit: the
			// motion state never changed, so only the rig pose needs restoring.
			if (base && appContext.shared.activeRig) {
				applyMotionFrame(appContext.shared.activeRig, base, appContext.shared.tlFrame);
				if (ikChains && appContext.shared.ikStateRef.current.keys.size > 0) {
					ikEvaluate(ikChains, appContext.shared.ikStateRef.current, appContext.shared.tlFrame, ikFkJoints, IK_CORRECTION_BLEND_FRAMES);
				}
			}
			setTrailEdit(null);
			return;
		}
		const owned = appContext.storeDomain('motion');
		if (base !== owned.motionFor(appContext.shared.activeChar.id)) { owned.project(); throw new StudioProtocolError('STALE_TARGET', 'The take changed during the trail drag.'); }
		owned.run('motion.editTrail', { characterId: appContext.shared.activeChar.id, track, grabFrame, radiusFrames: trailFalloffFrames, delta });
		owned.finishGesture();
		setTrailEdit({ track, grabFrame, radiusFrames: trailFalloffFrames, clipDelta: trailClipDelta(base, delta, track, grabFrame) });
		const { startFrame, endFrame } = trailEditRange(base.frames, grabFrame, trailFalloffFrames);
		const conflictFrames = findAbsoluteIkKeyConflicts({ keys: appContext.shared.ikStateRef.current.keys, track, startFrame, endFrame });
		if (conflictFrames.length) appContext.notify(`${ko("Absolute IK keys in this range override the path edit — remove or re-key them", "이 구간의 절대 IK 키가 궤적 수정을 덮어써요 — 해당 키를 지우거나 다시 찍어주세요")} ${isKo ? `프레임 ${conflictFrames.join(", ")}` : `frames ${conflictFrames.join(", ")}`}`);
	}

	/** Send the pending trail edit through the existing motionEdit pipeline:
	 * the regen window is auto-derived from the grab + falloff, explicit IK
	 * keys inside the window ride as hard constraints (their tracks), and the
	 * deformed line contributes the grab-frame pose as a root guide. */
	async function restoreMotionRefs(list) {
		const epoch = ++appContext.shared.restoreEpochRef.current;
		const motions = appContext.shared.projectMotionsRef.current;
		try { const db = await openMotionDb(); const ids = [...new Set(list.map((entry) => entry.motionRef?.motionId?.toLowerCase()).filter(Boolean))]; const cached = await Promise.all(ids.map((id) => getMotion(db, id))); cached.filter(Boolean).forEach((record) => motions.set(record.motionId.toLowerCase(), record)); db.close(); } catch (error) { console.warn("[cozyclay] could not restore motion cache", error); }
		for (const entry of list) {
			const source = resolveMotionSource(entry.motionRef, motions);
			if (!entry.motionRef) continue;
			if (source.kind === "missing") {
				appContext.notify(isKo ? `저장된 모션이 누락되었습니다 (${entry.subject || entry.id})` : `Saved motion is missing for ${entry.subject || entry.id}`);
				continue;
			}
			const load = source.kind === "embedded" ? decodeMotionResource(source.record) : loadMotionFromUrl(source.url);
			load.then((raw) => {
				if (epoch !== appContext.shared.restoreEpochRef.current) return;
			// Inbound boundary: a re-fetched clip is retimed exactly like a
			// freshly generated one, so a reload cannot resurrect 20 fps frames.
			const sourceUrl = source.kind === "url" ? source.url : entry.motionRef?.url;
				const retimed = retimeMotion(raw, TIMELINE_FPS);
				const normalizedCalibration = normalizeMotionCalibration(entry.motionRef.calibration);
				const decoded = applyMotionCalibration(retimed, { ...normalizedCalibration, yawDeg: 0, offsetX: 0, offsetZ: 0 }).motion;
				const clip = {
					...decoded,
					url: sourceUrl,
					sourceBytes: raw.sourceBytes,
					prompt: entry.motionRef.prompt,
					anchorX: entry.motionRef.anchorX,
					anchorZ: entry.motionRef.anchorZ,
					anchorFrame: 0,
					rotationDeg: entry.motionRef.rotationDeg,
					sceneCalibration: normalizedCalibration,
					editSegments: createMotionEdit(decoded.frames),
				};
				if (entry.motionRef.calibration) clip.sceneCalibration = entry.motionRef.calibration;
				if (entry.motionRef.trailEdits) Object.assign(clip, restoreTrailEdits(clip, entry.motionRef.trailEdits));
				if (entry.motionRef.studioTakeId) clip.studioTakeId = entry.motionRef.studioTakeId;
				appContext.storeDomain('motion').hydrate(entry.id, clip, entry.motionRef);
			}).catch((error) => {
				if (epoch !== appContext.shared.restoreEpochRef.current) return;
				appContext.shared.setProjectManifest((current) => {
					const id = entry.motionRef?.motionId?.toLowerCase();
					if (!id || !current?.items?.some((item) => item.kind === "motion" && item.id === id)) return current;
					const items = current.items.map((item) => item.kind === "motion" && item.id === id
						? { ...item, status: "missing", url: undefined }
						: item);
					const totals = { embedded: 0, external: 0, missing: 0, bytes: 0 };
					for (const item of items) {
						totals[item.status] += 1;
						if (Number.isFinite(item.bytes)) totals.bytes += item.bytes;
					}
					return { items, totals, missing: items.filter((item) => item.status === "missing") };
				});
				// A saved take that fails to refetch used to vanish silently — the
				// user would find a merely posed character and assume their motion
				// was lost. Name it and offer the reload path.
				const subject = entry.subject || entry.id;
				appContext.notify(isKo
					? `저장된 모션을 다시 불러오지 못했어요 (${subject}) [${error?.code || "decode"}]`
					: `Saved motion could not be restored for ${subject} [${error?.code || "decode"}]`);
			});
		}
	}

	domain.beginPlayback = id => { const rig = appContext.shared.rigs[id]; if (rig) beginPlaybackOn(rig); };
	domain.loadRemote = async (args, context) => {
		const entry = domain.layer(args.characterId).takeVersions.find(version => version.motionUrl === args.motionUrl);
		if (args.motionUrl && !entry) throw new StudioProtocolError('TARGET_NOT_READY', 'This take version is no longer available.');
		if (args.drop != null && !normalizeRootDrop(args.drop)) throw new StudioProtocolError('INVALID_ARGUMENT', 'Invalid drop.');
		const toTimeline = frame => Math.round(frame * TIMELINE_FPS / ARDY_FPS);
		const clips = args.blocks?.length ? args.blocks.map(block => {
			if (block.endFrame <= block.startFrame) throw new StudioProtocolError('INVALID_RANGE', 'Prompt blocks must have a positive range.');
			return { id: crypto.randomUUID(), startFrame: toTimeline(block.startFrame), endFrame: toTimeline(block.endFrame), text: block.prompt };
		}) : null;
		const character = appContext.storeDomain('cast').read().find(row => row.id === args.characterId);
		const commandContext = !clips ? context : { ...context, commit: apply => context.commit(() => {
			const result = apply();
			appContext.recordAction('cast', () => appContext.storeDomain('cast').extendTimeline(Math.max(...clips.map(clip => clip.endFrame))), null, true);
			return result;
		}) };
		await loadMotion(args.url ?? args.motionUrl, args.prompt ?? entry?.recipe?.blocks?.map(block => block.prompt).join(' ') ?? domain.motionFor(args.characterId)?.prompt ?? '', character.rot,
			args.drop ?? null, args.characterId, clips, { commandContext, recipe: entry?.recipe });
	};
	appContext.updateActionPorts({ clearMotionNative: clearMotion, setCharacterIkKey, removeCharacterIkKey, clearCharacterIkKeys });
	return {
		...domain,
		ikMode, ikChains, setIkChains, ikFkJoints, setIkFkJoints, ikFocus, setIkFocus, footSnap, setFootSnap,
		bodyContact, setBodyContact, IK_CORRECTION_BLEND_FRAMES,
		ikTick, setIkTick, committedIkEdits, setCommittedIkEdits, trailFalloffS, setTrailFalloffS, showTrails,
		setShowTrails, ikEditTool, setIkEditTool, trailEdit, trailTrackFocus, selectTrailTrack, clearTrailTrackFocus, trailFalloffFrames, focusIkHandle, snapshotIkKeys,
		pendingIkEdit, applyPendingIkEdit, cancelPendingIkEdit,
		rangePinApplySpec: (pin) => {
			domain.run('motion.rangePin.apply', { characterId: appContext.shared.activeChar.id, pin });
			return { residuals: decodeRangePinResiduals(domain.layer(appContext.shared.activeChar.id).ikPinResiduals).get(pin.id) };
		},
		rangePins, rangePinResiduals, rangePinSelection, setRangePinSelection, rangePinPartPick, setRangePinPartPick, rangePinPreview, previewRangePinDraft, applyRangePinDraft, deleteRangePin,
		setCharacterIkKey, removeCharacterIkKey, clearCharacterIkKeys, motion, motionBusy,
		advanceFrame, stepFrame,
		leaveIkMode, beginPlaybackOn, loadMotion, clearMotion: () => appContext.bus.run('motion.clear', { characterId: appContext.shared.activeChar.id }), clearMotionNative: clearMotion, applyMotionTrim, resetMotionTrim, cutMotionAtPlayhead,
		changeMotionSegmentSpeed, removeMotionSegmentById, poseOtherCastMembers, toggleIkMode, ikSolve,
		ikDragEnd, ikAddKeyframe,
		ikDeleteKeyframe, ikApplyPoseAsKey, onTrailDragStart, onTrailDragPreview, onTrailDragEnd, restoreMotionRefs,
	};
}
