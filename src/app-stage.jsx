// Module-level constants, pure helpers, and standalone R3F stage components
// extracted verbatim from App.jsx. Nothing here reads App() state directly —
// everything arrives through props or module imports, which is what made the
// extraction safe. Behavior-identical by construction; verified by the build
// and the browser QA suites.
import {
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, Text, useFBX } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { ProxyFigure } from "./proxy-figure.jsx";
import { isProxyFigure } from "./scenes.js";
import { retimeMotion } from "./ardy/retime.js";
import {
	TRAIL_EFFECTOR_JOINTS,
	TRAIL_TRACKS,
	falloffWeight,
	jointTrailPoints,
	trailEditRange,
} from "./motion-trail.js";
import { pickTrailPoint } from "./trail-pick.js";
import Timeline from "./ardy/timeline.jsx";
import { FlyControls, aimAt } from "./controls.jsx";
import { GIZMO_LAYER } from "./dualview.jsx";
import {
	CURVE_GRAB_RADIUS_PX,
	curveToPoints2d,
	validateLineEdit,
} from "./line-edit.js";
import { craneHeightAt, prepareRailBend, railPoint } from "./camera-follow.js";
import { DEFAULT_SCENE_OBJECTS, SCENE_ATTACH_BONES, updateSceneObject } from "./scene-objects.js";
import { imageFilesFrom } from "./scene-assets.js";
import { splitDroppedFiles } from "./scene-mesh.js";
import {
	SCENES_QUARANTINE_KEY,
	createSceneDocument,
	DEFAULT_SUBJECT_ONE,
	DEFAULT_SUBJECT_TWO,
	loadSceneDocumentFromStorage,
} from "./scenes.js";
import ObjectGizmo from "./object-gizmo.jsx";
import { insertPathMark, MARK_GAP, MAX_PATH_LEAN, MAX_PATH_MARKS, MAX_PATH_POINTS, nearestPathFraction, pathCurve, pathMarkFractions, pathMarks, pathPointAtFraction } from "./object-path.js";
import { track } from "./analytics.js";
import { ko, isKo } from "./locale.js";
import { isPlaygroundEmbed, takePlaygroundProject } from "./playground.js";
import { applyPartColours } from "./part-colours.js";
import { POSE_BONES, applyHipsOffset, applyPose, primeBindPose, normalizeBoneName } from "./poses.js";
import { RENDER_ACTIVITY_EVENT } from "./use-render-activity.js";
import { SHOT_ASPECT_RATIOS, SUBJECT_HEIGHT_M } from "./shot.js";
import { sampleAt } from "./sample-at.js";
import { shotAtFrame } from "./cuts.js";

// Stated the way a crew states a setup: how far back, which side, how high the
// lens rides, and what glass is on it. Order matters — Medium is the setup a
// director reaches for first, so it leads.
export const PRESETS = {
	medium: { label: ko("Medium", "미디엄"), distance: 2.6, azimuth: 22, elevation: 6, fov: 45, targetY: 1.35, two: false },
	wide: { label: ko("Wide", "와이드"), distance: 7, azimuth: 25, elevation: 4, fov: 38, targetY: 1.2, two: false },
	closeup: { label: ko("Close-Up", "클로즈업"), distance: 1.3, azimuth: 16, elevation: 2, fov: 45, targetY: 1.55, two: false },
	low: { label: ko("Low Angle", "로우 앵글"), distance: 3.5, azimuth: 20, elevation: -14, fov: 50, targetY: 1.1, two: false },
	high: { label: ko("High Angle", "하이 앵글"), distance: 4.5, azimuth: 20, elevation: 16, fov: 45, targetY: 1.1, two: false },
};

export {
	RIG_HIERARCHY_FOCUS,
	HIERARCHY_INSPECTOR_TITLES,
	POSE_LABELS_KO,
	CAMERA_MOVE_LABELS_KO,
	SHOT_SIZE_LABELS_KO,
	SHOT_LEVEL_LABELS_KO,
	SCENE_RENDERER_LABELS_KO,
	SCENE_OBJECT_NAME_LABELS_KO,
	poseLabelKo,
	cameraMoveLabelKo,
	sceneRendererLabelKo,
	sceneObjectNameDisplayKo,
	viewShortKo,
	slateLineKo,
	moveSequenceSlateKo,
	hierarchyIdForIkFocus,
} from "./stage-labels-ko.js";

export * from "./stage-attach-frames.js";

export const CAPTURE_W = 1920;
export const CAPTURE_H = 1080;
export const MCP_CAPTURE_W = 640;
export const MCP_CAPTURE_H = 360;
export const MCP_CAPTURE_SAMPLE_STEP = 32;
export const SHOT_ASPECT_PRESETS = Object.freeze({
	"16:9": Object.freeze({ label: "16:9", aspect: SHOT_ASPECT_RATIOS["16:9"], width: 1920, height: 1080 }),
	"2.39:1": Object.freeze({ label: "2.39:1", aspect: SHOT_ASPECT_RATIOS["2.39:1"], width: 2390, height: 1000 }),
	"9:16": Object.freeze({ label: "9:16", aspect: SHOT_ASPECT_RATIOS["9:16"], width: 1080, height: 1920 }),
	"1:1": Object.freeze({ label: "1:1", aspect: SHOT_ASPECT_RATIOS["1:1"], width: 1080, height: 1080 }),
	"4:3": Object.freeze({ label: "4:3", aspect: SHOT_ASPECT_RATIOS["4:3"], width: 1440, height: 1080 }),
	"12:7": Object.freeze({ label: "12:7", aspect: SHOT_ASPECT_RATIOS["12:7"], width: 1536, height: 896, title: "12:7 video-inbetweener ratio" }),
	"fal 480P": Object.freeze({ label: "fal 480P", aspect: SHOT_ASPECT_RATIOS["fal 480P"], width: 1664, height: 960, title: "Fal H3 480P canvas (832x480)" }),
});
// Pre-generated clip shipped with the build so a bridge-less session (a hosted
// static demo, or `npm run dev:ui`) still shows real generated motion.
// Root-absolute on purpose: the studio is served from "/app/" while these
// public files stay at the site root, so a page-relative path would resolve
// to "/app/models/..." and 404. Vite's base is "/" (own apex domain), so a
// leading slash is now the correct — and only — form that works from both
// the dev server and the built site.
// Per-character rig model: the stage entry's `model` is the FBX file stem in
// public/models AND the wire rig name sent to ARDY, so mesh and export can
// never drift apart.
export const characterModelUrl = (model) => `/models/${model}.fbx`;

/** Shipped rig names as the operator says them, not as the files spell them. */
export const CHARACTER_MODEL_LABELS = { "y-bot-tpose": "Y Bot", "x-bot-tpose": "X Bot" };
CHARACTER_MODEL_LABELS["proxy-figure"] = ko("Capsule figure", "캡슐 인물");

/** Sequential ids for spawned characters, collision-free against the cast. */
export function nextCharacterId(list) {
	const ids = new Set(list.map((entry) => entry.id));
	let n = list.length + 1;
	let id = `char-${n}`;
	while (ids.has(id)) {
		n += 1;
		id = `char-${n}`;
	}
	return id;
}
export const DEMO_MOTION_URL = "/demo/walk-then-stop.npz";
export const DEMO_MOTION_PROMPT = "A person walks forward.";
// How long a deletion keeps offering its one-press Undo. Both toasts use the
// same window so the two deletion paths feel like one rule.
export const OBJECT_DELETE_UNDO_MS = 7000;
export const ASSET_DELETE_UNDO_MS = 7000;
// Neutral grey clay: the set is the grey workbench, so the figures are grey
// too, light enough to stand off the deck and the sky.
export const CLAY = "#bdbec3";
export const CLAY_B = "#a4a5aa";
// X Bot's shell is smooth (no raised exoskeleton like Y Bot's), so it gets a
// brighter, whiter clay to keep it readable against the set.
export const CLAY_X = "#d0d0d4";
// Model/role default for a cast member; a user-picked entry.tint always wins
// over this at render time.
export const defaultCharacterTint = (entry, index) => (entry.model === "x-bot-tpose" ? CLAY_X : index === 0 ? CLAY : CLAY_B);

/**
 * The first editor view should read like a blocking desk, not a security
 * camera at the back of the stage. Keep the selected subject large enough to
 * judge a pose while leaving a little floor around the feet. This is a pure
 * framing helper so the seed and any future reset action share the same
 * distance rule.
 */
export function editorFrameForSubject(subject) {
	const scale = Number.isFinite(subject?.scale) && subject.scale > 0 ? subject.scale : 1;
	const distance = THREE.MathUtils.clamp(3.5 / scale, 2.8, 4.8);
	const x = subject?.x ?? 0;
	const z = subject?.z ?? 0;
	const target = { x, y: 1.05, z };
	return {
		target,
		position: {
			x: x + distance * 0.62,
			y: target.y + distance * 0.34,
			z: z + distance * 0.78,
		},
	};
}

export const DEFAULT_SUBJECT = DEFAULT_SUBJECT_ONE;
export const DEFAULT_SUBJECT2 = DEFAULT_SUBJECT_TWO;
export const DEFAULT_ENVIRONMENT = "a sunlit modern living room";
export const DEFAULT_CAMERA_POSITION = { x: 0.97, y: 1.62, z: 2.39 };
export const REST_BONES = Object.fromEntries(POSE_BONES.map((b) => [b.id, [0, 0, 0]]));
export {
	TIMELINE_FPS,
	ARDY_FPS,
	toArdyFrame,
	posePlacementFrame,
	toArdyFrameEntries,
	toArdySegments,
	DEFAULT_DURATION_S,
	DEFAULT_PLAYBACK_SPEED,
	BRIDGE_RECHECK_MS,
	ARDY_PROMPT_HORIZON_FRAMES,
	MAX_WAYPOINTS,
	ARDY_PROMPT_MAX,
	ARDY_DURATION_MIN,
	ARDY_DURATION_MAX,
	ARDY_SEED_MAX,
	ARDY_PRESERVE_DEFAULT,
	DEFAULT_PROMPT_CLIPS,
	buildPromptSchedule,
	ikTracksInRange,
	PRESERVE_TRACK_LIMBS,
	PRESERVE_LIMB_ORDER,
	preserveLimbLabel,
	preserveTracksSummary,
	LINE_EDIT_TRACK_OPTIONS,
	lineTrackLabel,
	LINE_EDIT_DEFAULT_TRACK,
	LINE_CURVE_MARKER_STRIDE,
	MIN_CURVE_POINTS,
	LINE_PREVIEW_DEBOUNCE_MS,
	LINE_CAPABILITY_RETRY_MS,
	LINE_EDIT_REFUSALS,
	LINE_CURVE_REFUSALS,
	MULTIMODEL_REASONS,
	MULTIMODEL_SAMPLE_FPS,
} from "./ardy-bridge-contract.js";

/* ------------------------------------------------------------------ 3D --- */

// Memoized: unchanged cast members skip re-rendering on every playhead tick.
export const Character = memo(function Character(props) {
	return isProxyFigure(props) ? <ProxyFigure {...props} /> : <RiggedCharacter {...props} />;
});

