import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { generate as ardyGenerate } from "./ardy/client.js";
import { fitAspect } from "./dualview.jsx";
import { TIMELINE_FPS, LINE_CURVE_MARKER_STRIDE, LINE_CURVE_REFUSALS, LINE_EDIT_DEFAULT_TRACK, LINE_EDIT_REFUSALS, LINE_PREVIEW_DEBOUNCE_MS } from "./app-stage.jsx";
import { ko, isKo } from "./locale.js";
import { TRAIL_EFFECTOR_JOINTS, jointTrailPoints } from "./motion-trail.js";
import { CURVE_GRAB_RADIUS_PX, DRAG_RADIUS_DEFAULT, DRAG_RADIUS_MAX, DRAG_RADIUS_MIN, DRAG_WEIGHT_EPSILON, DRAW_MIN_STROKE_POINTS, DRAW_MIN_STROKE_PX, MAX_LINE_POINTS, MIN_LINE_POINTS, cameraDrifted, cameraToC6, changedFrameRange, curveToPoints2d, curvesEqual, dragCurve, dragWeight, isCurveEndPinned, isCurvePointOnScreen, nearestCurvePoint, projectTrailCurve, projectPointC6, reprojectCurveWorld, drawStrokeEdit, unprojectDeltaC6, pinsFrameRange, upsertPin, validateLineEdit, sliceCurveToRange } from "./line-edit.js";

