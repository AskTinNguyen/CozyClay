import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Line, useFBX } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { ProxyFigure } from "./proxy-figure.jsx";
import { isProxyFigure } from "./scenes.js";
import { applyPartColours } from "./part-colours.js";
import { applyHipsOffset, applyPose, primeBindPose } from "./poses.js";
import { TRAIL_TRACKS, falloffWeight, jointTrailPoints, trailEditRange } from "./motion-trail.js";
import { pickTrailPoint } from "./trail-pick.js";
import { REST_BONES } from "./stage-startup-defaults.js";

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