const RiggedCharacter = memo(function RiggedCharacter({ url, position, rot, tint, pose, scale = 1, onRig, pickId, partColoursEnabled = false, partColoursMode = "shaded" }) {
	const fbx = useFBX(url);
	const model = useMemo(() => {
		const clone = SkeletonUtils.clone(fbx);
		// Mixamo exports centimetres; `scale` is the FILMED person's stature.
		// THE INVARIANT: extraction divided this take's root travel by that
		// stature, so the clip and the scale must travel together — apply one
		// without the other and every stride overshoots by the same factor and
		// the feet skate. It belongs HERE, on the world transform, and never
		// inside rig space: playback.js derives prep.scale from the bind pose,
		// so a scaled bone hierarchy would be measured as a different rig.
		clone.scale.setScalar(0.01 * scale);
		// The joint shells (Alpha_Joints / Beta_Joints — elbows, knees, the
		// exoskeleton bands) render in a darkened shade of the body tint so
		// the segments read as separate pieces.
		// The shipped clay is intentionally pale, but the stage deck is pale too.
		// Lift neither with emissive nor a second light; a small value drop keeps
		// the same authored hue while restoring silhouette contrast in the editor.
		const bodyTint = new THREE.Color(tint).multiplyScalar(0.9);
		const jointTint = bodyTint.clone().multiplyScalar(0.62);
		clone.traverse((child) => {
			if (child.isMesh) {
				// warm clay reads as a maquette; cold grey reads as a broken render
				child.material = new THREE.MeshStandardMaterial({
					color: /_Joints$/i.test(child.name) ? jointTint : bodyTint,
					// A slightly tighter highlight gives the clay enough form to read
					// at blocking distance without turning it into shiny plastic.
					roughness: 0.66,
					metalness: 0,
					envMapIntensity: 0.35,
				});
				child.frustumCulled = false;
				// The subject's own shadow is what plants it on the deck; a blocking
				// frame without one leaves the figure floating over flat colour.
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});
		if (partColoursEnabled) applyPartColours(clone, partColoursMode);
		// Stamp the bind pose while the rig is still untouched: the pose effect
		// below runs immediately after and would otherwise be baked into "rest".
		primeBindPose(clone);
		return clone;
	}, [fbx, tint, partColoursEnabled, partColoursMode]);

	// A new stature (a fresh extraction on this character) must not rebuild the
	// clone — that would drop the rig the playback effects hold. Only the world
	// transform moves; the same invariant as above applies.
	useEffect(() => {
		model.scale.setScalar(0.01 * scale);
	}, [model, scale]);

	useEffect(() => {
		// During playback the pose prop is null and the motion drives the rig;
		// this effect can flush AFTER the playback effect in a later commit
		// (measured: playback at t, pose reset at t+1.8ms), and resetting to
		// REST then would clobber the animation back to the bind pose. So a
		// null pose means "playback owns the rig" — do not touch it.
		if (!pose) return;
		// every joint is reset first, otherwise switching presets leaves stale limbs
		applyPose(model, { ...REST_BONES, ...pose.bones });
		// A measured pose (photo, bottled take frame) carries its hips height;
		// rotations alone would leave a crouch floating at standing height.
		applyHipsOffset(model, pose.rootY ?? 0);
	}, [model, pose]);

	const onRigRef = useRef(onRig);
	onRigRef.current = onRig;
	// Report on MODEL change only — a per-render callback identity change
	// must not re-run this effect.
	useEffect(() => {
		onRigRef.current?.(model);
	}, [model]);

	return (
		// characterPick makes the body a first-class click target: the Scene
		// picker walks up from any hit mesh, finds the tag, and routes the
		// selection to the hierarchy so the Inspector owns the controls.
		<group position={position} rotation={[0, (rot * Math.PI) / 180, 0]} userData={pickId ? { characterPick: pickId } : undefined}>
			<primitive object={model} />
		</group>
	);
});

/** Selection marker for the picked cast member: a Unity-style XYZ tripod
 * plus a ground ring at the feet. X/Z arrows also drag the character on the
 * floor (Y is display-only — characters stand on the deck). */
export function ShotRig({ preset, nonce, fovDeg, charA, charB, showB, probeX, probeZ, camRef, look, onMetrics, appliedPresetRef, lastPosRef }) {
	useEffect(() => {
		const cam = camRef.current;
		if (!cam) return;
		// A preset is applied once per (preset, nonce), not once per mount. The
		// Canvas has no Suspense boundary of its own, so a cast member whose FBX
		// is still downloading suspends the whole scene graph; when it resolves,
		// React remounts the siblings — this rig included, on a fresh camera
		// object — and a per-mount seed would snap the shot back to the preset,
		// discarding a frame_shot or a manual move that landed in the meantime
		// (#86 on slow CI runners). Both refs live in App so they survive the
		// remount: the stamp says whether this preset was already applied, the
		// position ref (with look.current) says where the camera last was.
		const stamp = `${preset}:${nonce}`;
		if (appliedPresetRef && appliedPresetRef.current === stamp && lastPosRef?.current) {
			const last = lastPosRef.current;
			cam.position.set(last.x, last.y, last.z);
			cam.rotation.order = "YXZ";
			cam.rotation.set(look.current.pitch, look.current.yaw, 0);
			return;
		}
		if (appliedPresetRef) appliedPresetRef.current = stamp;
		const p = PRESETS[preset];
		const az = (p.azimuth * Math.PI) / 180;
		const el = (p.elevation * Math.PI) / 180;
		const aim =
			p.aimMid && showB ? { x: (charA.x + charB.x) / 2, z: (charA.z + charB.z) / 2 } : { x: charA.x, z: charA.z };
		const horizontal = p.distance * Math.cos(el);
		cam.position.set(
			aim.x + horizontal * Math.sin(az),
			p.height ?? Math.max(p.targetY + p.distance * Math.sin(el), 0.15),
			aim.z + horizontal * Math.cos(az),
		);
		const angles = aimAt(cam.position, { x: aim.x, y: p.targetY, z: aim.z });
		look.current.yaw = angles.yaw;
		look.current.pitch = angles.pitch;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [preset, nonce]);


	useEffect(() => {
		const cam = camRef.current;
		if (!cam) return;
		cam.fov = fovDeg;
		cam.updateProjectionMatrix();
	}, [fovDeg, camRef]);

	// A blocking tool must not claim a framing it is not holding, so the subject's
	// feet and eyes are projected into the frame every tick.
	const probe = useRef(new THREE.Vector3());
	const lastMetrics = useRef({ x: NaN, y: NaN, z: NaN, visible: null });
	useFrame(() => {
		const cam = camRef.current;
		if (!cam) return;
		let visible = false;
		for (const y of [0.1, SUBJECT_HEIGHT_M * 0.94]) {
			// During motion playback the probe follows the played root, so the
			// "subject out of frame" caption stays honest.
			probe.current.set(probeX ?? charA.x, y, probeZ ?? charA.z).project(cam);
			if (probe.current.z < 1 && Math.abs(probe.current.x) <= 1 && Math.abs(probe.current.y) <= 1) visible = true;
		}
		const previous = lastMetrics.current;
		if (
			Math.abs(previous.x - cam.position.x) +
				Math.abs(previous.y - cam.position.y) +
				Math.abs(previous.z - cam.position.z) >
				1e-4 ||
			previous.visible !== visible
		) {
			lastMetrics.current = {
				x: cam.position.x,
				y: cam.position.y,
				z: cam.position.z,
				visible,
			};
			onMetrics(cam.position, visible);
		}
	});

	return null;
}

/** Plays an authored A→B camera move by driving the shot camera exactly the
    way a fly-drag does — position on the camera, orientation through the look
    ref — so ShotRig's metrics, the slate, and the inset all stay honest for
    free. A right-drag interrupts the dolly: the user always outranks it.

    Two frame sources can drive the move. Standalone preview advances authored
    frames at production cadence; follow mode reads the timeline playhead, so the camera and
    the character motion are two views of the same time axis — playing or
    scrubbing frame 72 at 24 fps puts the camera exactly 3 s into its move.

    frameRef is the imperative playhead routed props and riders already read in
    their own useFrame. The followFrame prop reaches this Canvas subtree one
    commit later, so alone it would pose the camera a paint behind them. */
export function MoveRig({ playing, following, followFrame, frameRef, fps, keys, shots, scene, camRef, look, isInterrupted, onDone }) {
	const invalidate = useThree((state) => state.invalidate);
	const preview = useRef({ frame: 0, finished: false, notified: false });
	const handlers = useRef({ isInterrupted, onDone });
	handlers.current = { isInterrupted, onDone };
	// The follow branch only re-applies when its time changes; in demand mode
	// each apply needs one more frame so ShotRig's metrics see the new pose.
	const appliedFrame = useRef(null);
	useEffect(() => {
		// Arming or reshaping the move must schedule a frame by hand: this
		// component owns no three objects, so in demand mode nothing else will.
		appliedFrame.current = null;
		if (following) invalidate();
	}, [keys, shots, scene, fps, following, invalidate]);
	useEffect(() => {
		// A paused scrub changes the playhead without starting the render loop.
		if (following && !playing) invalidate();
	}, [followFrame, following, playing, invalidate]);
	useEffect(() => {
		if (!playing || keys.length < 1) return undefined;
		const firstFrame = keys[0].frame;
		const lastFrame = keys[keys.length - 1].frame;
		const spanFrames = Math.max(lastFrame - firstFrame, 1);
		const spanSeconds = Math.max(spanFrames / Math.max(fps, 1), 0.1);
		const tickMs = (spanSeconds * 1000) / spanFrames;
		let tick = 0;
		preview.current = { frame: firstFrame, finished: false, notified: false };
		invalidate();
		const timer = window.setInterval(() => {
			if (preview.current.finished) return;
			if (handlers.current.isInterrupted?.()) {
				preview.current.finished = true;
				invalidate();
				return;
			}
			tick += 1;
			preview.current = {
				frame: firstFrame + (lastFrame - firstFrame) * Math.min(tick / spanFrames, 1),
				finished: tick >= spanFrames,
				notified: false,
			};
			invalidate();
		}, tickMs);
		return () => window.clearInterval(timer);
	}, [playing, keys, fps, invalidate]);
	useFrame(() => {
		if ((playing && keys.length < 1) || (!playing && following && !shots.some((shot) => shot.cameraKeys.length))) return;
		const cam = camRef.current;
		if (!cam) return;
		const apply = (frame) => {
			// Timeline/PlayView sampling follows the editorial strips. Standalone
			// preview stays scoped to the selected strip's keys. Entering a Shot
			// applies its authored camera immediately (a hard cut). Leaving into a
			// gap returns null and deliberately applies nothing: the last physical
			// camera pose stays put and FlyControls regain ownership, so we do not
			// invent a second cut to an arbitrary "free camera" preset.
			const timelineShot = following ? shotAtFrame(shots, frame) : null;
			const sampledShot = timelineShot
				? { ...timelineShot, camera: { mode: "keys" } }
				: following ? null : { camera: { mode: "keys" }, cameraKeys: keys };
			const f = sampleAt(scene, sampledShot, frame).camera;
			if (!f) return null;
			cam.position.set(f.pos.x, f.pos.y, f.pos.z);
			look.current.yaw = f.yaw;
			look.current.pitch = f.pitch;
			if (Math.abs(cam.fov - f.fovDeg) > 1e-3) {
				cam.fov = f.fovDeg;
				cam.updateProjectionMatrix();
			}
			return f;
		};
		if (playing) {
			const f = apply(preview.current.frame);
			if (preview.current.finished && !preview.current.notified) {
				preview.current.notified = true;
				handlers.current.onDone(f ? f.fovDeg : cam.fov);
			}
			return;
		}
		if (!following) return;
		if (isInterrupted?.()) return; // manual viewport framing owns the paused camera
		const frame = frameRef?.current ?? followFrame;
		if (appliedFrame.current === frame) return;
		appliedFrame.current = frame;
		apply(frame);
		invalidate();
	});
	return null;
}

/**
 * Applies the precomputed follow-camera track to the shot camera. The track
 * is derived offline from the subject trajectory (camera-follow.js), so this
 * rig only samples it at the playhead — scrub, play, PlayView and Record all
 * replay the identical deterministic move. Null-rendering, so every apply
 * must invalidate() by hand in demand mode, like MoveRig. Like MoveRig it
 * prefers frameRef over the frame prop so the camera lands in the same paint
 * as the routed props and riders it follows.
 */
export function FollowCamRig({ enabled, frame, frameRef, scene, shot, camRef, look, isInterrupted }) {
	const invalidate = useThree((state) => state.invalidate);
	const applied = useRef(null);
	useEffect(() => {
		applied.current = null;
		if (enabled) invalidate();
	}, [scene, shot, enabled, invalidate]);
	useEffect(() => {
		if (enabled) invalidate();
	}, [frame, enabled, invalidate]);
	useFrame(() => {
		if (!enabled) return;
		if (isInterrupted?.()) return; // the user is flying; yield until released
		const cam = camRef.current;
		if (!cam) return;
		const playhead = frameRef?.current ?? frame;
		const sample = sampleAt(scene, shot, playhead).camera;
		if (!sample || applied.current === playhead) return;
		applied.current = playhead;
		cam.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
		look.current.yaw = sample.yaw;
		look.current.pitch = sample.pitch;
		invalidate();
	});
	return null;
}

/**
 * Applies the shot camera's yaw/pitch from its look ref every frame. Before
 * the camera split, FlyControls owned the shot camera and performed this
 * apply as a side effect of flying; with the fly controls bound to the
 * editor camera, the recording camera still needs its aim (ShotRig, follow,
 * frame-selection) reflected in its actual rotation — the preview and the
 * capture read the camera object, not the ref.
 */
export function ShotLookApplier({ camRef, look }) {
	useFrame(() => {
		const cam = camRef.current;
		if (!cam) return;
		if (cam.rotation.order !== "YXZ") cam.rotation.order = "YXZ";
		if (cam.rotation.x !== look.current.pitch || cam.rotation.y !== look.current.yaw || cam.rotation.z !== 0) {
			cam.rotation.set(look.current.pitch, look.current.yaw, 0);
		}
	});
	return null;
}

/**
 * Seeds the editor camera once, inside the Canvas root — App-level effects
 * run before R3F mounts its children, so the ref is still null there. The
 * seed frames both the subject and the shot camera: the first editor frame
 * must read as "the set with the camera in it".
 */
/**
 * A short editor-camera glide: 260 ms ease toward a target orientation (and
 * optionally a position), instead of the teleport that made "look at the
 * light" and F-framing feel like a cut. Any user press cancels it — the
 * operator always outranks the tour guide.
 */
export function CameraGlide({ glide, camRef, lookRef, onDone }) {
	const { gl } = useThree();
	const invalidate = useThree((state) => state.invalidate);
	const animRef = useRef(null);
	useEffect(() => {
		if (!glide) {
			animRef.current = null;
			return undefined;
		}
		const cam = camRef.current;
		if (!cam) return undefined;
		const fromPos = cam.position.clone();
		const toPos = glide.position ? new THREE.Vector3(glide.position.x, glide.position.y, glide.position.z) : fromPos.clone();
		const angles = aimAt(toPos, glide.target);
		const from = { yaw: lookRef.current.yaw, pitch: lookRef.current.pitch };
		let dYaw = angles.yaw - from.yaw;
		while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
		while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
		// elapsed accumulates render-loop deltas: the glide needs no wall clock
		animRef.current = { fromPos, toPos, from, dYaw, dPitch: angles.pitch - from.pitch, elapsed: 0 };
		const cancel = () => {
			animRef.current = null;
			onDone?.();
		};
		gl.domElement.addEventListener("pointerdown", cancel, true);
		invalidate();
		return () => gl.domElement.removeEventListener("pointerdown", cancel, true);
		// camRef/lookRef are stable refs; onDone identity is per-glide noise
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [glide, gl, invalidate]);
	useFrame((_, delta) => {
		const anim = animRef.current;
		const cam = camRef.current;
		if (!anim || !cam) return;
		anim.elapsed += Math.min(delta, 0.1) * 1000;
		const t = Math.min(1, anim.elapsed / 260);
		const eased = 1 - (1 - t) ** 3;
		cam.position.lerpVectors(anim.fromPos, anim.toPos, eased);
		const yaw = anim.from.yaw + anim.dYaw * eased;
		const pitch = anim.from.pitch + anim.dPitch * eased;
		lookRef.current = { yaw, pitch };
		cam.rotation.order = "YXZ";
		cam.rotation.set(pitch, yaw, 0);
		if (t >= 1) {
			animRef.current = null;
			onDone?.();
		} else {
			invalidate();
		}
	});
	return null;
}

export function EditorCamSeed({ camRef, lookRef, shotCamRef, subject }) {
	const seeded = useRef(false);
	const invalidate = useThree((state) => state.invalidate);
	useEffect(() => {
		if (seeded.current) return;
		const cam = camRef.current;
		if (!cam) return;
		seeded.current = true;
		// The selected character owns the first read. The shot camera remains a
		// useful reference in the inset; mixing its position into this seed pushed
		// the editor eye several metres back and made the mannequin look tiny.
		const frame = editorFrameForSubject(subject);
		const { target, position } = frame;
		cam.position.set(position.x, position.y, position.z);
		const angles = aimAt(cam.position, target);
		lookRef.current = { yaw: angles.yaw, pitch: angles.pitch };
		cam.rotation.order = "YXZ";
		cam.rotation.set(angles.pitch, angles.yaw, 0);
		invalidate();
	});
	return null;
}

/**
 * The key light drawn as a grabbable sun in the editor view: a warm core with
 * rays, on GIZMO_LAYER so preview, capture and PlayView never see it. A line
 * drops to the floor so its height reads against the stage, like the crane's.
 * The sun's own body is the drag surface — a grab moves it freely on the
 * camera-facing plane (the cursor and the sun stay glued), and the gizmo's
 * arrows (via ObjectGizmo) stay available for single-axis precision. Its
 * colour follows the dial, and while selected a ray points at the stage so
 * the light's direction reads at a glance.
 */
export function KeyLightPuck({ keyLight, selected, visible, paneRef, camRef, onSelect, onChange, onDragEnd }) {
	const { gl } = useThree();
	const groupRef = useRef(null);
	const dragRef = useRef(null);
	const stateRef = useRef(null);
	const [dragKind, setDragKind] = useState(null);
	const invalidate = useThree((state) => state.invalidate);
	stateRef.current = { keyLight, visible, onSelect, onChange, onDragEnd };
	useEffect(() => {
		groupRef.current?.traverse((node) => node.layers?.set(GIZMO_LAYER));
		invalidate();
	}, [visible, selected, keyLight, dragKind, invalidate]);
	useEffect(() => {
		if (!visible) return undefined;
		const raycaster = new THREE.Raycaster();
		raycaster.layers.set(GIZMO_LAYER);
		const rayFrom = (event) => {
			const pane = paneRef.current;
			const camera = camRef.current;
			if (!pane || !camera) return null;
			const bounds = pane.getBoundingClientRect();
			if (bounds.width < 2 || bounds.height < 2) return null;
			const ndc = new THREE.Vector2(
				((event.clientX - bounds.left) / bounds.width) * 2 - 1,
				-((event.clientY - bounds.top) / bounds.height) * 2 + 1,
			);
			if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
			camera.updateMatrixWorld();
			raycaster.setFromCamera(ndc, camera);
			return raycaster;
		};
		const onDown = (event) => {
			const s = stateRef.current;
			if (event.button !== 0 || event.altKey) return;
			if (!groupRef.current || !rayFrom(event)) return;
			const hit = raycaster.intersectObjects(groupRef.current.children, true)
				.find((entry) => {
					for (let node = entry.object; node; node = node.parent) if (node.userData?.keyLightPick) return true;
					return false;
				});
			if (!hit) return;
			event.stopImmediatePropagation();
			event.preventDefault();
			s.onSelect?.();
			const start = { ...s.keyLight };
			const origin = new THREE.Vector3(start.x, start.y, start.z);
			// free move on the camera-facing plane through the sun: the cursor
			// and the sun stay glued from any viewing angle — no degenerate
			// floor-plane geometry when the sun is viewed from below
			const facing = new THREE.Vector3();
			camRef.current.getWorldDirection(facing);
			const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, origin);
			const hitStart = new THREE.Vector3();
			if (!raycaster.ray.intersectPlane(plane, hitStart)) return;
			dragRef.current = { start, plane, hitStart, moved: false };
			setDragKind("move");
			invalidate();
		};
		const onMove = (event) => {
			const drag = dragRef.current;
			if (!drag || !rayFrom(event)) return;
			const world = new THREE.Vector3();
			if (!raycaster.ray.intersectPlane(drag.plane, world)) return;
			drag.moved = true;
			stateRef.current.onChange?.({
				x: drag.start.x + (world.x - drag.hitStart.x),
				y: drag.start.y + (world.y - drag.hitStart.y),
				z: drag.start.z + (world.z - drag.hitStart.z),
			}, { dragging: true });
			invalidate();
		};
		const onUp = () => {
			const drag = dragRef.current;
			if (!drag) return;
			dragRef.current = null;
			setDragKind(null);
			if (drag.moved) stateRef.current.onDragEnd?.();
			invalidate();
		};
		const el = gl.domElement;
		el.addEventListener("pointerdown", onDown);
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp, true);
		return () => {
			el.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp, true);
		};
		// paneRef/camRef are stable refs; handlers read live state through stateRef
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible, gl, invalidate]);
	const drop = useMemo(() => new Float32Array([0, 0, 0, 0, -keyLight.y, 0]), [keyLight.y]);
	// the sun dims with its own dial, so the stage's mood reads off the puck
	const glow = Math.max(0.18, Math.min(1, keyLight.intensity / 1.12));
	const sunColor = useMemo(
		() => new THREE.Color("#5c5040").lerp(new THREE.Color(selected ? "#ffcf5e" : "#f2b544"), glow).getStyle(),
		[selected, glow],
	);
	if (!visible) return null;
	return (
		<group ref={groupRef} position={[keyLight.x, keyLight.y, keyLight.z]}>
			<mesh userData={{ keyLightPick: true }}>
				<sphereGeometry args={[0.16, 20, 16]} />
				<meshBasicMaterial color={sunColor} toneMapped={false} />
			</mesh>
			{/* rays: eight short spokes so it reads as a sun, not a ball */}
			{Array.from({ length: 8 }, (_, i) => {
				const angle = (i / 8) * Math.PI * 2;
				return (
					<mesh key={i} userData={{ keyLightPick: true }} position={[Math.cos(angle) * 0.27, Math.sin(angle) * 0.27, 0]} rotation={[0, 0, angle + Math.PI / 2]}>
						<cylinderGeometry args={[0.014, 0.014, 0.1, 6]} />
						<meshBasicMaterial color={sunColor} toneMapped={false} />
					</mesh>
				);
			})}
			{/* the real grab surface: generous, invisible, around the whole sun */}
			<mesh userData={{ keyLightPick: true }}>
				<sphereGeometry args={[0.42, 12, 10]} />
				<meshBasicMaterial visible={false} />
			</mesh>
			<lineSegments>
				<bufferGeometry>
					<bufferAttribute attach="attributes-position" array={drop} count={2} itemSize={3} />
				</bufferGeometry>
				<lineBasicMaterial color="#f2b544" transparent opacity={selected ? 0.6 : 0.25} />
			</lineSegments>
			{/* where the light points: a dashed ray toward the stage centre */}
			{selected && (
				<Line
					points={[[0, 0, 0], [-keyLight.x * 0.86, -keyLight.y * 0.86, -keyLight.z * 0.86]]}
					color="#ffb454"
					lineWidth={1.6}
					dashed
					dashSize={0.32}
					gapSize={0.22}
					transparent
					opacity={0.45}
				/>
			)}
			{/* live readout while the sun is being dragged */}
			{dragKind && (
				<GizmoLabel
					position={[0, 0.5, 0]}
					text={`x ${keyLight.x.toFixed(1)}  y ${keyLight.y.toFixed(1)}  z ${keyLight.z.toFixed(1)}`}
					camRef={camRef}
				/>
			)}
		</group>
	);
}