export function useLineEdit({ motion, activeChar, tlFrame, ikMode, playMode, preview, lookThroughShot, planIsMain, mainPaneRef, stageRef, shotCamRef, editorCamRef, shotOutput, bridge, lineEditBackend, ardyRunning, takeSeed, loadMotion, setToast, waypointMode, setWaypointMode, leaveIkMode, posing, setPosing, setTlFrame, bridgeRefreshRef, ardyGenerate }) {
	/* ------------------------------ line editing ---------------------------
	 * Contract C6. A modal editing surface exactly like waypointMode above,
	 * but it works in SCREEN space on a 2D overlay canvas rather than raycast
	 * onto the floor — depth is the model's problem, not the UI's.
	 *
	 * TWO GESTURES, ONE CURVE. The primary interaction is TRAJECTORY DRAGGING:
	 * the joint's existing path is projected onto the viewport and the user
	 * grabs a point on it and pulls, with a Gaussian falloff carrying the
	 * neighbours along. A press that lands nowhere near the path instead DRAWS
	 * one freehand (drawStrokeEdit), because a trail can project into a few
	 * screen pixels — a person backing up and falling barely moves the hand
	 * across the image — and with nothing grabbable the whole mode reads as
	 * dead. Drawing is not the old freehand tool coming back, though: that one
	 * popped the take 8x its own frame delta at the range edges because the
	 * joint teleported to wherever the stroke began (gate GP2). A stroke here is
	 * MATCHED BACK ONTO THE TRAIL — its endpoints pick the frames it was drawn
	 * over, and those frames become the edit's range — so it reroutes the stretch
	 * of path it covers, replays it with that stretch's own velocity profile, and
	 * eases out of the original trajectory at both seams. See the block comment
	 * above matchStrokeWindow in line-edit.js for why all three are one decision.
	 * A drag pins its ends instead (its Gaussian already eases), and both
	 * gestures produce the SAME dense frame-indexed curve, so everything
	 * downstream (preview, undo, camera drift, the wire payload) cannot tell them
	 * apart — except that a drawn curve also carries the `frameRange` it chose.
	 *
	 * `lineCurve` is non-null EXACTLY WHEN THERE IS AN EDIT, and that invariant
	 * is the whole camera policy in one sentence. Null means the curve is
	 * re-projected from the LIVE camera on every repaint, so orbiting the view
	 * carries the path along and navigation never fights the mode. Non-null is
	 * `{ camera, original, edited }` — one object, because a pull is a 2D offset
	 * that only means something through the lens it was authored with, so the
	 * camera is frozen beside the points and travels with them onto the wire.
	 * Moving the view therefore does NOT drop the pull; it only stops the line
	 * being drawable here (see lineDrifted just below, and the watcher further
	 * down).
	 *
	 * The four refs never re-render: `lineDragRef` is the in-flight grab and
	 * carries the live deformed curve, `lineDrawRef` is the in-flight freehand
	 * stroke, `lineLiveRef` caches the last projection the painter made so the
	 * hit test does not redo it, and `lineHoverRef` is the marker under the
	 * pointer. A pointermove must repaint the overlay
	 * without re-rendering an 11k-line component 200 times a second, so the
	 * painter reads the refs and only pointerup commits to state. */
	const [lineEditMode, setLineEditMode] = useState(false);
	const [lineTrack, setLineTrack] = useState(LINE_EDIT_DEFAULT_TRACK);
	// null means "the whole clip" — resolved against the loaded take at use
	// time so loading a different clip cannot leave a stale range behind.
	const [lineRange, setLineRange] = useState(null);
	const [lineCurve, setLineCurve] = useState(null);
	/* THE VIEW HAS MOVED, AND THE EDIT IS STILL HERE.
	 *
	 * A committed curve carries its OWN camera (the `{ camera, original, edited }`
	 * above), and buildLineEditRequest sends that snapshot — so a later orbit,
	 * fly or shot switch cannot invalidate the pending edit, its preview or the
	 * confirming run. What it invalidates is only the ALIGNMENT of the painted
	 * overlay: the uv were authored through one lens, there is no depth to
	 * reproject them with, and drawing them over a different view would put the
	 * line somewhere the artist never aimed. So drift is a PRESENTATION state,
	 * not a destruction trigger — the curve is painted detached (ghosted, no
	 * grab handles), the panel says so, and a NEW gesture is refused because it
	 * would mix two cameras into one curve. Come back toward the snapshot and the
	 * line paints normally again.
	 *
	 * The ref is what the pointer handlers and the painter read (a poll is 250 ms
	 * stale and a press must not be); the state is what re-renders the panel. */
	const [lineDrifted, setLineDrifted] = useState(false);
	const lineDriftRef = useRef(false);
	/* ------------------------------ 3D pins --------------------------------
	 * The THIRD gesture: scrub to a moment, grab the joint where it is, put it
	 * where it should be. Entries are `{ frame, position: [x, y, z] }` in the
	 * TAKE's own clip space (worldPointToClip converts on commit), ascending by
	 * frame, capped at LINE_EDIT_PINS_MAX — exactly the C6 `pins3d` payload, so
	 * the panel state and the wire object are the same value.
	 *
	 * ONE EDIT IS ONE GESTURE (v1). A pin clears the curve and a stroke or drag
	 * clears the pins, because a 2D path and a set of 3D points are two answers
	 * to "where does this joint go" and the box would be asked to average them.
	 * Combining them is a real feature (pin the extremes, draw the arc between)
	 * and it needs a story about which one owns a frame they both name — that
	 * story is not written, so the modes are exclusive and say so.
	 *
	 * `linePinMode` is the stage's gesture selector rather than a modifier key:
	 * pressing on the joint's own marker is ALSO how a curve drag starts, so the
	 * two cannot share a press, and a modal toggle beside the joint picker is
	 * discoverable in a way a chord is not. */
	const [linePins, setLinePins] = useState([]);
	const [linePinMode, setLinePinMode] = useState(false);
	// The in-flight pin drag. Same no-re-render discipline as lineDragRef: a
	// pointermove writes the ref and repaints the overlay, only pointerup
	// commits to state.
	const linePinDragRef = useRef(null);
	const [lineRadius, setLineRadius] = useState(DRAG_RADIUS_DEFAULT);
	const lineDragRef = useRef(null);
	// The in-flight freehand STROKE, when the press missed the curve. Same
	// no-re-render discipline as lineDragRef: pointermove appends a uv sample and
	// repaints the overlay, and only pointerup turns the stroke into a curve (via
	// strokeToCurve) and commits it through the drag's own pipeline.
	const lineDrawRef = useRef(null);
	// The range a DRAW just auto-matched into the panel. "Switching the range
	// drops the pull in hand" is the right rule for a range the ARTIST typed —
	// the pull was authored against a trajectory that is no longer on screen —
	// but a drawn stroke authors its range and its curve in the same gesture,
	// and letting that rule fire on the range the draw itself installed would
	// wipe the drawing on commit and cancel its preview. One-shot: the effect
	// consumes it.
	const lineAutoRangeRef = useRef(null);
	const lineLiveRef = useRef(null);
	const lineHoverRef = useRef(null);
	// Undo stack for committed pulls: each entry is the WHOLE lineCurve value
	// that a commit replaced (null = "no edit yet"), so Ctrl/Cmd+Z is a plain
	// pop-and-restore. A camera move no longer touches it: an edit survives the
	// view moving, so the pulls behind it are still meaningful too, and undo is
	// one of the three things (with reset and Generate) that must keep working
	// while the view has drifted away from the line.
	const lineUndoRef = useRef([]);
	const lineOverlayRef = useRef(null);

	/* ------------------ live preview of a pull (contracts C10/C11) ------------
	 * Releasing the drag fires a FULL-QUALITY run of the same edit (same steps
	 * and session seed as Generate, ~2 s on the warm resident, so the draft and
	 * the confirmed take are bit-identical) and swaps the VIEWPORT to it, so
	 * the artist judges the correction by watching it move instead of by
	 * reading a curve. Three rules make that honest:
	 *
	 *   1. A PREVIEW IS A PICTURE, NOT A TAKE. It never pushes a version, never
	 *      touches the recipe and never becomes anyone's sourceMotion. The take
	 *      being edited is `takeSourceUrl` — remembered here the moment a
	 *      preview starts — and `motion.url` is merely what is on screen.
	 *   2. ONE SEED PER EDITING SESSION. A draft rendered with a different seed
	 *      predicts nothing, so the seed is rolled once (first preview or the
	 *      confirming run, whichever comes first), reused by every preview, SENT
	 *      by the full-quality run, and only then re-rolled. A typed seed is
	 *      already constant, so the rule costs nothing there.
	 *   3. SUPERSEDE, NEVER STACK. At most one request is in flight; a drag
	 *      that lands while one is out replaces the pending curve, and the older
	 *      answer is dropped on arrival. Queueing them would make the viewport
	 *      replay a history the artist has already moved past.
	 *
	 * Undo, reset and leaving the mode all revert the viewport to the source take
	 * and discard whatever is in flight. A CAMERA MOVE does not: the draft is a
	 * picture of an edit that survives the view moving, so it stays on screen and
	 * stays confirmable. */
	const [linePreviewSource, setLinePreviewSource] = useState(null);
	const linePreviewSourceRef = useRef(null);
	// The preview motionUrl currently ON SCREEN — null means the source take is.
	const [linePreviewUrl, setLinePreviewUrl] = useState(null);
	const [linePreviewBusy, setLinePreviewBusy] = useState(false);
	const [linePreviewError, setLinePreviewError] = useState("");
	// Round trip of the last preview, in ms. Surfaced because "is this loop
	// actually live?" is the question the number answers in one glance.
	const [linePreviewMs, setLinePreviewMs] = useState(0);
	const linePreviewSeedRef = useRef(null);
	// Monotonic: a result whose token is stale was superseded or cancelled, and
	// is discarded without ever reaching the viewport.
	const linePreviewTokenRef = useRef(0);
	const linePreviewAbortRef = useRef(null);
	const linePreviewPendingRef = useRef(null);
	const linePreviewTimerRef = useRef(0);
	// The draft that actually REACHED the viewport, so a cancel knows whether
	// there is anything to put back.
	const linePreviewShownRef = useRef(null);
	/* ======================= line editing (contract C6) =======================
	 * Grab the joint's own motion path on the viewport and pull it; the joint
	 * then follows the pulled path exactly.
	 *
	 * Four invariants hold this together and every function below serves one
	 * of them:
	 *   1. THE CURVE AND THE CAMERA ARE ONE OBJECT. uv only mean something
	 *      through the lens they were projected with, so the camera is captured
	 *      when the curve is built, stored next to it, and the pair is rebuilt
	 *      together when the view moves. Nothing re-reads old uv through a new
	 *      lens.
	 *   2. THE EDIT IS A DEFORMATION OF THE TAKE, NOT A REPLACEMENT OF IT. The
	 *      curve starts as the joint's current trajectory and the falloff pins
	 *      its ends there, so the first and last constrained frames always
	 *      agree with the take. That is the seam fix GP2 measured: 8.0x median
	 *      frame delta for an arbitrary line, 1.09x when the ends sit on the
	 *      joint's own path.
	 *   3. THE OVERLAY NEVER TOUCHES THE SCENE GRAPH. It is a plain 2D canvas
	 *      stacked on the stage, so an edit cannot disturb playback, picking
	 *      or the render loop, and it works identically in every view mode.
	 *   4. THE REQUEST IS ITS OWN RUN. C6 makes lineEdit exclusive with
	 *      preserve/waypoints/segments/motionEdit, so runLineEdit builds a
	 *      dedicated body instead of decorating runArdy's. The WIRE SHAPE is
	 *      untouched by the interaction change: points2d is still a <=64-point
	 *      viewport-normalized polyline. */

	/** The loaded take's length on the TIMELINE clock — C6's frameRange is in
	 * app clip frames and, unlike waypoints or motionEdit, is never converted
	 * to the bridge clock. */
	const lineClipFrames = motion?.frames ?? 0;
	/** THE TAKE, as opposed to what is on screen. While a line-edit preview is
	 * showing, `motion` is the draft and this is still the take the draft was
	 * drafted FROM — so an edit sources the take, the version strip keeps
	 * highlighting the take's own chip, and a preview can never quietly become
	 * the thing everything else is built on. With no preview the two are the
	 * same url, which is why every call site can read this one unconditionally. */
	const takeSourceUrl = linePreviewSource?.url ?? motion?.url ?? null;
	/** The authored range, or the whole clip when the user has not narrowed it.
	 * Re-derived rather than stored so loading a different take cannot leave a
	 * range pointing past the end of the new one. */
	const lineEditRange = useMemo(() => {
		if (!(lineClipFrames > 1)) return null;
		const start = Math.max(0, Math.min(lineRange?.startFrame ?? 0, lineClipFrames - 2));
		const end = Math.max(start + 2, Math.min(lineRange?.endFrame ?? lineClipFrames, lineClipFrames));
		return { startFrame: start, endFrame: end };
	}, [lineRange, lineClipFrames]);

	/* ---------------------------- the pins edit -----------------------------
	 * A pins edit is derived, not stored: the pins ARE the payload and the range
	 * follows from them (pinsFrameRange), so there is no second copy of either
	 * to keep in sync. `lineEditPayload` is what every downstream call site
	 * takes — Generate, the preview, the request builder — and it is the one
	 * place the two gestures meet. */
	const linePinRange = useMemo(
		() => (linePins.length ? pinsFrameRange(linePins, lineClipFrames) : null),
		[linePins, lineClipFrames],
	);
	const linePinEdit = useMemo(
		() => (linePins.length && linePinRange ? { pins: linePins, frameRange: linePinRange } : null),
		[linePins, linePinRange],
	);
	/** The edit in hand, whichever gesture made it. Null means "nothing to
	 * send", which is exactly what the Generate gate asks. */
	const lineEditPayload = lineCurve ?? linePinEdit;

	/** The joint's WORLD position at one frame, from the same trail sampler the
	 * curve is projected from — so a pin and the curve can never disagree about
	 * where the joint is. Null when there is no take, no trail or no such
	 * frame. */
	function lineJointWorldAt(frame) {
		const jointName = TRAIL_EFFECTOR_JOINTS[lineTrack];
		if (!motion || !jointName) return null;
		const trail = jointTrailPoints(motion, jointName, { baseY: activeChar.y ?? 0, scale: activeChar.scale ?? 1 });
		const index = Math.max(0, Math.min(Math.trunc(frame) || 0, motion.frames - 1));
		if (!trail || index * 3 + 2 >= trail.length) return null;
		return [trail[index * 3], trail[index * 3 + 1], trail[index * 3 + 2]];
	}

	/** Every pin as a WORLD point, for the overlay. Pins are stored in clip
	 * space (that is what the wire wants); drawing them means undoing the
	 * conversion, which is jointTrailPoints' own transform applied to one
	 * point. Kept here rather than storing both spellings: two stored copies of
	 * a coordinate is how a pin ends up drawn somewhere it was not placed. */
	function linePinWorld(pin) {
		if (!motion) return null;
		const basis = { baseY: activeChar.y ?? 0, scale: activeChar.scale ?? 1 };
		// Forward transform, mirroring motion-trail's jointTrailPoints.
		const clipToWorld = (p) => {
			const radians = ((Number.isFinite(motion.rotationDeg) ? motion.rotationDeg : 0) * Math.PI) / 180;
			const cos = Math.cos(radians);
			const sin = Math.sin(radians);
			const anchorFrame = Math.max(0, Math.min(motion.anchorFrame || 0, Math.max(0, motion.frames - 1)));
			const rootX = motion.posedJoints?.[anchorFrame * 27 * 3] ?? 0;
			const rootZ = motion.posedJoints?.[anchorFrame * 27 * 3 + 2] ?? 0;
			const anchorX = Number.isFinite(motion.anchorX) ? motion.anchorX : 0;
			const anchorZ = Number.isFinite(motion.anchorZ) ? motion.anchorZ : 0;
			const dx = p[0] - rootX;
			const dz = p[2] - rootZ;
			return [
				anchorX + (dx * cos + dz * sin) * basis.scale,
				basis.baseY + p[1] * basis.scale,
				anchorZ + (-dx * sin + dz * cos) * basis.scale,
			];
		};
		return clipToWorld(pin.position);
	}

	/** Drop the pins, and say so. Called when a stroke or a drag commits — the
	 * two gestures are exclusive, and a silently discarded pin is worse than a
	 * refused one. */
	function clearLinePins({ toast = true } = {}) {
		if (!linePins.length) return;
		setLinePins([]);
		if (toast) {
			setToast(ko(
				"Pins cleared — one edit is one gesture, and this one is now the path",
				"찍은 순간을 지웠어요 — 한 번의 편집은 한 가지 방식이라, 지금은 궤적 편집이에요",
			));
		}
	}

	/** Has the user pulled anything yet? The Generate gate, and the reason the
	 * panel can say "pull first" instead of shipping a no-op edit. It is just
	 * the state's existence: pointerup installs a curve only when the pull
	 * actually moved something and clears it otherwise, so "there is a curve
	 * object" and "there is an edit" are the same fact. */
	const lineCurveDirty = !!lineEditPayload;
	/** Frames of the range whose joint has no image (behind the lens or out of
	 * frame). Those points cannot be grabbed and are dropped from the payload,
	 * so the count is worth showing rather than leaving as a mystery gap. */
	const lineCurveHidden = useMemo(
		() => (lineCurve ? lineCurve.original.reduce((count, point) => count + (isCurvePointOnScreen(point) ? 0 : 1), 0) : 0),
		[lineCurve],
	);
	/** How many points the box will actually receive — the curve is downsampled
	 * to MAX_LINE_POINTS, and seeing the number keeps "64" from being a
	 * surprise buried in the contract. */
	const lineCurvePointCount = useMemo(
		() => (lineCurve ? Math.min(MAX_LINE_POINTS, lineCurve.original.length - lineCurveHidden) : 0),
		[lineCurve, lineCurveHidden],
	);
	/** The frames the edit in hand actually covers. A DRAWN curve carries the
	 * window its stroke matched (which is also what goes on the wire); a dragged
	 * one has always covered the panel's range. Shown rather than left implicit
	 * because auto-ranging means the artist did not choose these numbers and
	 * deserves to see what the stroke was read as. endFrame is exclusive on the
	 * wire and inclusive to a human, hence the -1. */
	const lineEditFrom = lineCurve?.frameRange?.startFrame ?? lineEditRange?.startFrame ?? 0;
	const lineEditTo = (lineCurve?.frameRange?.endFrame ?? lineEditRange?.endFrame ?? 0) - 1;

	/** Change the influence radius. A live drag is re-derived from its snapshot
	 * rather than left showing the old falloff, which is what makes the slider
	 * legible: drag, then widen, and the same pull spreads under the finger. */
	function changeLineRadius(next) {
		const radius = Math.max(DRAG_RADIUS_MIN, Math.min(DRAG_RADIUS_MAX, Math.round(Number(next) || 0)));
		setLineRadius(radius);
		const drag = lineDragRef.current;
		if (!drag) return;
		// The drag carries its own radius so the window-level pointermove (which
		// closed over the value at grab time) keeps agreeing with what is drawn.
		drag.radius = radius;
		drag.live = dragCurve(drag.snapshot, drag.index, drag.du, drag.dv, radius);
	}

	/** Which camera actually draws the MAIN pane right now, and the exact
	 * rectangle it draws into.
	 *
	 * This mirrors DualRender's own branch order on purpose: the pane holds
	 * different cameras in different modes, and the letterboxed shot views draw
	 * into a fitAspect sub-rect rather than the whole pane. Measuring the curve
	 * against the pane instead of the IMAGE would shift every point by the
	 * width of the black bars. Plan and IK views return null — the plan camera
	 * is orthographic (no pinhole intrinsics to send) and IK mode is mutually
	 * exclusive with this one anyway. Rects are in CLIENT coordinates, which is
	 * what pointer events speak. */
	function lineEditPane() {
		const pane = mainPaneRef.current;
		if (!pane) return null;
		const box = pane.getBoundingClientRect();
		if (!(box.width >= 2 && box.height >= 2)) return null;
		const rect = { x: box.left, y: box.top, w: box.width, h: box.height };
		if (planIsMain || ikMode) return null;
		if (playMode || lookThroughShot) {
			const camera = shotCamRef.current;
			return camera ? { camera, rect: fitAspect(rect, shotOutput.aspect) } : null;
		}
		const camera = editorCamRef.current;
		return camera ? { camera, rect } : null;
	}

	/** Freeze the pane's camera into the C6 block. Returns null rather than
	 * throwing when the camera is not a settled perspective camera — a refusal
	 * here means "do not send", never "send something approximate". */
	function captureLineCamera(pane) {
		const camera = pane?.camera;
		if (!camera?.isPerspectiveCamera) return null;
		camera.updateMatrixWorld();
		const inverse = new THREE.Matrix4().copy(camera.matrixWorld).invert();
		try {
			return cameraToC6({
				fovDeg: camera.fov,
				aspect: camera.aspect,
				matrixWorldInverse: [...inverse.elements],
				width: pane.rect.w,
				height: pane.rect.h,
			});
		} catch (err) {
			// The only way here is a pane whose aspect disagrees with the
			// projection matrix, i.e. a frame drawn before DualRender settled.
			// Refusing is correct; the next paint or pointerup retries.
			console.warn("line edit: camera capture refused —", err.message);
			return null;
		}
	}

	/** Has the live view moved out from under a COMMITTED edit?
	 *
	 * The comparison is the same cameraDrifted the old watcher used; what changed
	 * is what a `true` MEANS. It is not "this edit is invalid" — the edit carries
	 * the lens it was authored through and goes on the wire with it, so it stays
	 * exactly as applicable as it was. It is "the painted line can no longer be
	 * drawn where it belongs", because reprojecting the edited uv through the new
	 * camera would need a depth that a 2D edit does not have.
	 *
	 * Called both from the 4 Hz watcher (which owns the panel's state) and
	 * synchronously at pointerdown (which cannot afford to be a quarter second
	 * behind) — one spelling, so the paint, the hint and the refusal can never
	 * disagree about which state the mode is in. */
	function lineCurveDrifted(pane, edit = lineCurve) {
		if (!edit) return false;
		const live = captureLineCamera(pane);
		// An unmeasurable pane is not a moved view — a frame drawn before
		// DualRender settled must not flicker the line out or refuse a press.
		if (!live) return lineDriftRef.current;
		return cameraDrifted(live, edit.camera);
	}

	/** The one sentence the drifted state says — in the panel, and in the toast
	 * that refuses a new gesture. ONE spelling, because a hint that disagreed
	 * with the refusal would read as two different problems. */
	function lineDriftHint() {
		return ko(
			"The view moved — the pending edit still applies; the dashed line is that same edit seen from here. Return toward the original view to grab it again, or Generate/undo from here.",
			"시점이 움직였어요 — 편집한 궤적은 그대로 적용되며, 점선은 같은 궤적을 지금 시점에서 본 모습입니다. 다시 잡으려면 원래 시점 쪽으로 돌아가고, 지금 이 상태에서 생성하거나 되돌려도 됩니다.",
		);
	}

	/** The drifted ghost, RE-ANCHORED: lift the committed edit into world space
	 * with the trail's own per-frame depth and see it through the LIVE lens, so
	 * the dashed line hugs the trajectory instead of floating wherever the old
	 * uv happen to land in the new view. Returns null when the trip cannot be
	 * made (no live lens yet, no motion, a pins-only edit with no curves) — the
	 * caller then paints the authored uv as before, which is at least honest
	 * about being stale. Runs per frame like the rest of the painter; it is the
	 * same few hundred pinhole projections projectLineCurve already pays. */
	function reprojectDriftedEdit(pane, edit) {
		const live = captureLineCamera(pane);
		const jointName = TRAIL_EFFECTOR_JOINTS[lineTrack];
		if (!live || !jointName || !motion) return null;
		const trail = jointTrailPoints(motion, jointName, { baseY: activeChar.y ?? 0, scale: activeChar.scale ?? 1 });
		if (!trail) return null;
		const original = reprojectCurveWorld(edit.original, trail, edit.camera, live);
		const edited = reprojectCurveWorld(edit.edited, trail, edit.camera, live);
		if (!original || !edited) return null;
		return { original, edited };
	}

	/** Project the joint's trail for the current track and range through the
	 * pane's LIVE camera. `{ camera, curve }`, or null when the view cannot
	 * supply a usable lens right now — a refusal means "no curve", never "a
	 * curve through some other camera".
	 *
	 * Deliberately the same sampler and the same arguments the old ghost line
	 * used (jointTrailPoints + TRAIL_EFFECTOR_JOINTS), so the curve the user
	 * grabs is the trajectory they were previously told to trace by hand.
	 *
	 * Cheap ON PURPOSE: while nothing has been pulled this runs once per
	 * animation frame, and that is exactly what lets the path FOLLOW the camera
	 * instead of fighting it. A few hundred pinhole projections is nothing
	 * beside the WebGL frame it is drawn over. */
	function projectLineCurve(pane, { camera: reuseCamera = null, frameRange = null } = {}) {
		if (!pane || !motion) return null;
		const range = frameRange ?? lineEditRange;
		if (!range) return null;
		const camera = reuseCamera ?? captureLineCamera(pane);
		const jointName = TRAIL_EFFECTOR_JOINTS[lineTrack];
		if (!camera || !jointName) return null;
		const trail = jointTrailPoints(motion, jointName, { baseY: activeChar.y ?? 0, scale: activeChar.scale ?? 1 });
		if (!trail) return null;
		const curve = projectTrailCurve({ trail, frameRange: range, camera });
		if (!curve || curve.length < MIN_LINE_POINTS) return null;
		return { camera, curve };
	}

	/** Repaint the whole overlay from scratch: the drawable frame, the joint's
	 * ORIGINAL trajectory as a faint reference once there is something to
	 * compare it against, the EDITED (or live) curve as the hero with its
	 * draggable markers, and — while a grab is live — the span the falloff is
	 * actually moving. Cheap enough to run per pointermove and stateless, so
	 * there is no partial-repaint bug class to have.
	 *
	 * This is also where the "follow the camera" half of the camera policy
	 * lives: with no edit in hand the curve is re-projected from the CURRENT
	 * lens every frame, so orbiting drags the path around with the render. The
	 * projection is cached in lineLiveRef for the hit test, which therefore
	 * never has to re-derive what was just drawn. */
	function paintLineOverlay() {
		const canvas = lineOverlayRef.current;
		const stage = stageRef.current;
		if (!canvas || !stage) return;
		const stageBox = stage.getBoundingClientRect();
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const width = Math.max(1, Math.round(stageBox.width));
		const height = Math.max(1, Math.round(stageBox.height));
		if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
			canvas.width = Math.round(width * dpr);
			canvas.height = Math.round(height * dpr);
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		const pane = lineEditPane();
		if (!pane) {
			lineLiveRef.current = null;
			return;
		}
		// Stage-relative, because the canvas is stretched over the stage while
		// the pane rect is measured in client coordinates.
		const ox = pane.rect.x - stageBox.left;
		const oy = pane.rect.y - stageBox.top;

		// The drawable frame: the letterboxed shot views draw into less than the
		// full pane, and a curve point outside this box is outside 0..1 and
		// cannot be sent. Saying so with a border beats clamping silently.
		ctx.save();
		ctx.setLineDash([6, 5]);
		ctx.strokeStyle = "rgba(255, 255, 255, .35)";
		ctx.lineWidth = 1;
		ctx.strokeRect(ox + .5, oy + .5, pane.rect.w - 1, pane.rect.h - 1);
		ctx.restore();

		// Which curve is on screen right now, in priority order: the one under
		// the finger, the committed edit, or a fresh projection through the live
		// camera. The live deformation has to win over the committed one because
		// a pointermove writes only lineDragRef — reading state here would
		// freeze the curve under the finger until pointerup.
		const drag = lineDragRef.current;
		const edit = drag ? { camera: drag.camera, original: drag.snapshot, edited: drag.live } : lineCurve;
		let original = null;
		let edited = null;
		// DETACHED. The committed edit was authored through its own lens; once the
		// live view has left that lens the same uv name different rays, so the
		// line is painted as a ghost — dashed, dim, no halo and no grab handles —
		// rather than drawn confidently in the wrong place or silently reprojected
		// (there is no depth to reproject it with). Nothing is discarded: the edit,
		// its preview and the Generate button all still run off the snapshot.
		// Computed HERE, per frame, rather than read off the 4 Hz watcher's state,
		// so the line detaches the instant the view moves instead of a quarter
		// second later. Never while a gesture is live — a drag paints its own
		// snapshot under the finger and mid-gesture drift is a different rule.
		let ghost = false;
		if (edit) {
			// An edit pins the curve to the lens it was authored through; the
			// cached live projection would disagree with it, so it is dropped
			// rather than left to go stale.
			lineLiveRef.current = null;
			original = edit.original;
			edited = edit.edited;
			ghost = !drag && lineCurveDrifted(pane, edit);
			// A drifted line is still WORLD-anchored through the trail's depth, so
			// draw it where the edit actually sits under the live lens rather than
			// at its stale authored uv. Falls back to the authored uv when the
			// re-anchoring cannot run (see reprojectDriftedEdit).
			if (ghost) {
				const anchored = reprojectDriftedEdit(pane, edit);
				if (anchored) ({ original, edited } = anchored);
			}
		} else {
			const live = projectLineCurve(pane);
			lineLiveRef.current = live;
			if (!live) { delete stage.dataset.lineDrift; return; }
			edited = live.curve;
		}
		// The CDP/e2e-visible handle for "the line is detached from this view".
		// On the stage rather than in React state because it has to be true on
		// the frame it becomes true, and this painter is the only thing that runs
		// on every frame.
		if (ghost) stage.dataset.lineDrift = "true";
		else delete stage.dataset.lineDrift;
		const pointPx = (point) => [ox + point.u * pane.rect.w, oy + point.v * pane.rect.h];
		/** Trace a frame-indexed curve, breaking the path at every null — a
		 * frame whose joint is behind the lens has no image, and joining across
		 * it would draw a straight line through the middle of the screen. */
		const traceCurve = (curve, from = 0, to = curve.length - 1) => {
			ctx.beginPath();
			let started = false;
			for (let index = Math.max(0, from); index <= Math.min(curve.length - 1, to); index += 1) {
				const point = curve[index];
				if (!point) { started = false; continue; }
				const [px, py] = pointPx(point);
				if (started) ctx.lineTo(px, py);
				else ctx.moveTo(px, py);
				started = true;
			}
			ctx.stroke();
		};

		ctx.save();
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		// Everything from here down to the pins is the CURVE, and the curve is the
		// one thing a moved view makes unplaceable, so the whole block fades
		// together. The pins below deliberately do not: they are world-space and
		// are re-projected through the live lens on every repaint.
		if (ghost) ctx.globalAlpha = .3;

		// (1) The ORIGINAL trajectory, faint, and ONLY while there is an edit to
		// compare it with. It used to be the instruction ("draw something like
		// this"); now it is a reference — how far the pull has taken the joint
		// from where the take put it. Unedited it would sit exactly under the
		// hero and just fatten the line.
		if (original) {
			ctx.setLineDash([7, 6]);
			ctx.strokeStyle = "rgba(0, 20, 40, .45)";
			ctx.lineWidth = 3;
			traceCurve(original);
			ctx.strokeStyle = "rgba(120, 205, 255, .5)";
			ctx.lineWidth = 1.5;
			traceCurve(original);
			ctx.setLineDash([]);
		}

		// (2) The curve in hand — the hero, and literally what gets sent. Two
		// passes: a dark halo so it reads on bright floors and skin tones alike,
		// then the glowing yellow the eye follows. GHOSTED the halo and the glow
		// both go: a detached line must not look like something you can grab, and
		// the dash says "this is where it was, not where it is".
		if (!ghost) {
			ctx.strokeStyle = "rgba(40, 24, 0, .8)";
			ctx.lineWidth = 9;
			traceCurve(edited);
			ctx.shadowColor = "rgba(255, 210, 61, .9)";
			ctx.shadowBlur = 10;
		} else {
			ctx.setLineDash([3, 7]);
		}
		ctx.strokeStyle = "#ffd23d";
		ctx.lineWidth = ghost ? 2 : 4.5;
		traceCurve(edited);
		ctx.shadowBlur = 0;
		ctx.setLineDash([]);

		// (4) The influenced span, while a grab is live: the stretch the falloff
		// is actually moving, drawn thicker and hotter. It is the only honest
		// picture of what the influence slider does, and it walks out with the
		// SAME dragWeight the deformation used rather than a redrawn guess.
		if (drag) {
			let from = drag.index;
			let to = drag.index;
			while (from > 0 && dragWeight(from - 1 - drag.index, drag.radius) > DRAG_WEIGHT_EPSILON) from -= 1;
			while (to < edited.length - 1 && dragWeight(to + 1 - drag.index, drag.radius) > DRAG_WEIGHT_EPSILON) to += 1;
			ctx.strokeStyle = "rgba(255, 245, 200, .95)";
			ctx.lineWidth = 6;
			traceCurve(edited, from, to);
		}

		// (3) The grab handles. Every 4th frame keeps a 200-frame range from
		// turning into a solid bead of dots while still leaving a target within
		// a couple of frames of wherever the pointer lands (the hit test
		// tolerates 14 px anyway, so the dots are an affordance, not the
		// geometry). Pinned ends and offscreen frames are deliberately NOT drawn
		// as handles: nearestCurvePoint refuses them, and a dot that cannot be
		// grabbed is worse than no dot. The hovered one swells, because the
		// scene's own cursor is already `grab` and a cursor alone cannot say
		// "this pointer would pick up the path rather than orbit the view".
		// GHOSTED THERE ARE NO HANDLES AT ALL. A dot is a promise that pressing it
		// picks the path up, and while the view has drifted that press is refused
		// — and would be aiming at a place the point is not, anyway.
		const hovered = ghost ? null : (drag ? drag.index : lineHoverRef.current);
		for (let index = 0; !ghost && index < edited.length; index += 1) {
			const point = edited[index];
			if (!isCurvePointOnScreen(point)) continue;
			if (isCurveEndPinned(index, edited.length)) continue;
			const active = hovered === index;
			if (!active && index % LINE_CURVE_MARKER_STRIDE !== 0) continue;
			const [px, py] = pointPx(point);
			const radius = active ? (drag ? 7 : 5.5) : 3.2;
			ctx.fillStyle = "rgba(40, 24, 0, .85)";
			ctx.beginPath();
			ctx.arc(px, py, radius + 1.6, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = active ? "#fff6d0" : "#ffe27a";
			ctx.beginPath();
			ctx.arc(px, py, radius, 0, Math.PI * 2);
			ctx.fill();
		}

		// The pinned ends, drawn in the REFERENCE colour rather than the edit
		// colour, because that is exactly what they are: the frames at each edge
		// that stay on the original trajectory no matter how hard the middle is
		// pulled. Seeing them anchored is the whole explanation of why this edit
		// does not pop at the seams.
		for (const index of ghost ? [] : [0, edited.length - 1]) {
			const point = edited[index];
			if (!isCurvePointOnScreen(point)) continue;
			const [px, py] = pointPx(point);
			ctx.fillStyle = "rgba(0, 20, 40, .8)";
			ctx.beginPath();
			ctx.arc(px, py, 5.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#78cdff";
			ctx.beginPath();
			ctx.arc(px, py, 3.2, 0, Math.PI * 2);
			ctx.fill();
		}
		// The curve's fade ends here; the pins below are world-space and paint at
		// full strength through the live lens whatever the curve's lens is doing.
		ctx.globalAlpha = 1;

		// (4b) THE PINS, and — in pin mode — the joint's own handle at the
		// playhead. Drawn in the pose-studio's effector green rather than the
		// path's yellow, because a pin is a different KIND of statement: the path
		// says "go this way", a pin says "be exactly here at this instant". Each
		// pin carries a leader line back to where the take put the joint at that
		// frame, which is the only honest picture of what was asked for; without
		// it a pin is just a dot floating in space.
		if (linePinMode || linePins.length) {
			const pinDrag = linePinDragRef.current;
			// ONE capture for the whole block: pins are world-space, so unlike the
			// curve they are re-projected through the LIVE lens on every repaint
			// and an orbit carries them along, at full strength. The curve above
			// can only ghost — that is the camera-policy difference between the two
			// gestures, and it is a difference in what can be DRAWN, not in what
			// survives: both edits outlive the move.
			const pinCam = pinDrag?.camera ?? captureLineCamera(pane);
			const marks = [];
			for (const pin of linePins) {
				const world = pinDrag && pinDrag.frame === pin.frame ? pinDrag.world : linePinWorld(pin);
				if (world) marks.push({ frame: pin.frame, world, placed: true });
			}
			if (pinDrag && !linePins.some((pin) => pin.frame === pinDrag.frame)) {
				marks.push({ frame: pinDrag.frame, world: pinDrag.world, placed: false });
			}
			// The grabbable handle: the joint where the take currently puts it at
			// the playhead. Only in pin mode, and only when that frame is not
			// already pinned — otherwise the pin IS the handle.
			const playhead = Math.max(0, Math.min(Math.trunc(tlFrame) || 0, Math.max(0, lineClipFrames - 1)));
			if (linePinMode && !pinDrag && !linePins.some((pin) => pin.frame === playhead)) {
				const here = lineJointWorldAt(playhead);
				if (here) marks.push({ frame: playhead, world: here, placed: false, handle: true });
			}
			for (const mark of pinCam ? marks : []) {
				const uv = projectPointC6(pinCam, mark.world[0], mark.world[1], mark.world[2]);
				if (!uv) continue;
				const px = ox + uv[0] * pane.rect.w;
				const py = oy + uv[1] * pane.rect.h;
				if (mark.placed) {
					const origin = lineJointWorldAt(mark.frame);
					const originUv = origin ? projectPointC6(pinCam, origin[0], origin[1], origin[2]) : null;
					if (originUv) {
						ctx.save();
						ctx.setLineDash([4, 4]);
						ctx.strokeStyle = "rgba(120, 255, 190, .55)";
						ctx.lineWidth = 1.5;
						ctx.beginPath();
						ctx.moveTo(ox + originUv[0] * pane.rect.w, oy + originUv[1] * pane.rect.h);
						ctx.lineTo(px, py);
						ctx.stroke();
						ctx.restore();
					}
				}
				const radius = mark.handle ? 6 : 7;
				ctx.fillStyle = "rgba(0, 30, 20, .85)";
				ctx.beginPath();
				ctx.arc(px, py, radius + 2, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = mark.placed ? "#5cffb0" : "rgba(92, 255, 176, .5)";
				ctx.beginPath();
				ctx.arc(px, py, radius, 0, Math.PI * 2);
				ctx.fill();
				if (mark.placed) {
					ctx.fillStyle = "rgba(0, 30, 20, .9)";
					ctx.font = "600 10px system-ui, sans-serif";
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.fillText(String(mark.frame), px, py);
				}
			}
		}

		// (5) The stroke under the finger, while one is being drawn. Same family
		// as the hero curve — dark halo, warm core — but PALE and dashed rather
		// than the solid yellow, because it is not the curve yet: it is a shape
		// that becomes the curve's interior on release, and the two ends it will
		// be pinned to are the blue dots already drawn above. Painted last so it
		// sits over everything, with a dot at the head so a stroke that is only
		// beginning is still visible.
		const draw = lineDrawRef.current;
		if (draw && draw.points.length) {
			ctx.save();
			ctx.lineJoin = "round";
			ctx.lineCap = "round";
			ctx.beginPath();
			draw.points.forEach(([su, sv], index) => {
				const px = ox + su * pane.rect.w;
				const py = oy + sv * pane.rect.h;
				if (index === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			});
			ctx.strokeStyle = "rgba(40, 24, 0, .75)";
			ctx.lineWidth = 8;
			ctx.stroke();
			ctx.setLineDash([9, 6]);
			ctx.shadowColor = "rgba(255, 246, 208, .9)";
			ctx.shadowBlur = 10;
			ctx.strokeStyle = "#fff6d0";
			ctx.lineWidth = 3.5;
			ctx.stroke();
			ctx.shadowBlur = 0;
			ctx.setLineDash([]);
			const head = draw.points[draw.points.length - 1];
			const hx = ox + head[0] * pane.rect.w;
			const hy = oy + head[1] * pane.rect.h;
			ctx.fillStyle = "rgba(40, 24, 0, .85)";
			ctx.beginPath();
			ctx.arc(hx, hy, 6, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#fff6d0";
			ctx.beginPath();
			ctx.arc(hx, hy, 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}
		ctx.restore();
	}

	/** Client pointer -> viewport-normalized uv. Unlike the old freehand path
	 * this does NOT reject coordinates outside the image: a pull that leaves the
	 * frame is a real gesture and the deformation it implies is real too. It is
	 * refused later, at curveToPoints2d, with a message that says which problem
	 * it is — the bridge rejects points2d outside 0..1. */
	function lineUvFromPointer(pane, event) {
		return [
			(event.clientX - pane.rect.x) / pane.rect.w,
			(event.clientY - pane.rect.y) / pane.rect.h,
		];
	}

	/** The curve a pointer could grab this instant, WITHOUT side effects — the
	 * committed edit if there is one, otherwise whatever the last repaint
	 * projected. Used by the hover cursor, which must never change state. */
	function lineHoverCurve() {
		// A drifted curve is painted detached and has no handles, so it has no
		// hover targets either — swelling a marker the press would refuse is the
		// cursor telling a lie. The ref (rather than a fresh capture) because
		// hover fires on every pointermove and 250 ms of staleness on a cursor
		// shape is not worth a matrix inversion per move.
		if (lineCurve) return lineDriftRef.current ? null : lineCurve.edited;
		return lineLiveRef.current?.curve ?? null;
	}

	/** Side-effect-free "does this press belong to line editing?" — handed to
	 * ObjectGizmo as `claimPointer` so its WINDOW-capture selection handler
	 * yields the press. Without the yield the gizmo's stopPropagation kills the
	 * event above the stage and the gesture never reaches the stage listener at
	 * all; that swallowing is the entire reason claimPointer exists.
	 *
	 * IT CLAIMS EVERY PLAIN-LEFT PRESS ON THE IMAGE, not only the ones that hit
	 * the curve. It has to: a press on EMPTY space is now a freehand stroke, so
	 * "missed the curve" is no longer "not ours" — it is the other half of the
	 * mode, and a probe that answered false there would let the gizmo eat exactly
	 * the presses drawing depends on. The cost is explicit and deliberate: while
	 * the mode is ON, plain-left no longer picks a cast member on the deck. What
	 * is NOT claimed is anything the camera owns — alt+left orbits, middle pans,
	 * right flies (see controls.jsx), so navigation is untouched — nor a press
	 * outside the drawn image, nor a press on the HUD chrome stacked over the
	 * stage, nor anything at all outside line-edit mode: App only passes this
	 * probe to the gizmos while lineEditMode is true.
	 *
	 * Must never mutate state, and must agree exactly with what
	 * onLineStagePointerDown will do with the same event — the two conditions
	 * below are the same ones that handler opens with. */
	function lineGrabProbe(event) {
		if (event.button !== 0 || event.altKey) return false;
		if (!(event.target instanceof HTMLCanvasElement)) return false;
		const pane = lineEditPane();
		if (!pane) return false;
		// No curve to grab AND nothing to draw onto: without a projected
		// trajectory there is no base curve for a stroke to replace the interior
		// of, so the press is not ours and the gizmo keeps it.
		//
		// A COMMITTED EDIT CLAIMS THE PRESS EVEN WHILE THE VIEW HAS DRIFTED, which
		// is why the test is on lineCurve rather than on lineHoverCurve alone
		// (that one goes null under drift, deliberately — no handles to hover).
		// The stage handler refuses that press with the drift hint; yielding it
		// instead would hand it to the gizmo, which would quietly select a cast
		// member and never say why the gesture did nothing.
		if (!lineCurve && !lineHoverCurve()) return false;
		const [u, v] = lineUvFromPointer(pane, event);
		// Outside the drawable image (the letterbox bars of a shot view) a stroke
		// could only author points the bridge refuses, so it is not a stroke.
		return u >= 0 && u <= 1 && v >= 0 && v <= 1;
	}

	/** What a grab picks up, `{ camera, curve }`, and the ONE place the camera
	 * is snapshotted: the pair returned here is what the drag deforms and what
	 * the eventual C6 request is built against, so the uv and the lens can never
	 * come from different moments.
	 *
	 * A committed edit is handed back with ITS OWN lens, and a drifted one is
	 * never reached at all — onLineStagePointerDown refuses the press above,
	 * synchronously, before this function is called. That refusal (rather than
	 * the old discard) is the whole policy change: a second gesture through a
	 * different lens would mix two cameras into one curve, which is a real
	 * problem; the edit already in hand is not. */
	function lineGrabSource(pane) {
		if (lineCurve) return { camera: lineCurve.camera, curve: lineCurve.edited };
		const cached = lineLiveRef.current;
		if (cached) return cached;
		const fresh = projectLineCurve(pane);
		lineLiveRef.current = fresh;
		return fresh;
	}

	/** The stage's CAPTURE-phase pointerdown: which of the two gestures this is.
	 *
	 * The overlay canvas is `pointer-events: none` and only paints; this listener
	 * sits on the stage container instead, ahead of r3f and the fly controls, and
	 * asks one question: did the pointer land within CURVE_GRAB_RADIUS_PX of a
	 * draggable point?
	 *
	 *   YES -> a PULL. The curve is snapshotted and deformed under the finger.
	 *   NO  -> a DRAW. The press starts a freehand stroke on empty space, which
	 *          on release picks its own frame window and becomes the same kind of
	 *          curve (drawStrokeEdit), committed through the identical pipeline.
	 *          This used to be the
	 *          do-nothing path, and on a take whose trail projects into a few
	 *          pixels that made the mode feel broken: nothing to grab, nothing
	 *          happens, no way in.
	 *
	 * Either way the event is consumed exclusively (preventDefault +
	 * stopPropagation) so one gesture cannot also select or orbit. The presses
	 * this handler deliberately never takes are the camera's — alt+left orbits,
	 * middle pans, right flies — so judging a correction from another angle
	 * still works and the mode never takes the viewport hostage. Plain-left
	 * click-to-select IS given up for as long as the mode is on; that is the
	 * price of an empty-space gesture, and the mode is modal and escapable.
	 *
	 * Capture phase rather than bubble because the decision has to be made before
	 * the controls start an orbit; a bubble listener would arrive after they had
	 * already latched on (FlyControls binds pointerdown on gl.domElement, which
	 * is a descendant of the stage, so stopping here is enough — nothing binds
	 * this gesture at the window). Nothing is re-dispatched. */
	function onLineStagePointerDown(event) {
		// Alt+left is the orbit gesture and belongs to the camera, never to a
		// stroke — the one plain-left press this mode must still let through.
		if (event.button !== 0 || event.altKey) return;
		// Only the render surface itself. The stage also carries HUD chrome — the
		// inset's drag chip, the plan pane, overlay buttons — and a control that
		// happens to sit within 14 px of the curve must keep its own click. The
		// overlay canvas cannot be the target (pointer-events: none), so a canvas
		// target is always the WebGL one.
		if (!(event.target instanceof HTMLCanvasElement)) return;
		const pane = lineEditPane();
		if (!pane) return;
		// THE VIEW HAS DRIFTED AWAY FROM THE EDIT IN HAND — refuse the gesture,
		// keep the edit. A pull, a stroke or a pin started now would be authored
		// through THIS lens and committed onto a curve authored through another
		// one, and there is no honest way to merge two cameras into a single set
		// of uv. So the press is consumed (so it cannot orbit or select behind the
		// refusal) and answered with the same sentence the panel is showing. Undo,
		// reset, Generate and Esc all still work — none of them authors anything.
		//
		// Checked synchronously rather than off the 4 Hz watcher's state: the
		// window between polls is exactly where a fly-then-press lands.
		if (lineCurve && lineCurveDrifted(pane)) {
			event.preventDefault();
			event.stopPropagation();
			setToast(lineDriftHint());
			return;
		}
		// PIN MODE takes the press before the curve does: in this mode the marker
		// under the pointer is the joint AT THE PLAYHEAD, not a point of a path,
		// and the two gestures start on the same pixels.
		if (linePinMode) {
			if (beginLinePinDrag(event, pane)) return;
			// A press that missed the handle in pin mode does nothing rather than
			// falling through to a stroke: the artist asked for pins, and a
			// surprise reroute is exactly the "I did not mean that" the redesign
			// is about.
			return;
		}
		const source = lineGrabSource(pane);
		if (!source) return;
		const [u, v] = lineUvFromPointer(pane, event);
		const hit = nearestCurvePoint(source.curve, u, v, CURVE_GRAB_RADIUS_PX, pane.rect.w, pane.rect.h);
		// MISSED THE CURVE — draw a new path instead of doing nothing.
		if (!hit) {
			if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return;
			beginLineDraw(event, pane, source, u, v);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const stage = stageRef.current;
		if (stage) stage.dataset.lineGrab = "drag";
		lineHoverRef.current = null;
		// SNAPSHOT. Every pointermove re-derives the deformation from this exact
		// curve, so one drag is idempotent (return the pointer to the grab point
		// and the curve is restored) and changing the radius mid-drag re-deforms
		// rather than compounding. Successive drags stack because each new grab
		// snapshots what the previous one committed.
		lineDragRef.current = {
			index: hit.index,
			prev: lineCurve,
			u0: u,
			v0: v,
			du: 0,
			dv: 0,
			radius: lineRadius,
			camera: source.camera,
			snapshot: source.curve,
			live: source.curve,
		};
		// Window-level move/up, the same idiom beginInsetDrag uses above: a pull
		// that leaves the stage still tracks, and a pointerup anywhere ends it.
		const onMove = (moveEvent) => {
			const drag = lineDragRef.current;
			const livePane = lineEditPane();
			if (!drag || !livePane) return;
			const [mu, mv] = lineUvFromPointer(livePane, moveEvent);
			if (!Number.isFinite(mu) || !Number.isFinite(mv)) return;
			drag.du = mu - drag.u0;
			drag.dv = mv - drag.v0;
			drag.live = dragCurve(drag.snapshot, drag.index, drag.du, drag.dv, drag.radius);
			paintLineOverlay();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			const drag = lineDragRef.current;
			lineDragRef.current = null;
			const endStage = stageRef.current;
			if (endStage) delete endStage.dataset.lineGrab;
			if (!drag) return;
			// A pull that went nowhere changes NOTHING — including an edit that
			// was already there (wiping it on a stray click was a bug). A real
			// pull commits with the lens it was authored through and records
			// what it replaced, which is what Ctrl/Cmd+Z restores.
			const changed = !curvesEqual(drag.live, drag.snapshot);
			// ONE EDIT IS ONE GESTURE: a real pull makes this a path edit, so any
			// pins in hand are dropped (with a toast, never silently).
			if (changed) { clearLinePins(); lineUndoRef.current.push(drag.prev ?? null); }
			// A FRESH PULL EDITS ONLY THE FRAMES THE FALLOFF TOUCHED. Inheriting
			// the panel's whole-clip default meant zero preserve rows on the box,
			// and the sampler re-rolled the entire body of the entire clip — a
			// 25 px nudge measured 4.6 m of drift eight seconds away. A pull that
			// refines an existing edit keeps that edit's window instead: shrinking
			// it would drop the drawn reroute outside the newly touched frames.
			const inherited = drag.prev?.frameRange ?? null;
			const pulledRange = changed && !inherited
				? changedFrameRange(drag.snapshot, drag.live, { clipFrames: lineClipFrames })
				: null;
			const committed = changed
				? {
					camera: drag.camera,
					original: drag.snapshot,
					edited: drag.live,
					frameRange: inherited ?? pulledRange ?? lineEditRange,
				}
				: (drag.prev ?? null);
			// Same panel feedback as a drawn stroke: the numbers the artist never
			// typed show up filled in.
			if (changed && pulledRange && (
				pulledRange.startFrame !== lineEditRange?.startFrame || pulledRange.endFrame !== lineEditRange?.endFrame
			)) {
				lineAutoRangeRef.current = pulledRange;
				setLineRange(pulledRange);
			}
			setLineCurve(committed);
			// RELEASE FIRES A DRAFT. A pull that changed nothing asks for nothing:
			// the viewport already shows what it would show.
			if (changed) scheduleLinePreview(committed);
			paintLineOverlay();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		paintLineOverlay();
	}

	/** The DRAW half: a press on empty space collects a freehand stroke and, on
	 * release, hands it to drawStrokeEdit, which decides WHICH FRAMES the stroke
	 * was drawn over, replays it with those frames' own timing, and eases it into
	 * the original trajectory at both ends.
	 *
	 * The commit below therefore does one thing the drag's does not: it writes
	 * the matched window back into the panel's range inputs, so "frames 30-66"
	 * appears filled in without anyone having typed a number. That is the entire
	 * fix for the complaint that a short hook became an eight-second crawl — the
	 * range used to default to the whole clip and nobody ever narrowed it.
	 *
	 * Why drawing exists beside dragging at all: the grab is a hit test against
	 * the joint's PROJECTED trail, and on a take where the joint barely moves
	 * across the image — the person who backs up and falls, whose hand travels a
	 * few screen pixels over 192 frames — that trail is a dot. There is nothing
	 * to grab, so the mode did nothing, so the mode was broken. Drawing needs no
	 * target.
	 *
	 * The commit below is deliberately the SAME six lines the drag's pointerup
	 * runs: compare against the snapshot, push the replaced curve on the undo
	 * stack, install `{ camera, original, edited }`, schedule a preview. Every
	 * downstream behaviour — Ctrl/Cmd+Z, the reset button, the detached paint a
	 * moved view puts it in, the wire payload — therefore treats a drawn curve as
	 * an ordinary one, because it IS one. */
	function beginLineDraw(event, pane, source, u, v) {
		event.preventDefault();
		event.stopPropagation();
		const stage = stageRef.current;
		if (stage) stage.dataset.lineGrab = "draw";
		lineHoverRef.current = null;
		lineDrawRef.current = {
			prev: lineCurve,
			camera: source.camera,
			snapshot: source.curve,
			// THE WHOLE CLIP'S trail, through the SAME lens the stroke is being
			// drawn with, captured once at press. This is what the stroke's
			// endpoints are matched against on release (redesign A), and it has to
			// be the ORIGINAL trail rather than whatever is currently edited so
			// that redrawing re-matches against a fixed reference instead of
			// walking away from it one stroke at a time. Capturing at press rather
			// than at release means a camera that drifts mid-stroke cannot leave
			// the match and the stroke measured through different lenses.
			fullCurve: lineClipFrames > 1
				? projectLineCurve(pane, { camera: source.camera, frameRange: { startFrame: 0, endFrame: lineClipFrames } })?.curve ?? null
				: null,
			// Pixel size of the pane the stroke is being drawn on, captured once:
			// the "is this a stroke or a click?" threshold is in CSS pixels, where
			// the hand drew it, and uv distance is anisotropic so it cannot be
			// judged in uv without this pair.
			paneW: pane.rect.w,
			paneH: pane.rect.h,
			points: [[u, v]],
			// Running length in PIXELS, accumulated as the stroke is drawn rather
			// than re-measured at release.
			lengthPx: 0,
		};
		const onMove = (moveEvent) => {
			const draw = lineDrawRef.current;
			const livePane = lineEditPane();
			if (!draw || !livePane) return;
			const [mu, mv] = lineUvFromPointer(livePane, moveEvent);
			if (!Number.isFinite(mu) || !Number.isFinite(mv)) return;
			const last = draw.points[draw.points.length - 1];
			const stepPx = Math.hypot((mu - last[0]) * draw.paneW, (mv - last[1]) * draw.paneH);
			// Sub-pixel jitter carries no shape and only costs arc-length samples.
			if (!(stepPx > 0.5)) return;
			draw.points.push([mu, mv]);
			draw.lengthPx += stepPx;
			paintLineOverlay();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			const draw = lineDrawRef.current;
			lineDrawRef.current = null;
			const endStage = stageRef.current;
			if (endStage) delete endStage.dataset.lineGrab;
			if (!draw) return;
			// A CLICK IS NOT A STROKE, and a click must change nothing — including
			// an edit that is already there. Same rule the drag's commit enforces
			// with curvesEqual; here the test is the length of what was drawn.
			const edit = draw.points.length >= DRAW_MIN_STROKE_POINTS && draw.lengthPx >= DRAW_MIN_STROKE_PX
				? drawStrokeEdit(draw.points, {
					fullCurve: draw.fullCurve,
					fallbackCurve: draw.snapshot,
					fallbackRange: lineEditRange,
					paneW: draw.paneW,
					paneH: draw.paneH,
					clipFrames: lineClipFrames,
				})
				: null;
			if (!edit) {
				paintLineOverlay();
				return;
			}
			const drawn = edit.curve;
			const changed = !curvesEqual(drawn, edit.base);
			if (changed) { clearLinePins(); lineUndoRef.current.push(draw.prev ?? null); }
			// The matched window rides ON the committed curve, not only in
			// `lineRange` state. setLineRange is asynchronous and the preview below
			// fires from a timeout that closed over THIS render's lineEditRange, so
			// a request built from state alone would ship the old range with the
			// new curve — the exact mismatch that would splice a re-routed stretch
			// into the wrong frames. buildLineEditRequest reads curve.frameRange.
			const committed = changed
				? { camera: draw.camera, original: edit.base, edited: drawn, frameRange: edit.frameRange ?? lineEditRange }
				: (draw.prev ?? null);
			// PANEL FEEDBACK (redesign D): the numbers the artist never typed show
			// up filled in, so "frames 30-66" is visible confirmation of what the
			// stroke was read as. Only on a real match — a fallback draw is still
			// in whatever range the panel already showed.
			if (changed && edit.matched && edit.frameRange && (
				edit.frameRange.startFrame !== lineEditRange?.startFrame || edit.frameRange.endFrame !== lineEditRange?.endFrame
			)) {
				lineAutoRangeRef.current = edit.frameRange;
				setLineRange(edit.frameRange);
			}
			setLineCurve(committed);
			if (changed) scheduleLinePreview(committed);
			paintLineOverlay();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		paintLineOverlay();
	}

	/** THE PIN GESTURE (순간 찍기): grab the joint at the playhead and put it
	 * where it should be.
	 *
	 * Returns true when the press was taken. The handle is the joint's own
	 * position at the CURRENT FRAME — the artist scrubbed there, so that is the
	 * moment they are talking about — plus any pin already placed, which can be
	 * re-grabbed to adjust it (grabbing one moves the playhead to its frame, so
	 * the viewport shows the pose being pinned).
	 *
	 * The 2D-to-3D step is unprojectDeltaC6: the joint slides in the image plane
	 * at its own depth, which is the effector-drag mechanic the pose studio's
	 * gizmo uses and the only reading of a screen drag that does not invent a
	 * depth the artist could not see. THE DEVIATION IS DELIBERATE and worth
	 * naming: this is not posestudio's TransformControls gizmo, because that one
	 * requires ikMode, which is mutually exclusive with this mode. What is
	 * reused is the MECHANIC, not the widget.
	 *
	 * On release the world point is converted to the take's own clip space
	 * (worldPointToClip) and stored — pins go on the wire in the space the npz
	 * is written in, which is the only space a "within 2 cm of the target" claim
	 * can be checked in. */
	function beginLinePinDrag(event, pane) {
		const camera = captureLineCamera(pane);
		if (!camera) return false;
		const frame = Math.max(0, Math.min(Math.trunc(tlFrame) || 0, Math.max(0, lineClipFrames - 1)));
		const [u, v] = lineUvFromPointer(pane, event);
		const reach = (candidate) => {
			const uv = projectPointC6(camera, candidate.world[0], candidate.world[1], candidate.world[2]);
			if (!uv) return null;
			const dist = Math.hypot((uv[0] - u) * pane.rect.w, (uv[1] - v) * pane.rect.h);
			return dist > CURVE_GRAB_RADIUS_PX * 2 ? null : { ...candidate, dist };
		};
		// THE PLAYHEAD WINS TIES, and not by accident. The obvious rule — nearest
		// candidate in pixels — was measured wrong on the take this mode exists
		// for: the head's whole trail is ~100 px, so a pin already placed at frame
		// 90 sits within the grab radius of the joint at frame 112, and scrubbing
		// forward to add a second pin instead re-grabbed the first one and dragged
		// the playhead back to it. The artist scrubbed somewhere on purpose; that
		// moment is what the press means. Existing pins are only considered when
		// the playhead's own handle is out of reach.
		const here = lineJointWorldAt(frame);
		let best = here && !linePins.some((pin) => pin.frame === frame)
			? reach({ frame, world: here })
			: null;
		if (!best) {
			for (const pin of linePins) {
				const world = linePinWorld(pin);
				if (!world) continue;
				const hit = reach({ frame: pin.frame, world });
				if (hit && (!best || hit.dist < best.dist)) best = hit;
			}
		}
		// A press on the joint at a frame that is ALREADY pinned re-places that
		// pin, which is the same "the second gesture wins" rule upsertPin applies.
		if (!best && here) best = reach({ frame, world: here });
		if (!best) return false;
		event.preventDefault();
		event.stopPropagation();
		const stage = stageRef.current;
		if (stage) stage.dataset.lineGrab = "pin";
		// Re-grabbing an existing pin moves the playhead to it, so the body on
		// screen is the pose the pin belongs to rather than whatever frame the
		// timeline happened to be parked on.
		if (best.frame !== frame) setTlFrame(best.frame);
		linePinDragRef.current = {
			frame: best.frame,
			camera,
			origin: best.world,
			world: best.world,
			u0: u,
			v0: v,
			moved: false,
		};
		const onMove = (moveEvent) => {
			const drag = linePinDragRef.current;
			const livePane = lineEditPane();
			if (!drag || !livePane) return;
			const [mu, mv] = lineUvFromPointer(livePane, moveEvent);
			if (!Number.isFinite(mu) || !Number.isFinite(mv)) return;
			const delta = unprojectDeltaC6(drag.camera, drag.origin, mu - drag.u0, mv - drag.v0);
			if (!delta) return;
			drag.world = [drag.origin[0] + delta[0], drag.origin[1] + delta[1], drag.origin[2] + delta[2]];
			// Sub-pixel tremor is not a placement, exactly as a few pixels of
			// wobble is not a stroke (DRAW_MIN_STROKE_PX).
			drag.moved = Math.hypot((mu - drag.u0) * livePane.rect.w, (mv - drag.v0) * livePane.rect.h) >= DRAW_MIN_STROKE_PX;
			paintLineOverlay();
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			const drag = linePinDragRef.current;
			linePinDragRef.current = null;
			const endStage = stageRef.current;
			if (endStage) delete endStage.dataset.lineGrab;
			if (!drag || !drag.moved) { paintLineOverlay(); return; }
			const clip = worldPointToClip(motion, { x: drag.world[0], y: drag.world[1], z: drag.world[2] }, {
				baseY: activeChar.y ?? 0,
				scale: activeChar.scale ?? 1,
			});
			const next = upsertPin(linePins, { frame: drag.frame, position: [clip.x, clip.y, clip.z] });
			if (next === linePins) { paintLineOverlay(); return; }
			// A pin and a curve cannot coexist (see the linePins comment). The
			// curve goes on the undo stack first, so Ctrl/Cmd+Z brings it back.
			if (lineCurve) {
				lineUndoRef.current.push(lineCurve);
				setLineCurve(null);
			}
			const range = pinsFrameRange(next, lineClipFrames);
			if (range) {
				lineAutoRangeRef.current = range;
				setLineRange(range);
			}
			setLinePins(next);
			// Same debounce, same session seed, same supersede rule as a stroke:
			// the preview loop does not care which gesture asked for it.
			if (range) scheduleLinePreview({ pins: next, frameRange: range });
			paintLineOverlay();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		paintLineOverlay();
		return true;
	}

	/** Bubble-phase hover: the cursor and the swollen marker, nothing else. It
	 * never stops the event and never writes state, so it cannot interfere with
	 * the orbit the same pointermove is probably driving. */
	function onLineStageHover(event) {
		const stage = stageRef.current;
		if (!stage || lineDragRef.current || lineDrawRef.current || linePinDragRef.current) return;
		const pane = event.target instanceof HTMLCanvasElement ? lineEditPane() : null;
		const curve = pane ? lineHoverCurve() : null;
		let hit = null;
		if (curve) {
			const [u, v] = lineUvFromPointer(pane, event);
			hit = nearestCurvePoint(curve, u, v, CURVE_GRAB_RADIUS_PX, pane.rect.w, pane.rect.h);
		}
		lineHoverRef.current = hit ? hit.index : null;
		if (hit) stage.dataset.lineGrab = "hover";
		else delete stage.dataset.lineGrab;
	}

	function onLineStageHoverEnd() {
		const stage = stageRef.current;
		if (lineDragRef.current || lineDrawRef.current || linePinDragRef.current) return;
		lineHoverRef.current = null;
		if (stage) delete stage.dataset.lineGrab;
	}

	/** Back to the take's own trajectory — and, because an unedited curve
	 * follows the live camera, back to a path that tracks the view. */
	function resetLineCurve() {
		lineDragRef.current = null;
		lineDrawRef.current = null;
		linePinDragRef.current = null;
		setLinePins([]);
		// The button is itself undoable: resetting a curve you spent five pulls
		// on should not be a cliff.
		if (lineCurve) lineUndoRef.current.push(lineCurve);
		// The draft on screen was a picture of the pull that is being thrown
		// away, so it goes with it — but the SESSION does not end, and the seed
		// survives, because the artist is still editing the same take.
		cancelLinePreview();
		setLineCurve(null);
	}

	/** Internal clear — mode entry/exit and enqueue. (A camera move used to come
	 * through here too; it no longer clears anything.) Unlike the
	 * reset BUTTON this also empties the undo stack: those transitions change
	 * what the stack's entries were authored against. It is also where a
	 * preview SESSION ends, which is what re-rolls the seed: every one of these
	 * transitions means the next pull is a different piece of work. */
	function clearLineEdit() {
		lineDragRef.current = null;
		lineDrawRef.current = null;
		linePinDragRef.current = null;
		setLinePins([]);
		setLinePinMode(false);
		lineUndoRef.current = [];
		cancelLinePreview();
		linePreviewSeedRef.current = null;
		setLineCurve(null);
	}

	function undoLineCurve() {
		const previous = lineUndoRef.current.pop();
		if (previous === undefined) return false;
		lineDragRef.current = null;
		lineDrawRef.current = null;
		linePinDragRef.current = null;
		// Undo restores a CURVE, so it also un-does whatever pins replaced it —
		// the two are exclusive and the stack only ever stores curves.
		setLinePins([]);
		cancelLinePreview();
		setLineCurve(previous);
		return true;
	}

	/* --------------------- the live preview loop (C10/C11) --------------------
	 * Everything below is the machinery behind "release the drag, watch it move".
	 * It is deliberately kept apart from enqueueMotionJob: that queue exists to
	 * produce TAKES — it delivers to a character layer, commits a recipe and
	 * pushes a version — and a preview must do none of those things. So a
	 * preview is its own bare request, its own AbortController, and one
	 * viewport swap that anything can undo. */

	/** Pin (or release) the take a preview is drafted from. Mirrored into a ref
	 * because the async completion below reads it after several awaits, where a
	 * render-time closure would be pointing at the previous take. */
	function setPreviewSource(next) {
		linePreviewSourceRef.current = next;
		setLinePreviewSource(next);
	}

	/** THE SESSION SEED (rule 2 above). Rolled at most once per editing session
	 * and handed to every preview AND to the confirming full-quality run, so the
	 * draft the artist accepted is the draft they get. Returns null when the
	 * typed seed is invalid — takeSeed has already said so. */
	function lineSessionSeed() {
		if (Number.isInteger(linePreviewSeedRef.current)) return linePreviewSeedRef.current;
		const seed = takeSeed();
		if (seed === null) return null;
		linePreviewSeedRef.current = seed;
		return seed;
	}

	/** The C6 body for a curve — ONE builder for the preview and the confirm, so
	 * the only difference between what the artist watched and what they get is
	 * the step count. Returns `{ ok: false, message }` with copy already
	 * localized, or `{ ok: true, body, lineEdit, seed }`. */
	function buildLineEditRequest(curve, { preview = false } = {}) {
		const refuse = (copy) => ({ ok: false, message: ko(copy[0], copy[1]) });
		const sourceUrl = takeSourceUrl;
		if (!sourceUrl) return refuse(LINE_EDIT_REFUSALS.sourceMotion);
		if (!curve) {
			return refuse(["Pull the path first — grab a dot on it and drag", "커브를 먼저 잡아당겨 주세요"]);
		}
		// PINS take the other branch of C6 entirely: no points2d, no camera. The
		// prompt and the seed rule below are shared, because those belong to the
		// RUN, not to the gesture.
		if (curve.pins) {
			const prompt = ((linePreviewSource?.prompt ?? motion?.prompt) || "").trim() || "A person continues the motion naturally.";
			const lineEdit = {
				sourceMotion: sourceUrl,
				track: lineTrack,
				frameRange: curve.frameRange,
				pins3d: curve.pins.map((pin) => ({ frame: pin.frame, position: [...pin.position] })),
				prompt,
			};
			const refusal = validateLineEdit(lineEdit, { clipFrames: lineClipFrames });
			if (refusal) return refuse(LINE_EDIT_REFUSALS[refusal.code] ?? LINE_EDIT_REFUSALS.shape);
			const body = { prompt, duration: lineClipFrames / TIMELINE_FPS, posePin: false, lineEdit };
			const seed = lineSessionSeed();
			if (seed === null) return { ok: false, message: "" };
			body.seed = seed;
			if (preview) lineEdit.preview = true;
			return { ok: true, body, lineEdit, seed };
		}
		// The wire pairing is positional (driver.py spreads points2d across
		// frameRange by time), so the points sent are exactly the range's own
		// slice of the curve — a whole-clip dragged curve paired with a touched-
		// frames range would compress the full trail into the window.
		const requestRange = curve.frameRange ?? lineEditRange;
		const built = curveToPoints2d(sliceCurveToRange(curve.edited, requestRange));
		if (built.error) return refuse(LINE_CURVE_REFUSALS[built.error] ?? LINE_EDIT_REFUSALS.shape);
		// The take's own prompt is the text condition: a line edit changes WHERE
		// a joint goes, not what the shot is about. The fallback keeps the
		// bridge's non-empty-prompt contract satisfiable for takes imported
		// without one.
		const prompt = ((linePreviewSource?.prompt ?? motion?.prompt) || "").trim() || "A person continues the motion naturally.";
		const lineEdit = {
			sourceMotion: sourceUrl,
			track: lineTrack,
			// THE CURVE'S OWN RANGE FIRST. A drawn stroke picks its window from
			// where it was drawn (drawStrokeEdit) and a fresh pull from the frames
			// its falloff touched; the window is stamped on the committed curve
			// precisely so a request can never pair one gesture's points with
			// another render's range — `lineEditRange` is re-derived from state a
			// just-committed gesture has not landed in yet.
			frameRange: requestRange,
			points2d: built.points2d,
			camera: curve.camera,
			prompt,
		};
		const refusal = validateLineEdit(lineEdit, { clipFrames: lineClipFrames });
		if (refusal) return refuse(LINE_EDIT_REFUSALS[refusal.code] ?? LINE_EDIT_REFUSALS.shape);
		// posePin:false is mandatory, not decorative: the bridge demands a
		// `poses` array whenever posePin is not explicitly false, and a line
		// edit authors no poses at all.
		const body = { prompt, duration: lineClipFrames / TIMELINE_FPS, posePin: false, lineEdit };
		// THE SEED RULE (C9). An edit creates a take, so it may not leave the
		// seed to chance. The seed rides on the BODY, never inside `lineEdit` —
		// C6 validates that object field by field and an unknown key there is a
		// 400. `preview` is the one exception the bridge added for this loop.
		const seed = lineSessionSeed();
		if (seed === null) return { ok: false, message: "" };
		body.seed = seed;
		if (preview) lineEdit.preview = true;
		return { ok: true, body, lineEdit, seed };
	}

	/** Put a draft on screen without letting it become the take. */
	async function showLinePreview(url) {
		const source = linePreviewSourceRef.current;
		if (!source) return;
		try {
			await loadMotion(url, source.prompt, source.rotationDeg, null, source.charId, null, { preview: true });
			linePreviewShownRef.current = url;
			setLinePreviewUrl(url);
		} catch {
			setLinePreviewError(ko("The preview could not be read back", "미리보기를 읽지 못했어요"));
			await revertLinePreview();
		}
	}

	/** Back to the take itself. The source stays pinned until the reload lands,
	 * so there is never an instant where `takeSourceUrl` points at the draft.
	 * Nothing is reloaded when no draft ever reached the viewport — cancelling
	 * an in-flight preview (Esc, undo with an empty stack, a joint switch) must
	 * not cost a re-fetch and re-decode of a take that is already on screen. */
	async function revertLinePreview() {
		const source = linePreviewSourceRef.current;
		const shown = linePreviewShownRef.current;
		linePreviewShownRef.current = null;
		setLinePreviewUrl(null);
		if (!source || !shown) {
			setPreviewSource(null);
			return;
		}
		try {
			await loadMotion(source.url, source.prompt, source.rotationDeg, null, source.charId, null, { preview: true });
		} catch {
			/* loadMotion already surfaced the decode failure in the panel */
		}
		if (linePreviewSourceRef.current === source) setPreviewSource(null);
	}

	/** Stop the loop. Bumping the token is what makes an in-flight answer
	 * harmless: it arrives, finds itself stale, and is dropped without ever
	 * reaching the viewport. `revert:false` is for the callers that are ALREADY
	 * loading a different take (a version chip) and must not race a reload of
	 * the take they are leaving. */
	function cancelLinePreview({ revert = true } = {}) {
		if (linePreviewTimerRef.current) {
			window.clearTimeout(linePreviewTimerRef.current);
			linePreviewTimerRef.current = 0;
		}
		linePreviewPendingRef.current = null;
		linePreviewTokenRef.current += 1;
		const controller = linePreviewAbortRef.current;
		linePreviewAbortRef.current = null;
		if (controller) controller.abort();
		setLinePreviewBusy(false);
		setLinePreviewError("");
		setLinePreviewMs(0);
		if (revert) {
			revertLinePreview();
		} else {
			linePreviewShownRef.current = null;
			setLinePreviewUrl(null);
			setPreviewSource(null);
		}
	}

	/** A released drag asks for a draft — after a beat, so drag-drag-drag costs
	 * one request rather than three. */
	function scheduleLinePreview(curve) {
		if (linePreviewTimerRef.current) window.clearTimeout(linePreviewTimerRef.current);
		linePreviewTimerRef.current = window.setTimeout(() => {
			linePreviewTimerRef.current = 0;
			runLinePreview(curve);
		}, LINE_PREVIEW_DEBOUNCE_MS);
	}

	/** One preview round trip. Never more than one at a time (rule 3): a curve
	 * that arrives while a request is out becomes THE pending curve, replacing
	 * any earlier pending one, and is fired the moment the outstanding answer
	 * lands — whose result is then thrown away, because it describes a pull the
	 * artist has already moved past. */
	async function runLinePreview(curve) {
		if (!lineEditMode || !curve) return;
		// A preview is a courtesy, never a blocker: no bridge, no route, or the
		// box already busy with the real thing means the panel simply keeps the
		// curve and waits for the artist to press 생성.
		if (!bridge?.ok || !lineEditBackend || ardyRunning) return;
		if (linePreviewAbortRef.current) {
			linePreviewPendingRef.current = curve;
			return;
		}
		const source = linePreviewSourceRef.current ?? (motion?.url
			? {
				url: motion.url,
				prompt: motion.prompt ?? "",
				rotationDeg: motion.rotationDeg ?? activeChar.rot,
				charId: activeChar.id,
			}
			: null);
		if (!source) return;
		// Full quality on release, by request: the warm resident makes the 100-step
		// run ~2 s, and since the draft shares the session seed the confirm below
		// reproduces it bit for bit — so what the artist sees IS the final take,
		// and Generate is a commit, not a second opinion.
		const request = buildLineEditRequest(curve);
		if (!request.ok) {
			if (request.message) setLinePreviewError(request.message);
			return;
		}
		const token = ++linePreviewTokenRef.current;
		const controller = new AbortController();
		linePreviewAbortRef.current = controller;
		linePreviewPendingRef.current = null;
		setPreviewSource(source);
		setLinePreviewBusy(true);
		setLinePreviewError("");
		const startedAt = Date.now();
		let result = null;
		let failure = "";
		try {
			// No onEvent work: a preview's status lines belong to nobody. The
			// console stays the full-quality run's log.
			result = await ardyGenerate(request.body, () => {}, { signal: controller.signal });
		} catch (err) {
			// An abort is this loop's own doing and says nothing to the artist.
			failure = err?.name === "AbortError" ? "" : (err?.message || String(err));
		}
		// Stale: superseded by a newer drag or cancelled outright. Whoever bumped
		// the token owns the state now.
		if (linePreviewTokenRef.current !== token) return;
		linePreviewAbortRef.current = null;
		const pending = linePreviewPendingRef.current;
		if (pending) {
			linePreviewPendingRef.current = null;
			runLinePreview(pending);
			return;
		}
		setLinePreviewBusy(false);
		if (failure) {
			// Non-fatal by design: the curve survives, and 생성 still works.
			setLinePreviewError(failure);
			return;
		}
		if (!result?.motionUrl) return;
		setLinePreviewMs(Date.now() - startedAt);
		await showLinePreview(result.motionUrl);
	}

	function exitLineEditMode() {
		clearLineEdit();
		lineHoverRef.current = null;
		lineLiveRef.current = null;
		const stage = stageRef.current;
		if (stage) delete stage.dataset.lineGrab;
		setLineEditMode(false);
	}

	/** Entering is mutually exclusive with every other AUTHORING mode, the same
	 * way waypoint/IK/pose already are with each other: they all claim the same
	 * viewport pointer and the same playhead. Camera navigation is deliberately
	 * NOT in that list — the pointer is shared with it, not taken from it. */
	function toggleLineEditMode() {
		if (lineEditMode) {
			exitLineEditMode();
			setToast(ko("Line editing off", "라인 편집 꺼짐"));
			return;
		}
		if (!motion?.url) {
			setToast(ko("The current take has no bridge source — generate it once before editing a path", "현재 테이크에 브리지 원본이 없어요 — 궤적을 편집하기 전에 한 번 생성하세요"));
			return;
		}
		if (waypointMode) setWaypointMode(false);
		if (ikMode) leaveIkMode();
		if (posing) setPosing(null);
		clearLineEdit();
		setLineEditMode(true);
		setToast(ko(
			"Path editing on — draw along the path to reroute that section, or grab a dot and pull; the view still orbits normally",
			"궤적 편집 켜짐 — 궤적을 따라 그리면 그 구간만 새로 지나가고, 점을 잡아 끌 수도 있어요. 시점은 평소처럼 돌릴 수 있어요",
		));
	}

	/* Switching joint, range, take or character drops any pull in hand: it was
	 * authored against a trajectory that is no longer the one on screen. The
	 * curve itself needs no rebuilding — with no edit it is re-projected every
	 * repaint from the live camera.
	 *
	 * The one thing worth SAYING here is framing. Part of the range may be
	 * behind the lens or out of shot; the visible part stays draggable and the
	 * hit test ignores the rest, but a path that stops halfway looks like a bug,
	 * and hidden frames cannot be constrained. The retry exists because mode
	 * entry and a measurable pane are not the same instant — the overlay mounts
	 * in the commit that turns the mode on and DualRender may not have settled
	 * the pane's aspect yet, so the projection legitimately refuses for a frame
	 * or two. Failing silently after that is deliberate: the plan and IK views
	 * have no pinhole camera at all and are not worth nagging about. */
	useEffect(() => {
		if (!lineEditMode || !motion) return undefined;
		// ...unless the RANGE CHANGED BECAUSE A STROKE SAID SO. A drawn stroke
		// picks its own window (drawStrokeEdit) and commits the curve for that
		// window in the same gesture, so this run is reacting to the draw's own
		// bookkeeping rather than to the artist moving the goalposts. Consumed
		// once, so a later hand-typed range still drops the edit as before.
		const auto = lineAutoRangeRef.current;
		lineAutoRangeRef.current = null;
		if (auto && auto.startFrame === lineEditRange?.startFrame && auto.endFrame === lineEditRange?.endFrame) return undefined;
		// Whatever draft is on screen was drafted for the joint/range/take that
		// just changed, so it goes back to the source take with the pull. Pins go
		// with it for the same reason and one more: a pin names a JOINT, and the
		// joint just changed under it.
		cancelLinePreview();
		setLineCurve(null);
		setLinePins([]);
		let attempts = 0;
		let timer = 0;
		const check = () => {
			const live = projectLineCurve(lineEditPane());
			if (!live) {
				if (attempts >= 12) return;
				attempts += 1;
				timer = window.setTimeout(check, 120);
				return;
			}
			const hidden = live.curve.reduce((count, point) => count + (isCurvePointOnScreen(point) ? 0 : 1), 0);
			if (hidden > 0) {
				setToast(isKo
					? `이 구간의 ${hidden}프레임이 화면 밖이에요 — 구간 전체가 보이도록 시점을 잡아 주세요`
					: `${hidden} frame(s) of this range are outside the frame — orbit until the whole range is in view`);
			}
		};
		check();
		return () => window.clearTimeout(timer);
		// The range is depended on by VALUE: lineEditRange is a fresh object on
		// every render that touches lineRange, and depending on its identity
		// would fire this constantly. activeChar's ground offset and scale are in
		// here because jointTrailPoints places the trail with them — move or
		// resize the character and the path really is somewhere else.
		//
		// THE TAKE is depended on as takeSourceUrl, not as `motion`: a preview
		// swaps `motion` for a draft of the same take several times a minute,
		// and depending on the object would make every landing draft wipe the
		// very curve it is a picture of. takeSourceUrl only moves when the take
		// really does.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lineEditMode, lineTrack, takeSourceUrl, lineEditRange?.startFrame, lineEditRange?.endFrame, activeChar.y, activeChar.scale]);

	// Repaint on anything that changes what the overlay should show. The window
	// resize listener is separate from React state because the pane rect can
	// change without any of it changing.
	useEffect(() => {
		if (!lineEditMode) return undefined;
		paintLineOverlay();
		const repaint = () => paintLineOverlay();
		window.addEventListener("resize", repaint);
		// A gentle rAF loop while the mode is on, and it earns its keep three
		// times over: the unedited curve is re-projected here so it follows the
		// camera, a pointermove writes only lineDragRef so this is what shows the
		// live pull without re-rendering App, and the render moves underneath
		// regardless (playback, a follow camera). A few hundred 2d-canvas points
		// per frame is noise next to the WebGL scene already animating behind it.
		let raf = requestAnimationFrame(function tick() {
			paintLineOverlay();
			raf = requestAnimationFrame(tick);
		});
		return () => {
			window.removeEventListener("resize", repaint);
			cancelAnimationFrame(raf);
		};
	});

	// Pointer plumbing. The overlay canvas is `pointer-events: none` — it only
	// PAINTS — and the listeners live on the stage container instead, so a
	// pointer that misses the curve reaches the WebGL canvas untouched. See
	// onLineStagePointerDown for why the down listener is in the capture phase
	// and what "untouched" buys. No dependency array on purpose: the handlers
	// close over lineCurve, lineRadius and the live refs, and must always be
	// this render's.
	useEffect(() => {
		if (!lineEditMode) return undefined;
		const stage = stageRef.current;
		if (!stage) return undefined;
		stage.addEventListener("pointerdown", onLineStagePointerDown, true);
		stage.addEventListener("pointermove", onLineStageHover);
		stage.addEventListener("pointerleave", onLineStageHoverEnd);
		return () => {
			stage.removeEventListener("pointerdown", onLineStagePointerDown, true);
			stage.removeEventListener("pointermove", onLineStageHover);
			stage.removeEventListener("pointerleave", onLineStageHoverEnd);
		};
	});

	// ESC leaves the mode, matching the shot look-through and the scene-object
	// selection above.
	useEffect(() => {
		if (!lineEditMode) return undefined;
		const onKey = (event) => {
			if (event.key === "Escape") {
				exitLineEditMode();
				return;
			}
			// Ctrl/Cmd+Z inside the mode undoes the last PULL, not the scene.
			// Capture phase, because the app's scene undo listens on the window
			// bubble: consuming here keeps one keystroke from doing both. An
			// empty stack still swallows the key — falling through to a scene
			// undo the user cannot see happening behind the mode would be worse
			// than a no-op. Text fields keep the browser's own undo. Shift+Z
			// (redo) is left alone: there is no line-redo yet, and silently
			// eating it would just feel broken in a different way.
			if (event.code === "KeyZ" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
				if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? "")) return;
				event.preventDefault();
				event.stopPropagation();
				undoLineCurve();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [lineEditMode, lineCurve]);

	// Camera-drift watcher — and note what it does NOT do, which is now the
	// interesting half: it never blocks navigation, and IT NEVER DESTROYS
	// ANYTHING. It has no job at all while the curve is unedited, because an
	// unedited curve is re-projected every repaint and simply follows the view.
	//
	// Once something has been pulled, that pull is a 2D offset authored through
	// one specific lens — and the committed curve KEEPS that lens beside the
	// points, which is what buildLineEditRequest puts on the wire. So moving the
	// view invalidates the drawing of the line and nothing else: the edit, its
	// preview and the confirming run are all still exactly what the artist
	// authored. This watcher therefore only reports, in both directions — come
	// back toward the snapshot and the line re-attaches, with no state to restore
	// because none was thrown away. (Before this, it called clearLineEdit(): a
	// right-drag fly, the app's own navigation gesture, silently wiped a finished
	// edit. That was the bug.)
	//
	// Polling beats hooking every camera mutation: the cameras are moved from a
	// dozen places (fly controls, shot presets, live control, follow tracks) and
	// none of them reports to React. The painter re-derives the same answer every
	// frame for the ghost, and onLineStagePointerDown re-derives it synchronously
	// to close the 250 ms window between polls; this poll exists to drive the
	// PANEL, which only re-renders on state.
	useEffect(() => {
		if (!lineEditMode || !lineCurve) {
			// No edit, no drift: whatever the last curve's lens was, the live one
			// is now the baseline again and gestures are re-enabled. This is what
			// makes undo/reset back to no-curve hand the mode straight back.
			lineDriftRef.current = false;
			setLineDrifted(false);
			return undefined;
		}
		const poll = () => {
			// Never re-classify under a finger that is holding the curve or drawing
			// a new one: a live gesture owns its own snapshot, and mid-gesture
			// drift is the one case that is still a corruption rather than a
			// misalignment (see the gesture handlers — that path is unchanged).
			if (lineDragRef.current || lineDrawRef.current || linePinDragRef.current) return;
			const drifted = lineCurveDrifted(lineEditPane(), lineCurve);
			if (drifted === lineDriftRef.current) return;
			lineDriftRef.current = drifted;
			setLineDrifted(drifted);
		};
		// Immediately, then at 4 Hz: a view switch or a fly that finishes just as
		// this effect re-runs should not leave the panel a quarter second behind
		// the line it is describing.
		poll();
		const id = window.setInterval(poll, 250);
		return () => window.clearInterval(id);
		// lookThroughShot / preview / ikMode are dependencies even though the
		// body never reads them directly: they are what lineEditPane branches on,
		// so a stale closure would keep measuring the camera the pane used to
		// hold and a view SWITCH — the most obvious way to invalidate a curve —
		// would go undetected. Lens and aspect changes need no dependency: they
		// move fx/fy, which the comparison sees on its own.
	}, [lineEditMode, lineCurve, lookThroughShot, preview, ikMode]);

	// Use the same bounded, coalesced probe as generation. Capabilities can
	// disappear under a live bridge too; every health result refreshes them.
	useEffect(() => {
		if (lineEditMode) bridgeRefreshRef.current();
	}, [lineEditMode]);


	return { lineEditMode, setLineEditMode, lineTrack, setLineTrack, lineRange, setLineRange, lineCurve, setLineCurve, lineDrifted, setLineDrifted, lineDriftRef, linePins, setLinePins, linePinMode, setLinePinMode, linePinDragRef, lineRadius, setLineRadius, lineDragRef, lineDrawRef, lineAutoRangeRef, lineLiveRef, lineHoverRef, lineUndoRef, lineOverlayRef, linePreviewSource, setLinePreviewSource, linePreviewSourceRef, linePreviewUrl, setLinePreviewUrl, linePreviewBusy, setLinePreviewBusy, linePreviewError, setLinePreviewError, linePreviewMs, setLinePreviewMs, linePreviewSeedRef, linePreviewTokenRef, linePreviewAbortRef, linePreviewPendingRef, linePreviewTimerRef, linePreviewShownRef , lineClipFrames, takeSourceUrl, lineEditRange, linePinRange, linePinEdit, lineEditPayload, lineCurveDirty, lineCurveHidden, lineCurvePointCount, lineEditFrom, lineEditTo, changeLineRadius, lineDriftHint, lineGrabProbe, toggleLineEditMode, exitLineEditMode, resetLineCurve, clearLineEdit, undoLineCurve, buildLineEditRequest, runLinePreview, cancelLinePreview, scheduleLinePreview, onLineStagePointerDown };
}