/**
 * The shot camera drawn as an object in the editor view: a body and a short
 * frustum wireframe on GIZMO_LAYER, synced from the live camera every frame.
 * Preview, capture and PlayView draws all drop GIZMO_LAYER, so the ghost can
 * never reach a recorded frame.
 */
export function ShotCameraGhost({ camRef, fovDeg, aspect, visible, selected }) {
	const groupRef = useRef(null);
	const invalidate = useThree((state) => state.invalidate);
	const frustum = useMemo(() => {
		const depth = 0.62;
		const h = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * depth;
		const w = h * aspect;
		const corners = [[-w, h], [w, h], [w, -h], [-w, -h]];
		const points = [];
		for (const [x, y] of corners) points.push(0, 0, 0, x, y, -depth);
		for (let i = 0; i < 4; i++) {
			const [ax, ay] = corners[i];
			const [bx, by] = corners[(i + 1) % 4];
			points.push(ax, ay, -depth, bx, by, -depth);
		}
		return new Float32Array(points);
	}, [fovDeg, aspect]);
	useEffect(() => {
		groupRef.current?.traverse((node) => node.layers?.set(GIZMO_LAYER));
		invalidate();
	}, [visible, frustum, selected, invalidate]);
	useFrame(() => {
		const cam = camRef.current;
		const group = groupRef.current;
		if (!cam || !group) return;
		group.position.copy(cam.position);
		group.quaternion.copy(cam.quaternion);
	});
	if (!visible) return null;
	return (
		<group ref={groupRef}>
			<mesh userData={{ shotCameraPick: true }} position={[0, 0, 0.06]}>
				<boxGeometry args={[0.15, 0.11, 0.2]} />
				<meshBasicMaterial color={selected ? "#ffb454" : "#3b6ea5"} />
			</mesh>
			{/* the lens: a short cone opening toward the view direction */}
			<mesh userData={{ shotCameraPick: true }} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.075]}>
				<coneGeometry args={[0.052, 0.09, 20, 1, true]} />
				<meshBasicMaterial color={selected ? "#e09a3e" : "#2f5a8a"} side={THREE.DoubleSide} />
			</mesh>
			<lineSegments key={`${fovDeg}:${aspect}`}>
				<bufferGeometry>
					<bufferAttribute attach="attributes-position" array={frustum} count={frustum.length / 3} itemSize={3} />
				</bufferGeometry>
				<lineBasicMaterial color={selected ? "#ffb454" : "#6f9cc9"} transparent opacity={0.85} />
			</lineSegments>
		</group>
	);
}

export function RenderLoopController({ stageRef }) {
	const frameloop = useThree((state) => state.frameloop);
	const setFrameloop = useThree((state) => state.setFrameloop);
	const invalidate = useThree((state) => state.invalidate);
	useEffect(() => {
		const apply = (next) => {
			setFrameloop(next ? "always" : "demand");
			if (next) invalidate();
		};
		const onActivity = (event) => apply(event.detail);
		window.addEventListener(RENDER_ACTIVITY_EVENT, onActivity);
		return () => window.removeEventListener(RENDER_ACTIVITY_EVENT, onActivity);
	}, [invalidate, setFrameloop]);
	useEffect(() => {
		if (stageRef.current) stageRef.current.dataset.actualRenderLoop = frameloop;
	}, [frameloop, stageRef]);
	return null;
}

/** GPU resets — sleep/wake, a driver restart, VRAM pressure from an export —
 * kill the WebGL context, and without listeners the stage goes black and
 * stays black with no message. preventDefault on webglcontextlost is the
 * documented opt-in for browser-driven restoration; on restore, kick the
 * demand loop so the first frame actually paints. */
export function ContextLossGuard({ onLostChange }) {
	const gl = useThree((state) => state.gl);
	const invalidate = useThree((state) => state.invalidate);
	useEffect(() => {
		const canvas = gl.domElement;
		const onLost = (event) => {
			event.preventDefault();
			onLostChange(true);
		};
		const onRestored = () => {
			onLostChange(false);
			invalidate();
		};
		canvas.addEventListener("webglcontextlost", onLost);
		canvas.addEventListener("webglcontextrestored", onRestored);
		return () => {
			canvas.removeEventListener("webglcontextlost", onLost);
			canvas.removeEventListener("webglcontextrestored", onRestored);
		};
	}, [gl, invalidate, onLostChange]);
	return null;
}

export function ViewportLayoutInvalidator({ insetX, insetY, insetWidth, insetHeight, hierarchyWidth, sidebarWidth, timelineHeight, planZoom }) {
	const invalidate = useThree((state) => state.invalidate);
	useEffect(() => {
		// The pane frame is regular DOM while its picture is a scissored WebGL
		// viewport. In demand mode a drag can commit its final DOM position just
		// after the continuous loop stops, leaving the picture at the previous
		// coordinates. Redraw now and once more after layout has settled.
		invalidate();
		const frame = requestAnimationFrame(invalidate);
		return () => cancelAnimationFrame(frame);
	}, [invalidate, insetX, insetY, insetWidth, insetHeight, hierarchyWidth, sidebarWidth, timelineHeight, planZoom]);
	return null;
}

/** The authored root path on the set floor while path editing is on: numbered
    pins connected in walk order. Lives on the gizmo layer, so the shot camera
    shows it but exports never do (the bird's-eye board draws its own copy). */
/**
 * The drawn camera rail in the 3D Scene view: editor furniture on the gizmo
 * layer, so PlayView, the ink prepass and exports never see it.
 */
export function CameraRailScenePreview({ points, cumLen, length, crane }) {
	const rootRef = useRef(null);
	const lines = useMemo(() => {
		if (!points || points.length < 2) return null;
		const floor = points.map((point) => [point.x, 0.03, point.z]);
		// A craned rail shows WHERE THE LENS RIDES: the same path lifted along
		// the crane's start→end heights by arc progress, with the floor line
		// kept as the track's ground projection.
		const lifted = crane && cumLen && length > 1e-9
			? points.map((point, i) => [point.x, craneHeightAt(crane, cumLen[i] / length), point.z])
			: null;
		return { floor, lifted };
	}, [points, cumLen, length, crane]);
	useEffect(() => {
		rootRef.current?.traverse((node) => node.layers.set(GIZMO_LAYER));
	});
	if (!lines) return null;
	// drei's Line renders screen-space fat lines: a WebGL <line> is always
	// 1px, which reads as a hairline on dense displays.
	return (
		<group ref={rootRef}>
			<Line points={lines.floor} color="#a78bfa" lineWidth={2} transparent opacity={lines.lifted ? 0.35 : 0.8} depthWrite={false} />
			{lines.lifted && (
				<Line points={lines.lifted} color="#a78bfa" lineWidth={2.5} transparent opacity={0.9} depthWrite={false} />
			)}
		</group>
	);
}


/**
 * The crane's height marks as grabbable dots on the lifted curve. Click a
 * dot to select it; the selected dot grows a 3-axis gizmo — Y sets the
 * mark's height, X/Z bend the camera path itself by moving the drawn rail
 * control point nearest the mark. A free drag on the dot rides a
 * camera-facing vertical plane (height, plus arc slide for interior marks),
 * Shift-drag slides along the arc at a fixed height, double-click the curve
 * adds a mark and Delete removes a non-endpoint. Dots live on GIZMO_LAYER, so the
 * recording never sees them.
 */
export const CRANE_AXES = [
	{ axis: "x", dir: new THREE.Vector3(1, 0, 0), color: "#ff5340" },
	{ axis: "y", dir: new THREE.Vector3(0, 1, 0), color: "#54e05c" },
	{ axis: "z", dir: new THREE.Vector3(0, 0, 1), color: "#3d8bff" },
];
export const CRANE_ARROW_LEN = 0.5;
export const CRANE_GIZMO_SCALE = 0.16; // metres of gizmo per metre of camera distance

// The rail-bend preparation is shared with the Top-View board and lives with the
// rest of the rail math.
export { prepareRailBend };

/**
 * A floating readout beside a drag — billboarded, sized to the screen, on
 * GIZMO_LAYER so it is editor furniture the recording never sees.
 */
export function GizmoLabel({ position, text, camRef }) {
	const ref = useRef(null);
	useFrame(() => {
		const cam = camRef?.current;
		const node = ref.current;
		if (!cam || !node) return;
		node.quaternion.copy(cam.getWorldQuaternion(new THREE.Quaternion()));
		const world = node.getWorldPosition(new THREE.Vector3());
		node.scale.setScalar(Math.max(0.4, cam.getWorldPosition(new THREE.Vector3()).distanceTo(world) * 0.11));
		node.traverse((child) => child.layers?.set(GIZMO_LAYER));
	});
	return (
		<Text
			ref={ref}
			position={position}
			fontSize={0.19}
			color="#ffd27a"
			outlineWidth={0.014}
			outlineColor="#241a05"
			anchorX="center"
			anchorY="bottom"
			renderOrder={1000}
			material-depthTest={false}
			material-transparent
		>
			{text}
		</Text>
	);
}

// How near (screen pixels) a press must be to the drawn route to count as
// aimed at it — the line is thin, so the target is a generous band around it.
const PATH_LINE_PICK_PX = 14;
// A mark never sits closer than this to its neighbours (fraction of the route),
// a little over the schema's own gap so a slide never lands on the edge of it.
const PATH_MARK_CLEARANCE = MARK_GAP + 0.01;
// The selected dot's lean rings, in the travel frame (Y up, Z forward): bank
// spins about forward — a torus lies in XY, so its axis is already Z — and
// pitch about the lateral axis, the same torus turned onto YZ. The rotate tool
// (E) shows them in place of the move arrows, exactly as the object gizmo does.
const PATH_RING_R = 0.42;
const PATH_RINGS = [
	{ key: "bank", color: "#ffb454", rotation: [0, 0, 0] },
	{ key: "pitch", color: "#7cc7ff", rotation: [0, Math.PI / 2, 0] },
];
const wrapDeg = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** A world point in the pane's client pixels, or null behind the camera. */
function paneProject(world, pane, camera) {
	if (!pane || !camera) return null;
	const bounds = pane.getBoundingClientRect();
	const projected = new THREE.Vector3(world.x, world.y ?? 0, world.z).project(camera);
	return projected.z > 1 ? null : {
		x: bounds.left + ((projected.x + 1) / 2) * bounds.width,
		y: bounds.top + ((1 - projected.y) / 2) * bounds.height,
	};
}

/**
 * A scene object's travel path in the 3D view, edited the way the camera rail
 * is (CraneHandles): the route is a dense curve, and a few MARKS ride on it —
 * the two ends, plus any added by double-clicking the line. Pressing a mark
 * selects it and drags it freely (the curve bends around it, fading out by the
 * neighbouring marks, so the marks beside it stay put); Shift slides it along
 * the route; the 3-axis gizmo on the selected mark bends x / z and lifts y;
 * Delete removes an interior mark. The marks are where a hand takes hold; the
 * route's own points are its shape and are moved by the bend, never one by one.
 */
export function ObjectPathHandles({ path, selectedIndex, enabled, mode = "move", paneRef, camRef, onSelect, onChangePath, onDragStart, onDragEnd }) {
	const { gl } = useThree();
	const invalidate = useThree((state) => state.invalidate);
	const groupRef = useRef(null);
	const gizmoRef = useRef(null);
	const dragRef = useRef(null);
	const stateRef = useRef(null);
	// What the pointer is doing: a bend drag lights up the span it deforms.
	const [dragInfo, setDragInfo] = useState(null);
	// Mark index under the pointer, for the hover highlight.
	const [hover, setHover] = useState(null);
	// The pointer is on the line where a dot could still be dropped.
	const [lineHover, setLineHover] = useState(false);
	// Which lean ring the pointer is over, for the hover highlight.
	const [ringHover, setRingHover] = useState(null);
	stateRef.current = { path, selectedIndex, enabled, mode, onSelect, onChangePath, onDragStart, onDragEnd };
	// The line is not a mesh the raycaster can hit, but the object gizmo's
	// selection handler decides "does this press belong to a path handle?" by
	// raycasting GIZMO_LAYER (gizmo-claim.js). This invisible node answers that
	// ray in SCREEN space — near the drawn curve counts — so a press on the
	// route is claimed instead of deselecting the object, which unmounted these
	// handles before the double-click that adds a mark could arrive.
	const lineProxy = useMemo(() => {
		const node = new THREE.Group();
		node.userData.pathLine = true;
		node.raycast = function raycastRoute(raycaster, intersects) {
			const s = stateRef.current;
			const camera = raycaster.camera ?? camRef.current;
			if (!s.enabled || !s.path || !camera || !paneRef.current) return;
			// Any point down the ray lands on the pointer's pixel: that is the pointer.
			const ahead = raycaster.ray.at(Math.max(1, (camera.near ?? 0.1) * 2), new THREE.Vector3());
			const pointer = paneProject(ahead, paneRef.current, camera);
			if (!pointer) return;
			const spot = nearestPathFraction(s.path, (world) => paneProject(world, paneRef.current, camera), pointer.x, pointer.y);
			if (spot && spot.d <= PATH_LINE_PICK_PX) intersects.push({ distance: 1e-3, point: ahead, object: node });
		};
		return node;
		// refs are stable
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useFrame(() => {
		const gizmo = gizmoRef.current;
		const camera = camRef.current;
		if (!gizmo || !camera) return;
		const world = gizmo.getWorldPosition(new THREE.Vector3());
		gizmo.scale.setScalar(Math.max(0.35, camera.getWorldPosition(new THREE.Vector3()).distanceTo(world) * CRANE_GIZMO_SCALE));
	});
	// Everything here is editor furniture on GIZMO_LAYER — and the pick
	// raycasts look only there, so a handle that mounts later (the rings the
	// rotate tool brings) must be stamped too: `mode` is a dependency.
	useEffect(() => {
		groupRef.current?.traverse((node) => node.layers?.set(GIZMO_LAYER));
		invalidate();
	}, [path, selectedIndex, enabled, mode, dragInfo, invalidate]);
	useEffect(() => {
		if (!enabled) return undefined;
		const raycaster = new THREE.Raycaster();
		raycaster.layers.set(GIZMO_LAYER);
		const rayFrom = (event) => {
			const pane = paneRef.current;
			const camera = camRef.current;
			if (!pane || !camera) return null;
			const bounds = pane.getBoundingClientRect();
			if (bounds.width < 2 || bounds.height < 2) return null;
			const ndc = new THREE.Vector2(
				((event.clientX - bounds.left) / bounds.width) * 2 - 1,
				-((event.clientY - bounds.top) / bounds.height) * 2 + 1,
			);
			if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
			camera.updateMatrixWorld();
			raycaster.setFromCamera(ndc, camera);
			return raycaster;
		};
		const paneScreen = (world) => paneProject(world, paneRef.current, camRef.current);
		// The bend a drag of mark `index` will apply: the route's points with a
		// per-point weight (the camera rail's own preparation, so a mark deforms
		// the route the same way here), seeded with a vertex under the mark when
		// the stroke left none close enough to pull.
		const prepareBend = (s, index) => {
			const fractions = pathMarkFractions(s.path);
			const base = pathPointAtFraction(s.path, fractions[index]);
			if (!base) return null;
			return { base, fractions, bend: prepareRailBend(s.path.points, base, fractions.map((t) => ({ t })), index, { maxControls: MAX_PATH_POINTS }) };
		};
		// The travel frame at mark `index`: the heading the body has there (the
		// route's own direction), as forward / right vectors on the floor.
		const frameAt = (s, index) => {
			const t = pathMarkFractions(s.path)[index];
			const before = pathPointAtFraction(s.path, Math.max(0, t - 0.01));
			const after = pathPointAtFraction(s.path, Math.min(1, t + 0.01));
			const yaw = before && after ? Math.atan2(after.x - before.x, after.z - before.z) : 0;
			return { yaw, forward: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) };
		};
		const onDown = (event) => {
			const s = stateRef.current;
			if (!s.enabled || !s.path || event.button !== 0) return;
			if (!groupRef.current || !rayFrom(event)) return;
			const hits = raycaster.intersectObjects(groupRef.current.children, true);
			// A ring on the selected dot turns its lean: bank about the travel
			// direction, pitch about the lateral axis. The pointer's angle around
			// the ring is read in the ring's own plane, the object gizmo's way.
			const ringHit = hits.find((entry) => entry.object.userData?.pathRing);
			if (ringHit && s.mode === "rotate" && s.selectedIndex != null) {
				const key = ringHit.object.userData.pathRing;
				const fractions = pathMarkFractions(s.path);
				if (s.selectedIndex <= 0 || s.selectedIndex >= fractions.length - 1) return;
				const base = pathPointAtFraction(s.path, fractions[s.selectedIndex]);
				if (!base) return;
				const frame = frameAt(s, s.selectedIndex);
				const spin = key === "bank" ? frame.forward : frame.right;
				const origin = new THREE.Vector3(base.x, base.y, base.z);
				const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(spin, origin);
				const hit = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(plane, hit)) return;
				const tangent = new THREE.Vector3(spin.y, spin.z, spin.x).cross(spin).normalize();
				const binormal = spin.clone().cross(tangent).normalize();
				const offset = hit.clone().sub(origin);
				if (offset.lengthSq() < 1e-8) return;
				event.stopImmediatePropagation();
				event.preventDefault();
				const marks = pathMarks(s.path);
				dragRef.current = {
					ring: key, index: s.selectedIndex, origin, plane, tangent, binormal,
					lastAngle: Math.atan2(offset.dot(binormal), offset.dot(tangent)), turned: 0,
					startValue: marks[s.selectedIndex - 1]?.[key] ?? 0, marks, recorded: false,
				};
				gl.domElement.style.cursor = "grabbing";
				setDragInfo({ ring: key });
				invalidate();
				return;
			}
			// The axis gizmo outranks the dots: its arrows sit on the selected
			// mark, and a press on an arrow is a directed move, not a reselect.
			const axisHit = hits.find((entry) => entry.object.userData?.pathAxis);
			if (axisHit && s.selectedIndex != null) {
				const prepared = prepareBend(s, s.selectedIndex);
				if (!prepared?.bend) return;
				const axis = axisHit.object.userData.pathAxis;
				const origin = new THREE.Vector3(prepared.base.x, prepared.base.y, prepared.base.z);
				const dir = CRANE_AXES.find((entry) => entry.axis === axis).dir;
				const eye = new THREE.Vector3();
				camRef.current.getWorldDirection(eye);
				// slide plane: contains the axis and faces the camera as squarely as it can
				const normal = dir.clone().cross(eye).cross(dir);
				if (normal.lengthSq() < 1e-6) return;
				normal.normalize();
				const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
				const hitStart = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(plane, hitStart)) return;
				event.stopImmediatePropagation();
				event.preventDefault();
				dragRef.current = { axis, index: s.selectedIndex, dir: dir.clone(), plane, hitStart, bend: prepared.bend, recorded: false };
				setDragInfo({ t0: prepared.bend.t0, radius: prepared.bend.radius });
				invalidate();
				return;
			}
			const hit = hits.find((entry) => entry.object.userData?.pathIndex !== undefined);
			if (!hit) {
				// A press on the route itself belongs to it too: take it so the
				// fly camera does not, and the object stays selected for the
				// double-click that follows.
				if (hits.some((entry) => entry.object.userData?.pathLine)) {
					event.stopImmediatePropagation();
					event.preventDefault();
				}
				return;
			}
			const index = hit.object.userData.pathIndex;
			const prepared = prepareBend(s, index);
			if (!prepared?.bend) return;
			// A press on the mark moves it freely on the camera plane — the sun
			// puck's grammar, so the route can be nudged without aiming at an arrow.
			const facing = new THREE.Vector3();
			camRef.current.getWorldDirection(facing);
			const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, new THREE.Vector3(prepared.base.x, prepared.base.y, prepared.base.z));
			const hitStart = new THREE.Vector3();
			if (!raycaster.ray.intersectPlane(plane, hitStart)) return;
			event.stopImmediatePropagation();
			event.preventDefault();
			s.onSelect(index);
			const slide = event.shiftKey && index > 0 && index < prepared.fractions.length - 1;
			dragRef.current = { axis: null, index, slide, plane, hitStart, base: prepared.base, fractions: prepared.fractions, marks: pathMarks(s.path), bend: prepared.bend, recorded: false };
			gl.domElement.style.cursor = "grabbing";
			setDragInfo(slide ? { slide: true } : { t0: prepared.bend.t0, radius: prepared.bend.radius });
			invalidate();
		};
		const onMove = (event) => {
			const s = stateRef.current;
			const drag = dragRef.current;
			if (!drag || !s.enabled || !s.path) return;
			if (!rayFrom(event)) return;
			if (drag.ring) {
				const hit = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(drag.plane, hit)) return;
				const offset = hit.sub(drag.origin);
				const angle = Math.atan2(offset.dot(drag.binormal), offset.dot(drag.tangent));
				// Wrapped increments: crossing the ring's seam never jumps a turn.
				drag.turned += wrapDeg(((angle - drag.lastAngle) * 180) / Math.PI);
				drag.lastAngle = angle;
				// The lean's own handedness (travelPose): bank is a right-handed
				// turn about forward; pitch reads nose-up, the other way about right.
				const raw = drag.startValue + (drag.ring === "bank" ? drag.turned : -drag.turned);
				const step = event.ctrlKey || event.metaKey ? 5 : 0.5;
				const value = Math.max(-MAX_PATH_LEAN, Math.min(MAX_PATH_LEAN, Math.round(raw / step) * step));
				if (!drag.recorded) {
					s.onDragStart?.();
					drag.recorded = true;
				}
				s.onChangePath({ marks: drag.marks.map((entry, i) => (i + 1 === drag.index ? { ...entry, [drag.ring]: value } : entry)) }, { dragging: true });
				invalidate();
				return;
			}
			if (drag.slide) {
				// slide along the arc: the ray onto the horizontal plane at the mark
				const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -drag.base.y);
				const world = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(floor, world)) return;
				const spot = nearestPathFraction(s.path, (point) => ({ x: point.x, y: point.z }), world.x, world.z);
				if (!spot) return;
				const t = Math.max(
					drag.fractions[drag.index - 1] + PATH_MARK_CLEARANCE,
					Math.min(drag.fractions[drag.index + 1] - PATH_MARK_CLEARANCE, spot.t),
				);
				if (!drag.recorded) {
					s.onDragStart?.();
					drag.recorded = true;
				}
					// the dot keeps its lean as it slides: matched by place in the row, not by value
					s.onChangePath({ marks: drag.marks.map((entry, i) => (i + 1 === drag.index ? { ...entry, t } : entry)) }, { dragging: true });
				invalidate();
				return;
			}
			const world = new THREE.Vector3();
			if (!raycaster.ray.intersectPlane(drag.plane, world)) return;
			let delta;
			if (drag.axis) {
				const travel = world.clone().sub(drag.hitStart).dot(drag.dir);
				delta = drag.dir.clone().multiplyScalar(travel);
			} else {
				delta = world.clone().sub(drag.hitStart);
			}
			if (!drag.recorded) {
				s.onDragStart?.();
				drag.recorded = true;
			}
			// A weighted bump: the points around the mark follow, fading out by the
			// neighbouring marks; the ends of an interior mark's bend stay pinned.
			const moved = drag.bend.startControls.map((entry, i) => {
				const weight = drag.bend.weights[i];
				if (!(weight > 0)) return entry;
				return {
					...entry,
					x: entry.x + delta.x * weight,
					y: Math.max(0, (entry.y ?? 0) + delta.y * weight),
					z: entry.z + delta.z * weight,
				};
			});
			s.onChangePath({ points: moved }, { dragging: true });
			invalidate();
		};
		const onUp = () => {
			const drag = dragRef.current;
			dragRef.current = null;
			setDragInfo(null);
			if (drag) gl.domElement.style.cursor = "";
			if (drag?.recorded) stateRef.current.onDragEnd?.();
			invalidate();
		};
		// Hover: the only cue that the dots are handles. Window-bubble, so it
		// runs after the object gizmo's own cursor reset on the canvas.
		const onHover = (event) => {
			const s = stateRef.current;
			if (dragRef.current || !s.enabled || !s.path || event.buttons !== 0 || event.target !== gl.domElement) {
				setHover((current) => (current === null ? current : null));
				setLineHover((current) => (current ? false : current));
				setRingHover((current) => (current === null ? current : null));
				return;
			}
			let index = null;
			let ring = null;
			if (rayFrom(event) && groupRef.current) {
				const hits = raycaster.intersectObjects(groupRef.current.children, true);
				const axisHit = s.selectedIndex != null && hits.find((entry) => entry.object.userData?.pathAxis);
				const ringHit = s.mode === "rotate" && s.selectedIndex != null && hits.find((entry) => entry.object.userData?.pathRing);
				const dot = hits.find((entry) => entry.object.userData?.pathIndex !== undefined);
				if (ringHit) ring = ringHit.object.userData.pathRing;
				else if (!axisHit && dot) index = dot.object.userData.pathIndex;
			}
			setHover((current) => (current === index ? current : index));
			setRingHover((current) => (current === ring ? current : ring));
			if (index !== null || ring !== null) gl.domElement.style.cursor = "grab";
			// The line itself answers too: it brightens and the cursor says "copy"
			// while a double-click here would still drop a dot.
			let addable = false;
			if (index === null && camRef.current) {
				const fractions = pathMarkFractions(s.path);
				if (fractions.length < MAX_PATH_MARKS) {
					camRef.current.updateMatrixWorld();
					const best = nearestPathFraction(s.path, paneScreen, event.clientX, event.clientY);
					addable = !!best && best.d <= PATH_LINE_PICK_PX && !fractions.some((entry) => Math.abs(entry - best.t) < PATH_MARK_CLEARANCE);
				}
			}
			setLineHover((current) => (current === addable ? current : addable));
			if (addable) gl.domElement.style.cursor = "copy";
		};
		// Double-click the route to drop a mark on it — the crane curve's
		// gesture, so one habit covers both. A mark only gives the next drag
		// something to grab in the middle: it never changes where the object goes.
		const onDouble = (event) => {
			const s = stateRef.current;
			if (!s.enabled || !s.path || !camRef.current) return;
			const fractions = pathMarkFractions(s.path);
			if (fractions.length >= MAX_PATH_MARKS) return;
			camRef.current.updateMatrixWorld();
			const best = nearestPathFraction(s.path, paneScreen, event.clientX, event.clientY);
			if (!best || best.d > PATH_LINE_PICK_PX) return;
			// Not on top of a mark that is already there.
			if (fractions.some((entry) => Math.abs(entry - best.t) < PATH_MARK_CLEARANCE)) return;
			event.stopImmediatePropagation();
			event.preventDefault();
			// The new dot is born with the lean the route already has there, and its
			// neighbours keep theirs.
			const added = insertPathMark(s.path, best.t);
			if (!added) return;
			s.onDragStart?.();
			s.onChangePath({ marks: added.marks });
			s.onDragEnd?.();
			s.onSelect(added.index);
			invalidate();
		};
		// Delete removes the selected interior mark, never the object: while a
		// mark is selected this handler owns the key, and the scene-object delete
		// handler stands down (it checks the same selection). The ends stay — a
		// route is whatever lies between them; "Delete path" clears it.
		const onKey = (event) => {
			const s = stateRef.current;
			if (!s.enabled || !s.path || s.selectedIndex == null) return;
			if (event.key !== "Delete" && event.key !== "Backspace") return;
			if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const fractions = pathMarkFractions(s.path);
			if (s.selectedIndex <= 0 || s.selectedIndex >= fractions.length - 1) return;
			s.onDragStart?.();
			s.onChangePath({ marks: pathMarks(s.path).filter((_, i) => i + 1 !== s.selectedIndex) });
			s.onDragEnd?.();
			s.onSelect(null);
			invalidate();
		};
		const el = gl.domElement;
		el.addEventListener("pointerdown", onDown);
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp, true);
		window.addEventListener("pointermove", onHover);
		el.addEventListener("dblclick", onDouble, true);
		window.addEventListener("keydown", onKey, true);
		return () => {
			el.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp, true);
			window.removeEventListener("pointermove", onHover);
			el.removeEventListener("dblclick", onDouble, true);
			window.removeEventListener("keydown", onKey, true);
		};
		// paneRef/camRef are stable; handlers read live state through stateRef
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, gl, invalidate]);
	const curve = useMemo(() => (path?.points?.length > 1 ? pathCurve(path) : null), [path]);
	const linePoints = useMemo(
		// The curve the object travels, not the chords between its points.
		() => (curve ? curve.points : []).map((point) => [point.x, point.y + 0.02, point.z]),
		[curve],
	);
	const marks = useMemo(
		() => (path ? pathMarkFractions(path).map((t) => pathPointAtFraction(path, t)) : []),
		[path],
	);
	// The dots that carry a lean, in the travel frame they will pose the body in:
	// a yaw from the route's direction there, then the lean itself.
	const leans = useMemo(() => {
		if (!path) return [];
		return pathMarks(path).map((mark, i) => {
			if (!mark.bank && !mark.pitch) return null;
			const before = pathPointAtFraction(path, Math.max(0, mark.t - 0.01));
			const after = pathPointAtFraction(path, Math.min(1, mark.t + 0.01));
			const yaw = before && after ? Math.atan2(after.x - before.x, after.z - before.z) : 0;
			const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-mark.pitch * (Math.PI / 180), yaw, mark.bank * (Math.PI / 180), "YXZ"));
			return { index: i + 1, quaternion };
		}).filter(Boolean);
	}, [path]);
	// The travel frame the selected dot's rings stand in: a yaw from the route's
	// direction there. Only an interior dot has one — the ends are always level.
	const leanFrame = useMemo(() => {
		if (!path || selectedIndex == null) return null;
		const fractions = pathMarkFractions(path);
		if (selectedIndex <= 0 || selectedIndex >= fractions.length - 1) return null;
		const t = fractions[selectedIndex];
		const before = pathPointAtFraction(path, Math.max(0, t - 0.01));
		const after = pathPointAtFraction(path, Math.min(1, t + 0.01));
		const yaw = before && after ? Math.atan2(after.x - before.x, after.z - before.z) : 0;
		return { quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) };
	}, [path, selectedIndex]);
	if (!enabled || !path || linePoints.length < 2) return null;
	const selected = selectedIndex != null ? marks[selectedIndex] : null;
	return (
		<group ref={groupRef}>
			<primitive object={lineProxy} />
			<Line points={linePoints} color={lineHover ? "#d4f7e2" : "#6fcf97"} lineWidth={lineHover ? 4 : 2.5} transparent opacity={lineHover ? 1 : 0.9} />
			{selected && (
				<group ref={gizmoRef} position={[selected.x, selected.y, selected.z]} renderOrder={999}>
					{mode === "rotate" && leanFrame && (
						<group quaternion={leanFrame.quaternion}>
							{PATH_RINGS.map(({ key, color, rotation }) => {
								const lit = dragInfo?.ring === key || (!dragInfo && ringHover === key);
								return (
									<group key={key} rotation={rotation}>
										<mesh renderOrder={999}>
											<torusGeometry args={[PATH_RING_R, 0.022, 8, 48]} />
											<meshStandardMaterial color="#000000" emissive={lit ? "#ffd23d" : color} emissiveIntensity={lit ? 3 : 2.2} toneMapped={false} depthTest={false} depthWrite={false} transparent opacity={0.95} />
										</mesh>
										{/* the grab band: a 2 cm ring is nothing to aim at */}
										<mesh userData={{ pathRing: key }}>
											<torusGeometry args={[PATH_RING_R, 0.07, 6, 32]} />
											<meshBasicMaterial visible={false} />
										</mesh>
									</group>
								);
							})}
						</group>
					)}
					{mode !== "rotate" && CRANE_AXES.map(({ axis, dir, color }) => {
						const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
						return (
							<group key={axis} quaternion={quat}>
								<mesh position={[0, CRANE_ARROW_LEN / 2 + 0.08, 0]} renderOrder={999}>
									<cylinderGeometry args={[0.016, 0.016, CRANE_ARROW_LEN, 8]} />
									<meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={2.2} toneMapped={false} depthTest={false} depthWrite={false} transparent opacity={0.95} />
								</mesh>
								<mesh position={[0, CRANE_ARROW_LEN + 0.08 + 0.07, 0]} renderOrder={999}>
									<coneGeometry args={[0.05, 0.14, 14]} />
									<meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={2.2} toneMapped={false} depthTest={false} depthWrite={false} transparent opacity={0.95} />
								</mesh>
								<mesh position={[0, (CRANE_ARROW_LEN + 0.14) / 2 + 0.08, 0]} userData={{ pathAxis: axis }}>
									<cylinderGeometry args={[0.09, 0.09, CRANE_ARROW_LEN + 0.14, 8]} />
									<meshBasicMaterial visible={false} />
								</mesh>
							</group>
						);
					})}
				</group>
			)}
			{marks.map((point, index) => point && (
				<group key={`${index}:${marks.length}`} position={[point.x, point.y, point.z]}>
					<mesh userData={{ pathIndex: index }} renderOrder={998} scale={hover === index ? 1.3 : 1}>
						<sphereGeometry args={[0.085, 16, 12]} />
						{/* the selected mark keeps its own colour; hover only brightens */}
						<meshBasicMaterial color={index === selectedIndex ? (hover === index ? "#ffd08a" : "#ffb454") : hover === index ? "#d4f7e2" : "#6fcf97"} depthTest={false} transparent opacity={0.95} />
					</mesh>
					{/* the real click target: a dot is a dozen pixels from a few
					    metres back, so an invisible halo carries the press */}
					{/* a dot that leans the body: a bar through it tilted the way the
					    body will sit (across = bank, along = pitch), in the travel frame */}
					{leans.filter((lean) => lean.index === index).map((lean) => (
						<group key="lean" quaternion={lean.quaternion} userData={{ pathLean: true }}>
							<mesh renderOrder={998}>
								<boxGeometry args={[0.7, 0.03, 0.03]} />
								<meshBasicMaterial color="#ffb454" depthTest={false} transparent opacity={0.95} />
							</mesh>
							<mesh renderOrder={998}>
								<boxGeometry args={[0.03, 0.03, 0.46]} />
								<meshBasicMaterial color="#ffd08a" depthTest={false} transparent opacity={0.95} />
							</mesh>
						</group>
					))}
					<mesh userData={{ pathIndex: index }}>
						<sphereGeometry args={[0.24, 10, 8]} />
						<meshBasicMaterial visible={false} />
					</mesh>
				</group>
			))}
			{/* live readout while a drag moves the mark */}
			{dragInfo && selected && (
				<GizmoLabel
					position={[selected.x, selected.y + 0.42, selected.z]}
					text={dragInfo.ring
						? `${dragInfo.ring} ${(pathMarks(path)[selectedIndex - 1]?.[dragInfo.ring] ?? 0).toFixed(1)}°`
						: dragInfo.slide ? `${Math.round(pathMarkFractions(path)[selectedIndex] * 100)}%` : `x ${selected.x.toFixed(1)}  y ${selected.y.toFixed(1)}  z ${selected.z.toFixed(1)}`}
					camRef={camRef}
				/>
			)}
			{/* the span a bend will actually deform, lit on the route */}
			{dragInfo?.radius != null && curve && (() => {
				const span = [];
				for (let i = 0; i < curve.points.length; i += 1) {
					const t = curve.cumulative[i] / curve.length;
					if (t >= dragInfo.t0 - dragInfo.radius && t <= dragInfo.t0 + dragInfo.radius) {
						span.push([curve.points[i].x, curve.points[i].y + 0.03, curve.points[i].z]);
					}
				}
				if (span.length < 2) return null;
				return <Line points={span} color="#ffb454" lineWidth={4} transparent opacity={0.9} />;
			})()}
		</group>
	);
}

export function CraneHandles({ rail, crane, controlPoints, selectedIndex, enabled, paneRef, camRef, onSelect, onChangePoints, onChangeRail, onDragStart, onDragEnd }) {
	const { gl } = useThree();
	const invalidate = useThree((state) => state.invalidate);
	const groupRef = useRef(null);
	const gizmoRef = useRef(null);
	const dragRef = useRef(null);
	const stateRef = useRef(null);
	// What the pointer is doing right now, for the in-scene feedback layer:
	// height-ish drags float a metre readout, a bend drag lights up the arc
	// span the bump will actually deform.
	const [dragInfo, setDragInfo] = useState(null);
	stateRef.current = { rail, crane, controlPoints, selectedIndex, enabled, onSelect, onChangePoints, onChangeRail, onDragStart, onDragEnd };
	// Constant on-screen size for the axis gizmo: it is UI, not set dressing.
	useFrame(() => {
		const gizmo = gizmoRef.current;
		const camera = camRef.current;
		if (!gizmo || !camera) return;
		const world = gizmo.getWorldPosition(new THREE.Vector3());
		gizmo.scale.setScalar(Math.max(0.35, camera.getWorldPosition(new THREE.Vector3()).distanceTo(world) * CRANE_GIZMO_SCALE));
	});
	useEffect(() => {
		groupRef.current?.traverse((node) => node.layers?.set(GIZMO_LAYER));
	});
	useEffect(() => {
		if (!enabled) return undefined;
		const raycaster = new THREE.Raycaster();
		raycaster.layers.set(GIZMO_LAYER);
		const rayFrom = (event) => {
			const pane = paneRef.current;
			const camera = camRef.current;
			if (!pane || !camera) return null;
			const bounds = pane.getBoundingClientRect();
			if (bounds.width < 2 || bounds.height < 2) return null;
			const ndc = new THREE.Vector2(
				((event.clientX - bounds.left) / bounds.width) * 2 - 1,
				-((event.clientY - bounds.top) / bounds.height) * 2 + 1,
			);
			if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
			camera.updateMatrixWorld();
			raycaster.setFromCamera(ndc, camera);
			return raycaster;
		};
		const paneScreen = (world) => {
			const pane = paneRef.current.getBoundingClientRect();
			const projected = world.project(camRef.current);
			return projected.z > 1 ? null : {
				x: pane.left + ((projected.x + 1) / 2) * pane.width,
				y: pane.top + ((1 - projected.y) / 2) * pane.height,
			};
		};
		const onDown = (event) => {
			const s = stateRef.current;
			if (!s.enabled || !s.crane || event.button !== 0) return;
			if (!groupRef.current || !rayFrom(event)) return;
			const hits = raycaster.intersectObjects(groupRef.current.children, true);
			// The axis gizmo outranks the dots: its arrows sit on the selected
			// dot, and a press on an arrow is a directed move, not a reselect.
			const axisHit = hits.find((entry) => entry.object.userData?.craneAxis);
			if (axisHit && s.selectedIndex != null && s.crane.points[s.selectedIndex]) {
				const axis = axisHit.object.userData.craneAxis;
				const point = s.crane.points[s.selectedIndex];
				const base = railPoint(s.rail, point.t * s.rail.length);
				const origin = new THREE.Vector3(base.x, point.height, base.z);
				const dir = CRANE_AXES.find((entry) => entry.axis === axis).dir;
				const eye = new THREE.Vector3();
				camRef.current.getWorldDirection(eye);
				// slide plane: contains the axis and faces the camera as squarely
				// as it can — the same construction the object gizmo uses
				const normal = dir.clone().cross(eye).cross(dir);
				if (normal.lengthSq() < 1e-6) return;
				normal.normalize();
				const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
				const hitStart = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(plane, hitStart)) return;
				// x/z bend the rail: a weighted bump around the mark's base, so
				// the path deforms locally and the marks beside it stay put.
				const bend = axis === "y" ? null : prepareRailBend(s.controlPoints, base, s.crane.points, s.selectedIndex);
				if (axis !== "y" && !bend) return;
				event.stopImmediatePropagation();
				event.preventDefault();
				dragRef.current = {
					axis,
					index: s.selectedIndex,
					dir: dir.clone(),
					plane,
					hitStart,
					startHeight: point.height,
					startControls: bend?.startControls ?? null,
					bendWeights: bend?.weights ?? null,
					recorded: false,
				};
				setDragInfo(axis === "y" ? { kind: "height" } : { kind: "bend", t0: bend.t0, radius: bend.radius });
				invalidate();
				return;
			}
			const hit = hits.find((entry) => entry.object.userData?.craneIndex !== undefined);
			if (!hit) return;
			event.stopImmediatePropagation();
			event.preventDefault();
			const index = hit.object.userData.craneIndex;
			s.onSelect(index);
			dragRef.current = { index, slide: event.shiftKey, recorded: false };
			setDragInfo({ kind: event.shiftKey ? "slide" : "free" });
			invalidate();
		};
		const onMove = (event) => {
			const s = stateRef.current;
			const drag = dragRef.current;
			if (!drag || !s.enabled || !s.crane || !s.rail) return;
			if (!rayFrom(event)) return;
			const points = s.crane.points;
			const point = points[drag.index];
			if (!point) return;
			if (!drag.recorded) {
				s.onDragStart?.();
				drag.recorded = true;
			}
			if (drag.axis) {
				const world = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(drag.plane, world)) return;
				const travel = world.sub(drag.hitStart).dot(drag.dir);
				if (drag.axis === "y") {
					const height = Math.max(0.1, Math.min(12, drag.startHeight + travel));
					s.onChangePoints(points.map((entry, i) => (i === drag.index ? { ...entry, height } : entry)), { dragging: true });
				} else if (drag.startControls && drag.bendWeights && s.onChangeRail) {
					const dx = drag.axis === "x" ? travel : 0;
					const dz = drag.axis === "z" ? travel : 0;
					const moved = drag.startControls.map((entry, i) => (drag.bendWeights[i] > 0
						? { ...entry, x: entry.x + dx * drag.bendWeights[i], z: entry.z + dz * drag.bendWeights[i] }
						: entry));
					s.onChangeRail(moved, { dragging: true });
				}
				invalidate();
				return;
			}
			if (drag.slide && drag.index > 0 && drag.index < points.length - 1) {
				// slide along the arc: ray onto the horizontal plane at the mark
				const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.height);
				const world = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(plane, world)) return;
				let bestI = 0;
				let bestD = Infinity;
				for (let i = 0; i < s.rail.points.length; i += 1) {
					const d = Math.hypot(s.rail.points[i].x - world.x, s.rail.points[i].z - world.z);
					if (d < bestD) {
						bestD = d;
						bestI = i;
					}
				}
				const t = Math.max(
					points[drag.index - 1].t + 0.02,
					Math.min(points[drag.index + 1].t - 0.02, s.rail.cumLen[bestI] / s.rail.length),
				);
				s.onChangePoints(points.map((entry, i) => (i === drag.index ? { ...entry, t } : entry)), { dragging: true });
			} else {
				// free move: ray onto the camera-facing vertical plane at the base.
				// Its y sets the height; its x/z re-projects an interior mark onto
				// the nearest rail arc position, so one drag steers both axes — the
				// rail is the only x/z a crane mark can occupy.
				const base = railPoint(s.rail, point.t * s.rail.length);
				const camera = camRef.current;
				const facing = new THREE.Vector3();
				camera.getWorldDirection(facing);
				facing.y = 0;
				if (facing.lengthSq() < 1e-6) return; // looking straight down: height is unreadable
				facing.normalize();
				const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, new THREE.Vector3(base.x, 0, base.z));
				const world = new THREE.Vector3();
				if (!raycaster.ray.intersectPlane(plane, world)) return;
				const height = Math.max(0.1, Math.min(12, world.y));
				let t = point.t;
				if (drag.index > 0 && drag.index < points.length - 1) {
					let bestI = 0;
					let bestD = Infinity;
					for (let i = 0; i < s.rail.points.length; i += 1) {
						const d = Math.hypot(s.rail.points[i].x - world.x, s.rail.points[i].z - world.z);
						if (d < bestD) {
							bestD = d;
							bestI = i;
						}
					}
					t = Math.max(
						points[drag.index - 1].t + 0.02,
						Math.min(points[drag.index + 1].t - 0.02, s.rail.cumLen[bestI] / s.rail.length),
					);
				}
				s.onChangePoints(points.map((entry, i) => (i === drag.index ? { ...entry, t, height } : entry)), { dragging: true });
			}
			invalidate();
		};
		const onUp = () => {
			if (dragRef.current?.recorded) stateRef.current.onDragEnd?.();
			dragRef.current = null;
			setDragInfo(null);
		};
		const onDouble = (event) => {
			const s = stateRef.current;
			if (!s.enabled || !s.crane || !s.rail || !camRef.current) return;
			camRef.current.updateMatrixWorld();
			let best = null;
			for (let i = 0; i < s.rail.points.length; i += 1) {
				const t = s.rail.cumLen[i] / s.rail.length;
				const screen = paneScreen(new THREE.Vector3(s.rail.points[i].x, craneHeightAt(s.crane, t), s.rail.points[i].z));
				if (!screen) continue;
				const d = Math.hypot(screen.x - event.clientX, screen.y - event.clientY);
				if (!best || d < best.d) best = { d, t };
			}
			if (!best || best.d > 14) return;
			if (s.crane.points.length >= 8) return;
			if (s.crane.points.some((entry) => Math.abs(entry.t - best.t) < 0.03)) return;
			event.stopImmediatePropagation();
			event.preventDefault();
			const added = [...s.crane.points, { t: best.t, height: craneHeightAt(s.crane, best.t) }].sort((a, b) => a.t - b.t);
			s.onChangePoints(added);
			s.onSelect(added.findIndex((entry) => entry.t === best.t));
			invalidate();
		};
		const onKey = (event) => {
			const s = stateRef.current;
			if (!s.enabled || !s.crane) return;
			if (event.key !== "Delete" && event.key !== "Backspace") return;
			if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
			const index = s.selectedIndex;
			if (index == null || index <= 0 || index >= s.crane.points.length - 1) return;
			event.preventDefault();
			s.onChangePoints(s.crane.points.filter((_, i) => i !== index));
			s.onSelect(null);
			invalidate();
		};
		const el = gl.domElement;
		el.addEventListener("pointerdown", onDown, true);
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp, true);
		el.addEventListener("dblclick", onDouble, true);
		window.addEventListener("keydown", onKey);
		return () => {
			el.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp, true);
			el.removeEventListener("dblclick", onDouble, true);
			window.removeEventListener("keydown", onKey);
		};
		// paneRef/camRef are stable refs; handlers read live state through stateRef
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, gl, invalidate]);
	if (!enabled || !crane || !rail) return null;
	const selectedPoint = selectedIndex != null ? crane.points[selectedIndex] : null;
	const selectedBase = selectedPoint ? railPoint(rail, selectedPoint.t * rail.length) : null;
	return (
		<group ref={groupRef}>
			{selectedPoint && (
				<group ref={gizmoRef} position={[selectedBase.x, selectedPoint.height, selectedBase.z]} renderOrder={999}>
					{CRANE_AXES.map(({ axis, dir, color }) => {
						const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
						return (
							<group key={axis} quaternion={quat}>
								<mesh position={[0, CRANE_ARROW_LEN / 2 + 0.08, 0]} renderOrder={999}>
									<cylinderGeometry args={[0.016, 0.016, CRANE_ARROW_LEN, 8]} />
									<meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={2.2} toneMapped={false} depthTest={false} depthWrite={false} transparent opacity={0.95} />
								</mesh>
								<mesh position={[0, CRANE_ARROW_LEN + 0.08 + 0.07, 0]} renderOrder={999}>
									<coneGeometry args={[0.05, 0.14, 14]} />
									<meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={2.2} toneMapped={false} depthTest={false} depthWrite={false} transparent opacity={0.95} />
								</mesh>
								<mesh position={[0, (CRANE_ARROW_LEN + 0.14) / 2 + 0.08, 0]} userData={{ craneAxis: axis }}>
									<cylinderGeometry args={[0.09, 0.09, CRANE_ARROW_LEN + 0.14, 8]} />
									<meshBasicMaterial visible={false} />
								</mesh>
							</group>
						);
					})}
				</group>
			)}
			{crane.points.map((point, index) => {
				const base = railPoint(rail, point.t * rail.length);
				return (
					<group key={`${index}:${crane.points.length}`} position={[base.x, point.height, base.z]}>
						<mesh userData={{ craneIndex: index }} renderOrder={998}>
							<sphereGeometry args={[0.085, 16, 12]} />
							<meshBasicMaterial color={index === selectedIndex ? "#ffb454" : "#a78bfa"} depthTest={false} transparent opacity={0.95} />
						</mesh>
						{/* the real click target: a dot is a dozen pixels from a few
						    metres back, so an invisible halo carries the press */}
						<mesh userData={{ craneIndex: index }}>
							<sphereGeometry args={[0.24, 10, 8]} />
							<meshBasicMaterial visible={false} />
						</mesh>
					</group>
				);
			})}
			{/* live readout while a drag changes the mark's height */}
			{dragInfo && dragInfo.kind !== "bend" && selectedPoint && (
				<GizmoLabel
					position={[selectedBase.x, selectedPoint.height + 0.28, selectedBase.z]}
					text={dragInfo.kind === "slide" ? `${Math.round(selectedPoint.t * 100)}%` : `${selectedPoint.height.toFixed(1)} m`}
					camRef={camRef}
				/>
			)}
			{/* the span a bend drag will actually deform, lit on the floor path */}
			{dragInfo?.kind === "bend" && (() => {
				const span = [];
				for (let i = 0; i < rail.points.length; i += 1) {
					const t = rail.cumLen[i] / rail.length;
					if (t >= dragInfo.t0 - dragInfo.radius && t <= dragInfo.t0 + dragInfo.radius) {
						span.push([rail.points[i].x, 0.035, rail.points[i].z]);
					}
				}
				if (span.length < 2) return null;
				return <Line points={span} color="#ffb454" lineWidth={4} transparent opacity={0.9} />;
			})()}
		</group>
	);
}

export function ShotPathPreview({ waypoints, start, activeWaypointId }) {
	const rootRef = useRef(null);
	const line = useMemo(() => {
		if (!waypoints.length) return null;
		const points = [{ x: start.x, z: start.z }, ...waypoints];
		const positions = new Float32Array(points.length * 3);
		points.forEach((point, i) => {
			positions[i * 3] = point.x;
			positions[i * 3 + 1] = 0.03;
			positions[i * 3 + 2] = point.z;
		});
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		return geometry;
	}, [start.x, start.z, waypoints]);
	useEffect(() => {
		// Every render: drei's Text meshes appear asynchronously, and each new
		// node must land on the gizmo layer before the next capture.
		rootRef.current?.traverse((node) => node.layers.set(GIZMO_LAYER));
	});
	if (!waypoints.length) return null;
	return (
		<group ref={rootRef}>
			{line && (
				<line geometry={line}>
					<lineBasicMaterial color="#4e9fb3" transparent opacity={0.8} depthWrite={false} />
				</line>
			)}
			{waypoints.map((waypoint, i) => {
				const active = waypoint.id === activeWaypointId;
				const color = active ? "#ffd76c" : "#4e9fb3";
				return (
					<group key={waypoint.id} position={[waypoint.x, 0.03, waypoint.z]}>
						<mesh rotation={[-Math.PI / 2, 0, 0]}>
							<ringGeometry args={[0.13, 0.19, 28]} />
							<meshBasicMaterial color={color} depthWrite={false} />
						</mesh>
						<Text
							position={[0, 0.02, 0.34]}
							rotation={[-Math.PI / 2, 0, 0]}
							fontSize={0.24}
							color={color}
							anchorX="center"
							anchorY="middle"
							outlineWidth={0.03}
							outlineColor="#1c1a17"
							outlineOpacity={0.85}
						>
							{String(i + 1)}
						</Text>
					</group>
				);
			})}
		</group>
	);
}

// How far the deck runs in an EXPORTED frame. The viewport fades it out at
// 18..54 m to keep the working view clean; a blocking frame needs the far edge
// to survive, so the falloff starts later and ends further away, letting the
// floor resolve into a horizon instead of dissolving into the background.
//
// Both values must stay inside the shot camera's far plane (100 m) — geometry
// past it is clipped outright, so a fog range that ended beyond it would cut
// the deck off mid-fade and take the horizon with it.
export const CAPTURE_FOG_NEAR = 55;
export const CAPTURE_FOG_FAR = 95;

/** Offscreen aspect-aware read-back, always from the shot camera. */
export function CaptureRig({ apiRef, camRef, width = CAPTURE_W, height = CAPTURE_H }) {
	const { gl, scene } = useThree();
	useEffect(() => {
		// Each attempt owns its target independently of the live output size.
		// Resizing the editor cannot dispose an in-flight export's resources.
		function createExportCapture({ width, height }) {
			const target = new THREE.WebGLRenderTarget(width, height, {
				colorSpace: THREE.SRGBColorSpace,
				samples: 4,
			});
			const buffer = new Uint8Array(width * height * 4);
			return {
				scene,
				dispose: () => target.dispose(),
				render() {
					const source = camRef.current;
					if (!source) return null;
					const cam = source.clone();
					// the transform gizmo is UI: it never reaches an exported frame
					cam.layers.disable(GIZMO_LAYER);
					// QA hook: the layer mask the export camera actually renders
					// with — the browser suite asserts GIZMO_LAYER (the gizmo AND
					// the selection cage) is never in it.
					window.__captureCameraMask = cam.layers.mask;
					// A view offset (a crop of a wider frustum) already fixes the aspect.
					if (!cam.view?.enabled) cam.aspect = width / height;
					cam.updateProjectionMatrix();
					const previous = gl.getRenderTarget();
					// The viewport's fog dissolves the deck into the background by ~54 m
					// so the working view has no horizon to distract from blocking. An
					// exported frame wants the opposite: the horizon IS the vanishing
					// point, and without it the floor has no far edge to read depth
					// against. Push the falloff back for this draw only, then restore
					// it so the viewport is untouched.
					const fog = scene.fog;
					const fogNear = fog?.near;
					const fogFar = fog?.far;
					if (fog) {
						fog.near = CAPTURE_FOG_NEAR;
						fog.far = CAPTURE_FOG_FAR;
					}
					try {
						gl.setRenderTarget(target);
						gl.render(scene, cam);
						gl.readRenderTargetPixels(target, 0, 0, width, height, buffer);
					} finally {
						gl.setRenderTarget(previous);
						if (fog) {
							fog.near = fogNear;
							fog.far = fogFar;
						}
					}
					return buffer;
				},
			};
		}
		const api = { ...createExportCapture({ width, height }), createExportCapture };
		apiRef.current = api;
		if (width === MCP_CAPTURE_W && height === MCP_CAPTURE_H) {
			window.__cozyclayMcpCaptureReady = true;
			window.dispatchEvent(new Event("cozyclay:mcp-capture-ready"));
		}
		// QA hook: run one real export render and report what the capture
		// camera saw — the layer mask plus an amber scan of the output
		// frame (the selection cage's warm tone). Lets the suite prove the
		// deliverable frame stays free of editor furniture without driving
		// the whole generation form.
		window.__captureFrame = () => {
			const buffer = apiRef.current?.render() ?? null;
			if (!buffer) return null;
			let amber = 0;
			for (let i = 0; i < buffer.length; i += 4) {
				const r = buffer[i];
				const g = buffer[i + 1];
				const b = buffer[i + 2];
				if (r >= 180 && g >= 165 && g - b >= 35) amber++;
			}
			return { layersMask: window.__captureCameraMask ?? 0, amber, pixels: buffer.length / 4 };
		};
		return () => {
			if (apiRef.current === api) apiRef.current = null;
			if (width === MCP_CAPTURE_W && height === MCP_CAPTURE_H) window.__cozyclayMcpCaptureReady = false;
			api.dispose();
		};
	}, [gl, scene, camRef, apiRef, width, height]);
	return null;
}

export async function captureMcpFrame({ capture, camera, characters, activeCharacterId, objects, rigs, readAuthoredState, partColours = null }) {
	if (!capture || !camera) throw new Error("No renderable shot camera is available for capture_frame.");
	const authoredStateBefore = JSON.stringify(readAuthoredState());
	const buffer = capture.render();
	if (!buffer) throw new Error("No renderable shot camera is available for capture_frame.");
	let nonBlackPixels = 0;
	for (let offset = 0; offset < buffer.length; offset += 4) {
		if (buffer[offset] > 5 || buffer[offset + 1] > 5 || buffer[offset + 2] > 5) nonBlackPixels += 1;
	}
	if (nonBlackPixels === 0) throw new Error("capture_frame rejected a black rendered frame.");
	camera.updateMatrixWorld();
	const raycaster = new THREE.Raycaster();
	const roots = [];
	capture.scene.traverse((node) => {
		const id = node.userData?.sceneObjectId;
		if (typeof id === "string" && objects.some((object) => object.id === id)) roots.push({ id, root: node });
	});
	const assertions = characters.map((character) => {
		const rig = rigs[character.id];
		if (!rig || character.hidden) return { id: character.id, renderable: false, behindCameraPlane: null, fartherAlongCameraForward: null, distanceToFloor: null, occludedBy: null, visiblePixelCount: 0 };
		rig.updateWorldMatrix(true, true);
		const bounds = new THREE.Box3().setFromObject(rig);
		const center = bounds.getCenter(new THREE.Vector3());
		const cameraSpace = camera.worldToLocal(center.clone());
		const behindCameraPlane = cameraSpace.z >= 0;
		const distanceToFloor = Math.max(0, bounds.min.y);
		if (behindCameraPlane || bounds.isEmpty()) {
			return { id: character.id, renderable: true, behindCameraPlane, fartherAlongCameraForward: -cameraSpace.z, distanceToFloor, occludedBy: null, visiblePixelCount: 0 };
		}
		const corners = [
			new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z), new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
			new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z), new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
			new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z), new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
			new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z), new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
		].map((corner) => corner.project(camera));
		const minX = Math.max(0, Math.floor(((Math.min(...corners.map((corner) => corner.x)) + 1) * 0.5) * MCP_CAPTURE_W));
		const maxX = Math.min(MCP_CAPTURE_W - 1, Math.ceil(((Math.max(...corners.map((corner) => corner.x)) + 1) * 0.5) * MCP_CAPTURE_W));
		const minY = Math.max(0, Math.floor(((1 - Math.max(...corners.map((corner) => corner.y))) * 0.5) * MCP_CAPTURE_H));
		const maxY = Math.min(MCP_CAPTURE_H - 1, Math.ceil(((1 - Math.min(...corners.map((corner) => corner.y))) * 0.5) * MCP_CAPTURE_H));
		const occluders = new Map();
		let visiblePixelCount = 0;
		for (let y = minY; y <= maxY; y += MCP_CAPTURE_SAMPLE_STEP) {
			for (let x = minX; x <= maxX; x += MCP_CAPTURE_SAMPLE_STEP) {
				raycaster.setFromCamera({ x: (x / MCP_CAPTURE_W) * 2 - 1, y: 1 - (y / MCP_CAPTURE_H) * 2 }, camera);
				const characterHit = raycaster.intersectObject(rig, true)[0];
				if (!characterHit) continue;
				const objectHit = raycaster.intersectObjects(roots.map((entry) => entry.root), true)[0];
				const pixels = MCP_CAPTURE_SAMPLE_STEP * MCP_CAPTURE_SAMPLE_STEP;
				if (!objectHit || objectHit.distance >= characterHit.distance - 1e-4) {
					visiblePixelCount += pixels;
					continue;
				}
				const occluder = roots.find((entry) => {
					let node = objectHit.object;
					while (node) {
						if (node === entry.root) return true;
						node = node.parent;
					}
					return false;
				});
				if (occluder) occluders.set(occluder.id, (occluders.get(occluder.id) ?? 0) + pixels);
			}
		}
		const occludedBy = [...occluders.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
		return { id: character.id, renderable: true, behindCameraPlane, fartherAlongCameraForward: -cameraSpace.z, distanceToFloor, occludedBy, visiblePixelCount };
	});
	const active = assertions.find((entry) => entry.id === activeCharacterId) ?? assertions[0];
	const authoredStateAfter = JSON.stringify(readAuthoredState());
	const canvas = document.createElement("canvas");
	canvas.width = MCP_CAPTURE_W;
	canvas.height = MCP_CAPTURE_H;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("capture_frame could not encode the rendered image.");
	const image = context.createImageData(MCP_CAPTURE_W, MCP_CAPTURE_H);
	for (let row = 0; row < MCP_CAPTURE_H; row += 1) {
		image.data.set(buffer.subarray((MCP_CAPTURE_H - 1 - row) * MCP_CAPTURE_W * 4, (MCP_CAPTURE_H - row) * MCP_CAPTURE_W * 4), row * MCP_CAPTURE_W * 4);
	}
	context.putImageData(image, 0, 0);
	const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) throw new Error("capture_frame could not compress the rendered image.");
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return {
		width: MCP_CAPTURE_W,
		height: MCP_CAPTURE_H,
		mimeType: "image/png",
		encoding: "base64",
		byteSize: bytes.length,
		data: btoa(binary),
		partColours,
		authoredStateBefore,
		authoredStateAfter,
		assertions: {
			renderable: true,
			blackFrame: false,
			nonBlackPixels,
			behindCameraPlane: active?.behindCameraPlane ?? null,
			fartherAlongCameraForward: active?.fartherAlongCameraForward ?? null,
			distanceToFloor: active?.distanceToFloor ?? null,
			occludedBy: active?.occludedBy ?? null,
			visiblePixelCount: active?.visiblePixelCount ?? 0,
			characters: assertions,
		},
	};
}

/**
 * Anything that accepts a dropped picture. Returns the handlers to spread onto
 * an element and whether a drag is currently over it, so the target can say so
 * — a drop zone that gives no sign it is armed reads as a dead area, and the
 * file gets dropped on the desktop instead.
 *
 * `dragover` must preventDefault, or the browser navigates away to the file.
 */
export function useImageDrop(onFiles, onRejected) {
	const [over, setOver] = useState(false);
	const depth = useRef(0);
	const carriesFiles = (event) => !!event.dataTransfer?.types?.includes?.("Files");
	return {
		over,
		handlers: {
			onDragEnter: (event) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				depth.current += 1;
				setOver(true);
			},
			onDragOver: (event) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			},
			// dragleave fires for every child the pointer crosses, so the
			// highlight is refcounted rather than toggled.
			onDragLeave: () => {
				depth.current = Math.max(0, depth.current - 1);
				if (!depth.current) setOver(false);
			},
			onDrop: (event) => {
				const files = imageFilesFrom(event.dataTransfer);
				depth.current = 0;
				setOver(false);
				// Dropped files that are not supported images (HEIC from an iPhone
				// is the mainline case) used to die here with zero feedback — the
				// user concluded drag-and-drop was broken. Name the rejection.
				if (!files.length) {
					const dropped = event.dataTransfer?.files?.length ?? 0;
					if (dropped > 0) onRejected?.(dropped);
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				onFiles(files);
			},
		},
	};
}

/**
 * Inspector, hierarchy and viewport drop: pictures AND .glb files in one
 * gesture. A GLB must not go through `useImageDrop`, or it toasts as an
 * unsupported image even though the set can now stand it up as a mesh.
 *
 * `onRejected` fires only when the drop carried files and none of them were
 * a picture or a GLB — a mixed PNG+GLB drop imports both, and leftover
 * HEICs in that mix stay silent rather than blocking the good files.
 */
export function useStageFilesDrop({ onImages, onMeshes, onRejected } = {}) {
	const [over, setOver] = useState(false);
	const depth = useRef(0);
	const carriesFiles = (event) => !!event.dataTransfer?.types?.includes?.("Files");
	return {
		over,
		handlers: {
			onDragEnter: (event) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				depth.current += 1;
				setOver(true);
			},
			onDragOver: (event) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			},
			onDragLeave: () => {
				depth.current = Math.max(0, depth.current - 1);
				if (!depth.current) setOver(false);
			},
			onDrop: (event) => {
				const { images = [], meshes = [] } = splitDroppedFiles(event.dataTransfer);
				depth.current = 0;
				setOver(false);
				if (!images.length && !meshes.length) {
					const dropped = event.dataTransfer?.files?.length ?? 0;
					if (dropped > 0) onRejected?.(dropped);
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				void (async () => {
					if (images.length) await onImages?.(images);
					if (meshes.length) await onMeshes?.(meshes);
				})();
			},
		},
	};
}

/* ----------------------------------------------------------------- app --- */

// Unity's tool keys. They are free because camera movement now lives behind a
// held right button. (docs/unity-reference.md §9.2)
export const GIZMO_HOTKEYS = { KeyW: "move", KeyE: "rotate", KeyR: "scale" };

export const WORKSPACE_LAYOUT_KEY = "cozyclay.workspace-layout.v1";
export const DEFAULT_WORKSPACE_LAYOUT = Object.freeze({
	hierarchyWidth: 300,
	sidebarWidth: 380,
	timelineHeight: 224,
	insetWidth: 310,
	insetHeight: 310,
	insetCollapsed: false,
	planZoom: 1,
});

export function loadWorkspaceLayout() {
	// The landing-page playground is a fixed, chrome-less layout: the plan
	// inset starts folded and nothing the visitor drags is written back.
	if (isPlaygroundEmbed(globalThis.location?.search)) return { ...DEFAULT_WORKSPACE_LAYOUT, insetCollapsed: true };
	try {
		const saved = JSON.parse(localStorage.getItem(WORKSPACE_LAYOUT_KEY) || "null");
		return saved ? { ...DEFAULT_WORKSPACE_LAYOUT, ...saved } : { ...DEFAULT_WORKSPACE_LAYOUT };
	} catch {
		return { ...DEFAULT_WORKSPACE_LAYOUT };
	}
}

/** Load the Scene envelope once. Legacy single-scene objects are migrated by
 * scenes.js; App only supplies the familiar starter set for a truly new room. */
export function loadSceneStartup() {
	const defaults = () => DEFAULT_SCENE_OBJECTS.map((object) => ({ ...object, footprint: { ...object.footprint } }));
	// The landing-page playground never reads or writes the visitor's saved
	// scenes: it opens the preset the page fetched (or an empty room if that
	// fetch failed) and saving stays off for the whole session.
	if (isPlaygroundEmbed(globalThis.location?.search)) {
		const preset = takePlaygroundProject();
		const document = preset?.document ?? createSceneDocument();
		if (!preset?.document) document.scenes[0].objects = defaults();
		return { document, saveBlocked: true, error: null, startupCreatedScene: false, toast: null };
	}
	try {
		const result = loadSceneDocumentFromStorage(localStorage);
		if (result.status === "future") {
			const document = createSceneDocument();
			document.scenes[0].objects = defaults();
			return {
				document,
				saveBlocked: true,
				error: null,
				toast: ko("Saved scenes were written by a newer CozyClay — they have been left untouched and this session will not save", "저장된 장면은 더 최신 CozyClay에서 만들어졌어요. 이 세션에서는 건드리지 않고 저장도 하지 않습니다."),
			};
		}
		const document = result.document;
		if ((result.status === "absent" || result.status === "corrupt") && document.scenes[0].objects.length === 0) {
			document.scenes[0].objects = defaults();
		}
		return {
			document,
			saveBlocked: false,
			error: null,
			// The startup scene is authored silently; without this flag the
			// funnel's "scene created" step never fires for a brand-new room.
			startupCreatedScene: result.status === "absent" || result.status === "corrupt",
			toast: result.status === "corrupt"
				? ko(`Saved scenes were unreadable — starting fresh; the old data is kept under ${SCENES_QUARANTINE_KEY}`, `저장된 장면을 읽을 수 없어 새로 시작합니다. 기존 데이터는 ${SCENES_QUARANTINE_KEY}에 보관했어요.`)
				: result.dropped > 0
					? (isKo ? `저장된 장면 ${result.dropped}개를 복원하지 못했어요` : `${result.dropped} saved scene(s) could not be restored`)
					: null,
		};
	} catch {
		const document = createSceneDocument();
		document.scenes[0].objects = defaults();
		return { document, saveBlocked: false, error: null, startupCreatedScene: true, toast: null };
	}
}

/* ------------------------- IK-mode motion trails --------------------------
 * World-space trajectory polylines of the loaded take: the selected track,
 * or all tracks when the user asks for an overview. The whole clip is
 * drawn as a faint line; while a grab is active the falloff window is
 * re-drawn on top as a bright highlight. Grabbing any point of a line starts
 * a drag on a camera-facing plane through the grab point; the caller deforms
 * the take (motion-trail.js falloff math) so the preview updates live. */
export const MotionTrails = memo(function MotionTrails({ motion, rig = null, baseY, charScale, ikFocus, activeTrackId = null, falloffFrames, playheadFrame, pendingEdit, enabled, visible = true, onDragStart, onDragPreview, onDragEnd }) {
	const { camera, gl, invalidate } = useThree();
	const [drag, setDrag] = useState(null);
	const callbacksRef = useRef({ onDragStart, onDragPreview, onDragEnd });
	callbacksRef.current = { onDragStart, onDragPreview, onDragEnd };
	const toTriples = (flat) => {
		if (!flat) return null;
		const out = [];
		for (let index = 0; index + 2 < flat.length; index += 3) out.push([flat[index], flat[index + 1], flat[index + 2]]);
		return out;
	};
	// Every trail track (root + IK endpoints + head) in its handle colour,
	// sampled where playback renders each bone on this rig (not the clip's
	// own joints, which sit 4-15 cm off the body), so draw and pick agree.
	const tracks = useMemo(
		() => TRAIL_TRACKS.map((track) => {
			const flat = jointTrailPoints(motion, track.joint, { baseY, scale: charScale, rig });
			return flat ? { ...track, flat, points: toTriples(flat) } : null;
		}).filter(Boolean),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[motion, rig, baseY, charScale],
	);
	const trackById = (id) => tracks.find((track) => track.id === id) ?? null;
	const focusTrack = activeTrackId ? tracks.find((track) => track.id === activeTrackId)?.id ?? null : null;
	const visibleTracks = focusTrack ? tracks.filter((track) => track.id === focusTrack) : tracks;
	// The falloff window rides whichever line is being (or was last) grabbed.
	const highlightCandidate = drag ?? pendingEdit;
	const highlight = highlightCandidate && (!focusTrack || highlightCandidate.track === focusTrack) ? highlightCandidate : null;
	const highlightPoints = useMemo(() => {
		if (!highlight || !motion?.frames) return null;
		const flat = trackById(highlight.track)?.flat ?? trackById("hips")?.flat;
		if (!flat) return null;
		const { startFrame, endFrame } = trailEditRange(motion.frames, highlight.grabFrame, falloffFrames);
		const out = [];
		for (let frame = startFrame; frame < endFrame; frame += 1) {
			out.push([flat[frame * 3], flat[frame * 3 + 1], flat[frame * 3 + 2]]);
		}
		return out.length > 1 ? out : null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [highlight, motion, tracks, falloffFrames]);

	// Manual capture-phase picking instead of r3f pointer handlers: handlers on
	// a drei Line make react-three-fiber raycast the fat-line shader geometry on
	// EVERY pointermove for hover bookkeeping, which is exactly the IK-mode lag.
	// A single pointerdown listener that measures point-to-ray distance against
	// the cached trail arrays costs nothing while the mouse merely moves.
	const pickRef = useRef(null);
	pickRef.current = { tracks: visibleTracks, enabled, falloffFrames, playheadFrame };
	// Line2 instances for in-place geometry rewrites during a drag.
	const lineRefs = useRef({});
	const highlightRef = useRef(null);
	useEffect(() => {
		const dom = gl.domElement;
		const raycaster = new THREE.Raycaster();
		const hit = new THREE.Vector3();
		const down = (event) => {
			const pick = pickRef.current;
			if (!pick?.enabled || event.button !== 0) return;
			const rect = dom.getBoundingClientRect();
			const ndc = new THREE.Vector2(
				((event.clientX - rect.left) / rect.width) * 2 - 1,
				-((event.clientY - rect.top) / rect.height) * 2 + 1,
			);
			raycaster.setFromCamera(ndc, camera);
			const { origin, direction } = raycaster.ray;
			const picked = pickTrailPoint({
				tracks: pick.tracks,
				playheadFrame: pick.playheadFrame,
				falloffFrames: pick.falloffFrames,
				rayOrigin: origin,
				rayDirection: direction,
				maxDistance: 0.2,
			});
			if (!picked) return;
			const { track, grabFrame } = picked;
			// The grab wins over the camera controls listening in the bubble phase.
			event.stopPropagation();
			event.preventDefault();
			const flat = pick.tracks.find((candidate) => candidate.id === track)?.flat;
			if (!flat) return;
			const start = new THREE.Vector3(flat[grabFrame * 3], flat[grabFrame * 3 + 1], flat[grabFrame * 3 + 2]);
			const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
			const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
			setDrag({ track, grabFrame });
			callbacksRef.current.onDragStart?.({ track, grabFrame });
			// The drag never touches React state: per rAF the grabbed line and the
			// falloff highlight are rewritten in place on their Line2 geometries,
			// and onDragPreview poses the rig imperatively. Re-rendering the whole
			// app per pointermove is exactly the drag lag this avoids; the real
			// commit (setMotion + pending edit) happens once, on pointerup.
			const frames = flat.length / 3;
			const { startFrame, endFrame } = trailEditRange(frames, grabFrame, pickRef.current.falloffFrames);
			const deformedFlat = new Float32Array(flat);
			const windowFlat = new Float32Array((endFrame - startFrame) * 3);
			let lastDelta = null;
			let queued = null;
			let rafId = 0;
			const applyPreview = (delta) => {
				for (let frame = startFrame; frame < endFrame; frame += 1) {
					const weight = falloffWeight(frame - grabFrame, pickRef.current.falloffFrames);
					deformedFlat[frame * 3] = flat[frame * 3] + delta.x * weight;
					deformedFlat[frame * 3 + 1] = flat[frame * 3 + 1] + delta.y * weight;
					deformedFlat[frame * 3 + 2] = flat[frame * 3 + 2] + delta.z * weight;
				}
				windowFlat.set(deformedFlat.subarray(startFrame * 3, endFrame * 3));
				lineRefs.current[track]?.geometry?.setPositions(deformedFlat);
				highlightRef.current?.geometry?.setPositions(windowFlat);
				callbacksRef.current.onDragPreview?.({ track, grabFrame, delta });
				invalidate();
			};
			const flush = () => {
				rafId = 0;
				if (queued) applyPreview(queued);
				queued = null;
			};
			const move = (pointerEvent) => {
				const moveRect = dom.getBoundingClientRect();
				const moveNdc = new THREE.Vector2(
					((pointerEvent.clientX - moveRect.left) / moveRect.width) * 2 - 1,
					-((pointerEvent.clientY - moveRect.top) / moveRect.height) * 2 + 1,
				);
				raycaster.setFromCamera(moveNdc, camera);
				if (!raycaster.ray.intersectPlane(plane, hit)) return;
				lastDelta = { x: hit.x - start.x, y: hit.y - start.y, z: hit.z - start.z };
				queued = lastDelta;
				if (!rafId) rafId = requestAnimationFrame(flush);
			};
			const up = () => {
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				if (rafId) cancelAnimationFrame(rafId);
				if (queued) applyPreview(queued);
				setDrag(null);
				callbacksRef.current.onDragEnd?.({ track, grabFrame, delta: lastDelta });
			};
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", up);
		};
		dom.addEventListener("pointerdown", down, true);
		return () => dom.removeEventListener("pointerdown", down, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [gl, camera]);

	if (!tracks.length) return null;
	// depthTest off + high renderOrder: the trails read through the character
	// and the floor instead of vanishing into them. Every part rides its own
	// IK-handle colour; the focused part draws thicker.
	return (
		<group
			visible={visible}
			renderOrder={900}
			userData={{ editorOverlay: true }}
			ref={(group) => {
				// QA-only escape hatch (same spirit as window.__cozyclay): lets
				// headless perf probes toggle the trails without a rebuild.
				if (typeof window !== "undefined") {
					window.__cozyclayTrails = group;
					window.__cozyclayVisibleTrailTracks = visibleTracks.map((track) => track.id);
				}
			}}
		>
			{visibleTracks.map((track) => track.points.length > 1 && (
				<Line
					key={track.id}
					ref={(line) => {
						if (line) lineRefs.current[track.id] = line;
						else delete lineRefs.current[track.id];
					}}
					points={track.points}
					color={track.color}
					lineWidth={track.id === focusTrack ? 4 : 2.5}
					depthTest={false}
					transparent
					opacity={track.id === focusTrack ? 1 : 0.85}
				/>
			))}
			{highlightPoints && (
				<Line ref={highlightRef} points={highlightPoints} color={drag ? "#3dff7a" : "#ff8c42"} lineWidth={5} depthTest={false} />
			)}
		</group>
	);
}, (previous, next) => (
	previous.motion === next.motion &&
	previous.rig === next.rig &&
	previous.baseY === next.baseY &&
	previous.charScale === next.charScale &&
	previous.ikFocus === next.ikFocus &&
	previous.activeTrackId === next.activeTrackId &&
	previous.falloffFrames === next.falloffFrames &&
	previous.playheadFrame === next.playheadFrame &&
	previous.pendingEdit === next.pendingEdit &&
	previous.enabled === next.enabled &&
	previous.visible === next.visible
));
