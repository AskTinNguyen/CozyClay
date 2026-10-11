import {
	I2V_MOTION_STILL_OUTPUT, I2V_MOTION_SHOT_ASPECT, I2V_MOTION_MIN_DURATION,
	waitForMotionJob, submitMotionJob, buildH3MotionPrompt,
} from "../../i2v-motion-client.js";
import * as THREE from "three";
import { isKo, ko } from "../../locale.js";
import {
	isPlatformPageUrl,
	normalizeSourceUrl,
	sourceLabel,
	requestBridgeFootage,
	fetchFootageBlob,
	probeFootage,
	requestBridgeExtract,
} from "../../multimodel-ingest.js";
import { characterScaleFor, loadMotionFromUrl } from "../../ardy/npz.js";
import { autoRoofDrop, applyAutoFall } from "../../ardy/root-drop.js";
import { takeAnchor, createCharacterEntry, isProxyFigure } from "../../scenes.js";
import { kindRefusal } from "../../character-kind.js";
import { retimeMotion } from "../../ardy/retime.js";
import { createMotionEdit } from "../../ardy/motion-edit.js";
import { DEFAULT_POSE } from "../../poses.js";
import { startMotionRequest } from "../../analytics.js";
import { MULTIMODEL_REASONS, nextCharacterId, TIMELINE_FPS } from "../../app-stage.jsx";

export function createMotionVideoCapture({
	appContext,
	bridge,
	i2vMotion,
	setI2vMotion,
	multiModelUrl,
	multiModelSource,
	multiModelFootage,
	multiModelExtract,
	setMultiModelUrl,
	setMultiModelSource,
	setMultiModelStatus,
	setMultiModelStage,
	setMultiModelProgress,
	setMultiModelFootage,
	setMultiModelError,
	setMultiModelTake,
	setMultiModelExtract,
	setMultiModelExtractProgress,
	setMultiModelExtractError,
	loadMotion,
	authoredSupportDescriptors,
	applyAuthoredSupportRise,
}) {
	/* ---------------------------- video capture ----------------------------
	 * Footage in, takes out. The ingest downloads and decodes a source so the
	 * timeline is sized by what was actually read; extraction then turns it
	 * into one take per tracked performer. Take 0 belongs to the ACTIVE
	 * character's layer, the rest are landed on their own cast members. */
	// A picked file is already local bytes: no download stage, straight to the
	// probe that produces the timeline numbers.
	function chooseMultiModelFile(event) {
		const file = event.target.files?.[0] ?? null;
		if (!file) return;
		setMultiModelUrl("");
		ingestFootage({ kind: "file", name: file.name, blob: file, bytes: file.size });
	}

	async function pasteMultiModelUrl() {
		try {
			const text = await navigator.clipboard.readText();
			if (!text.trim()) return;
			setMultiModelUrl(text.trim());
			setMultiModelStatus("idle");
		} catch {
			appContext.notify(isKo ? "클립보드를 읽지 못했어요 — 직접 붙여넣어 주세요" : "Clipboard is unavailable — paste into the field directly");
		}
	}

	function useMultiModelUrl() {
		const raw = multiModelUrl.trim();
		// A platform page (YouTube, Vimeo, …) is never browser-fetchable, but
		// the dev bridge can fetch it server-side. With the bridge up the
		// address goes there; without it the named refusal below stands.
		if (isPlatformPageUrl(raw) && bridge?.ok) {
			ingestPlatformFootage(raw);
			return;
		}
		const normalized = normalizeSourceUrl(raw);
		if (!normalized.ok) {
			setMultiModelStatus("error");
			setMultiModelStage("error");
			setMultiModelError(MULTIMODEL_REASONS[normalized.reason]?.[isKo ? 1 : 0] ?? normalized.reason);
			return;
		}
		ingestFootage({ kind: "url", name: sourceLabel(normalized.url), url: normalized.url });
	}

	/** Platform page → bridge download (yt-dlp + normalize) → the local
	 *  /ardy/footage/… address rides the ordinary ingest unchanged. */
	async function ingestPlatformFootage(pageUrl) {
		const run = appContext.shared.multiModelRunRef.current + 1;
		appContext.shared.multiModelRunRef.current = run;
		const live = () => appContext.shared.multiModelRunRef.current === run;
		setMultiModelSource({ kind: "url", name: sourceLabel(pageUrl), url: pageUrl });
		setMultiModelFootage(null);
		setMultiModelError("");
		setMultiModelStatus("busy");
		setMultiModelStage("fetching");
		setMultiModelProgress(null);
		setMultiModelTake(null);
		setMultiModelExtract("idle");
		setMultiModelExtractProgress(null);
		setMultiModelExtractError("");
		try {
			const footage = await requestBridgeFootage(pageUrl, {
				onProgress: ({ ratio }) => {
					if (live()) setMultiModelProgress(Number.isFinite(ratio) ? ratio : null);
				},
			});
			if (!live()) return;
			ingestFootage({ kind: "url", name: footage.title || sourceLabel(pageUrl), url: footage.url, fps: footage.fps, bridgeId: footage.footage ?? null });
		} catch (error) {
			if (!live()) return;
			const code = error?.message ?? String(error);
			setMultiModelStage("error");
			setMultiModelStatus("error");
			setMultiModelProgress(null);
			setMultiModelError(MULTIMODEL_REASONS[code]?.[isKo ? 1 : 0] ?? code);
		}
	}

	/** Download (when remote), decode, measure, then size the timeline from what
	 *  was actually read. Each run carries a token so a slow first source can
	 *  never land its numbers after a second one replaced it. */
	async function ingestFootage(source, commandContext = null) {
		const run = appContext.shared.multiModelRunRef.current + 1;
		appContext.shared.multiModelRunRef.current = run;
		const live = () => appContext.shared.multiModelRunRef.current === run;
		setMultiModelSource(source);
		setMultiModelFootage(null);
		setMultiModelError("");
		setMultiModelStatus("busy");
		setMultiModelProgress(null);
		// A take baked from the PREVIOUS clip must not read as this one's
		// result, so the extraction state resets with the source.
		setMultiModelTake(null);
		setMultiModelExtract("idle");
		setMultiModelExtractProgress(null);
		setMultiModelExtractError("");
		try {
			let blob = source.blob ?? null;
			let bytes = source.bytes ?? 0;
			if (!blob) {
				setMultiModelStage("fetching");
				const downloaded = await fetchFootageBlob(source.url, {
					onProgress: ({ ratio }) => {
						if (live()) setMultiModelProgress(ratio);
					},
				});
				if (!live()) return;
				blob = downloaded.blob;
				bytes = downloaded.bytes;
			}
			setMultiModelStage("probing");
			if (appContext.shared.multiModelObjectUrlRef.current) URL.revokeObjectURL(appContext.shared.multiModelObjectUrlRef.current);
			const objectUrl = URL.createObjectURL(blob);
			appContext.shared.multiModelObjectUrlRef.current = objectUrl;
			const probed = await probeFootage(objectUrl, {
				createVideo: () => document.createElement("video"),
				// The bridge normalized the clip and DECLARED its rate; a probe
				// that re-guesses it would overrule a measurement with a guess.
				knownFps: Number.isFinite(source.fps) ? source.fps : null,
			});
			if (!live()) return;
			commandContext?.check();
			const footage = { ...probed, bytes, objectUrl, blob, bridgeId: source.bridgeId ?? null };
			setMultiModelFootage(footage);
			setMultiModelStage("ready");
			setMultiModelStatus("ready");
			setMultiModelProgress(1);
			// The timeline is the point: the playhead now spans the footage that
			// was actually decoded, at the rate that was actually measured.
			appContext.shared.setTlFps(footage.fps);
			appContext.shared.setTlFrameCount(footage.frames);
			appContext.shared.setTlFrame(0);
			appContext.shared.setTlPlaying(false);
			appContext.notify((isKo, ko) => isKo
				? `${source.name} 인제스트됨 — ${footage.frames}프레임 @ ${footage.fps} fps`
				: `Ingested ${source.name} — ${footage.frames} frames @ ${footage.fps} fps`);
			return footage;
		} catch (error) {
			if (commandContext && (commandContext.signal.aborted || error.code === "STALE_TARGET")) throw error;
			if (!live()) return;
			const code = error?.message ?? String(error);
			setMultiModelStage("error");
			setMultiModelStatus("error");
			setMultiModelProgress(null);
			setMultiModelError(MULTIMODEL_REASONS[code]?.[isKo ? 1 : 0] ?? code);
		}
	}

	/** Extract motion from the ingested footage. With the bridge up this goes
	 *  to the GPU box (GVHMR: whole-clip temporal context, real 3D body
	 *  prior — previs-grade). If the bridge is unavailable or is configured for
	 *  another backend, extraction stops with a named error. */
	async function extractMultiModelMotion() {
		if (!bridge?.ok) {
			setMultiModelExtract("error");
			setMultiModelExtractError(MULTIMODEL_REASONS["extract-bridge-required"]?.[isKo ? 1 : 0] ?? "extract-bridge-required");
			return;
		}
		if (bridge.extractionBackend !== "gvhmr") {
			setMultiModelExtract("error");
			setMultiModelExtractError(MULTIMODEL_REASONS["extract-backend-unsupported"]?.[isKo ? 1 : 0] ?? "extract-backend-unsupported");
			return;
		}
		return extractMultiModelMotionGpu();
	}

	async function extractMultiModelMotionGpu() {
		const footage = multiModelFootage;
		if (!footage || multiModelExtract === "running") return;
		if (isProxyFigure(appContext.shared.activeChar)) {
			setMultiModelExtract("error");
			setMultiModelExtractError(kindRefusal("mocap", isKo));
			return;
		}
		const run = appContext.shared.multiModelRunRef.current;
		const live = () => appContext.shared.multiModelRunRef.current === run;
		setMultiModelExtract("running");
		setMultiModelExtractProgress(null);
		setMultiModelExtractError("");
		setMultiModelTake(null);
		try {
			const done = await requestBridgeExtract(
				footage.bridgeId ? { footage: footage.bridgeId } : footage.blob,
				{
					onProgress: ({ ratio }) => {
						if (live()) setMultiModelExtractProgress(Number.isFinite(ratio) ? ratio : null);
					},
				}
			);
			if (!live()) return;
			if (done.quality && done.quality.pass === false) {
				const failed = Array.isArray(done.quality.checks)
					? done.quality.checks.filter((check) => check && check.pass === false).map((check) => check.name).join(", ")
					: "quality";
				appContext.notify(isKo
					? `모캡 품질 경고: ${failed || "검증 실패"} — 결과는 로드하지만 보정이 필요합니다`
					: `Mocap quality warning: ${failed || "validation failed"} — loaded for review, correction required`);
			}
			// One take per tracked performer. An older bridge sends a single
			// motionUrl and no list; that is the same thing with one entry.
			const takes = Array.isArray(done.takes) && done.takes.length
				? done.takes
				: [{ motionUrl: done.motionUrl, personScale: done.personScale, offsetX: 0, offsetZ: 0 }];
			const label = multiModelSource?.name ?? "extracted take";
			// The cast can change while the GPU works, so the destination is read
			// now, once, and every take is placed against THIS character.
			const active = appContext.live.characters.find((entry) => entry.id === appContext.shared.activeChar.id) ?? appContext.shared.activeChar;
			// Take 0 arrives as an ordinary motion npz; loadMotion decodes,
			// retimes to the 24 fps timeline, snapshots the rig baseline and
			// applies the stature stored in the take itself — the body matches
			// the FILMED person because the file carries the measurement, not
			// because this handler remembered to re-apply it afterwards.
			const fallbackScale = Number.isFinite(takes[0].personScale) ? takes[0].personScale : done.personScale;
			let personScale = await loadMotion(takes[0].motionUrl ?? done.motionUrl, label, active.rot, null, active.id, null, { personScaleFallback: fallbackScale });
			if (!live()) return;
			// loadMotion reports the stature it applied — 1 for a take that
			// stores none, nothing at all if the load failed. A failed load is
			// not a finished extraction: say so with the named reason instead
			// of a receipt for a take nobody can play.
			if (!Number.isFinite(personScale)) throw new Error("extract-convert-failed");
			// Only a take that stores NO stature gets the fallback for an npz
			// that predates person_scale (or an older bridge): the response
			// still carries the estimate, clamped the same way, because a bad
			// leg estimate must never produce a giant or a gnome.
			const declared = Number.isFinite(takes[0].personScale) ? takes[0].personScale : done.personScale;
			if (personScale === 1 && Number.isFinite(declared)) {
				personScale = characterScaleFor(null, declared);
			}
			// The clip itself is session-only; this reference is what a save
			// keeps and restoreMotionRefs re-fetches on the next session.
			const leadRef = {
				url: takes[0].motionUrl ?? done.motionUrl,
				prompt: label,
				rotationDeg: active.rot,
				anchorX: active.x,
				anchorZ: active.z,
			};
			if (!appContext.storeDomain('motion')) appContext.shared.publishStudioCharacters((list) => list.map((entry) => entry.id === active.id
				? { ...entry, scale: personScale, motionRef: leadRef }
				: entry));
			const placed = await deliverExtraTakes(takes.slice(1), active, label);
			if (!live()) return;
			const persons = 1 + placed;
			setMultiModelTake({ frames: done.frames, fps: done.fps, gpu: true, personScale, persons, trajectory: done.performance?.trajectory, segmentation: done.segmentation ?? done.performance?.segmentation ?? takes[0]?.segmentation ?? null, quality: done.quality ?? takes[0]?.quality ?? null });
			setMultiModelExtract("done");
			appContext.notify(isKo
				? `GPU 모션 추출됨 — ${done.frames}프레임 @ ${done.fps} fps${persons > 1 ? ` · ${persons}명` : ""} · 인물 스케일 ×${personScale.toFixed(2)}`
				: `GPU motion extracted — ${done.frames} frames @ ${done.fps} fps${persons > 1 ? ` · ${persons} performers` : ""} · person scale ×${personScale.toFixed(2)}`);
		} catch (error) {
			if (!live()) return;
			const code = error?.message ?? String(error);
			setMultiModelExtract("error");
			setMultiModelExtractError(MULTIMODEL_REASONS[code]?.[isKo ? 1 : 0] ?? code);
		}
	}

	async function deliverExtraTakes(extras, active, label) {
		const decoded = await Promise.all(extras.map(async (take, index) => {
			if (typeof take?.motionUrl !== "string" || !take.motionUrl) return null;
			try {
				// Inbound boundary, exactly like every other clip: decode, then
				// retime onto the production clock before anything counts frames.
				const anchor = takeAnchor(active, take.offsetX, take.offsetZ);
				const clip = retimeMotion(await loadMotionFromUrl(take.motionUrl), TIMELINE_FPS);
				const scale = characterScaleFor(clip, take.personScale);
				const raised = applyAuthoredSupportRise(clip, { ...anchor, y: active.y ?? 0 }, active.rot, scale);
				const staging = autoRoofDrop(
					raised,
					{ x: anchor.x, z: anchor.z, y: active.y ?? 0, rotationDeg: active.rot },
					authoredSupportDescriptors(),
					{ worldScale: scale },
				);
				const stagedClip = staging ? applyAutoFall(raised, staging, { worldScale: scale }) : raised;
				return {
					url: take.motionUrl,
					prompt: `${label} · ${index + 2}`,
					rotationDeg: active.rot,
					anchor,
					// A second performer is a DIFFERENT body: their take carries
					// their own stature, and the response estimate is only the
					// fallback for an npz that stores none.
					scale: characterScaleFor(clip, take.personScale),
					clip: stagedClip,
				};
			} catch {
				return null; // one unreadable take never voids the others
			}
		}));
		const usable = decoded.filter(Boolean);
		if (!usable.length) return 0;
		const owned = appContext.storeDomain('motion');
		// Plan against the cast as it stands, so ids are decided once and the
		// full-take map can be seeded with them.
		const list = appContext.live.characters;
		const taken = new Set([active.id]);
		let idPool = list;
		const assignments = usable.map((take) => {
			// Reuse a visible cast member with no clip of its own before adding
			// another body to the set.
			const reuse = list.find((entry) => !entry.hidden && !isProxyFigure(entry) && !taken.has(entry.id) && !entry.sessionMotion && !entry.motionRef);
			const id = reuse ? reuse.id : nextCharacterId(idPool);
			if (!reuse) idPool = [...idPool, { id }];
			taken.add(id);
			return {
				id,
				spawn: !reuse,
				patch: {
					hidden: false,
					x: take.anchor.x,
					z: take.anchor.z,
					rot: take.rotationDeg,
					scale: take.scale,
					motionRef: {
						url: take.url,
						prompt: take.prompt,
						rotationDeg: take.rotationDeg,
						anchorX: take.anchor.x,
						anchorZ: take.anchor.z,
					},
					sessionMotion: {
						...take.clip,
						url: take.url,
						prompt: take.prompt,
						anchorX: take.anchor.x,
						anchorZ: take.anchor.z,
						anchorFrame: 0,
						rotationDeg: take.rotationDeg,
						editSegments: createMotionEdit(take.clip.frames),
					},
				},
			};
		});
		const place = current => {
			let next = current;
			for (const { id, spawn, patch } of assignments) {
				next = spawn && !next.some((entry) => entry.id === id)
					? [...next, { ...createCharacterEntry({ id, model: active.model, pose: DEFAULT_POSE, subject: "a person" }, next.length), ...patch }]
					: next.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
			}
			return next;
		};
		if (owned) owned.runPrepared(active.id, () => {
			owned.castWrite(place);
			for (const { id, patch } of assignments) { owned.replace(id, patch.sessionMotion); owned.persistTake(patch.sessionMotion, patch.motionRef); }
			return { affectedIds: assignments.map(row => row.id) };
		});
		else {
			appContext.shared.publishStudioCharacters(place);
			// Their takes are trimmable the moment they become the active layer.
			for (const { id, patch } of assignments) appContext.shared.motionFullRef.current.set(id, patch.sessionMotion);
		}
		return assignments.length;
	}

	function captureI2vStill() {
		// H3 480P renders 832x480. The still is captured at exactly that canvas
		// (x2) regardless of the Studio's shot ratio; markI2vPose also switches
		// the viewport to the matching ratio so what the user framed is what
		// gets sent.
		const captured = appContext.shared.captureLiveFraming({ output: I2V_MOTION_STILL_OUTPUT });
		if (!captured?.dataUrl?.startsWith("data:image/")) throw new Error(ko("The shot renderer is not ready.", "렌더러가 준비되지 않았어요."));
		if (captured.width !== I2V_MOTION_STILL_OUTPUT.width || captured.height !== I2V_MOTION_STILL_OUTPUT.height) {
			throw new Error(ko(`The H3 480P reference must be captured at ${I2V_MOTION_STILL_OUTPUT.width}×${I2V_MOTION_STILL_OUTPUT.height}.`, `H3 480P 참조 캡처는 ${I2V_MOTION_STILL_OUTPUT.width}×${I2V_MOTION_STILL_OUTPUT.height}이어야 해요.`));
		}
		// H3 must see the same complete subject in both endpoints. A clipped
		// foot or head makes the model invent the missing geometry during the
		// transition, which is exactly the bad motion this flow is meant to avoid.
		const rig = appContext.live.state.rigs?.[appContext.shared.activeChar.id];
		const cam = appContext.shared.shotCamRef.current;
		if (!rig || !cam) throw new Error(ko("The full-body frame is not ready yet. Wait a moment and try the reference capture again.", "전신 프레임을 확인할 수 없어 참조를 캡처할 수 없어요. 잠시 후 다시 시도하세요."));
		rig.updateWorldMatrix(true, true);
		cam.updateMatrixWorld(true);
		const bounds = new THREE.Box3().setFromObject(rig);
		const corners = [
			new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
			new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
			new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
			new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
			new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
			new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
			new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
			new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
		].map((corner) => corner.project(cam));
		const margin = 0.94;
		const clipped = corners.some((corner) =>
			corner.z < -1 || corner.z > 1 || Math.abs(corner.x) > margin || Math.abs(corner.y) > margin
		);
		if (clipped) {
			throw new Error(ko(
				"The full character is not inside the A/B reference. In the shot view, pull the camera back until the head and both feet are visible, then capture again.",
				"A/B 참조에 캐릭터 전신이 다 안 들어왔어요. 샷 시점에서 머리와 양발이 화면 안에 들어오도록 카메라를 뒤로 빼고 다시 캡처하세요."
			));
		}
		if (!appContext.shared.i2vMotionSegmentationReady || !Array.isArray(captured.partColours) || captured.partColours.length === 0) {
			throw new Error(ko("Enable View → Body part colours → Shaded before capturing an A/B reference.", "A/B 참조는 View에서 부위 색상 → 음영을 켜야 캡처할 수 있어요."));
		}
		return { ...captured, framing: appContext.shared.captureCurrentFraming() };
	}
	/** Put the viewport on the Fal canvas and hand the fly controls to the
	 * shot camera, so the user composes the A/B reference on exactly the
	 * 832x480 frame the clip will have. Idempotent; capture does not need it. */
	function enterI2vFraming() {
		appContext.shared.runStudioAction("stage.setFilmback", { shotAspect: I2V_MOTION_SHOT_ASPECT });
		if (!appContext.shared.lookThroughShot) appContext.shared.enterShotLook();
	}
	function markI2vPose(slot) {
		try {
			if (slot === "b" && i2vMotion.a && framingDistance(i2vMotion.a.framing, appContext.shared.captureCurrentFraming()) > 0.001) {
				throw new Error(ko("The camera moved between A and B. Capture both refs with the same camera framing.", "A와 B 사이에서 카메라가 이동했어요. 같은 카메라 프레이밍으로 다시 캡처하세요."));
			}
			const still = captureI2vStill();
			// The capture is already on the Fal canvas; make the viewport agree so
			// the user sees the frame that was just sent.
			appContext.shared.runStudioAction("stage.setFilmback", { shotAspect: I2V_MOTION_SHOT_ASPECT });
			setI2vMotion((current) => ({ ...current, [slot]: still, status: "idle", error: "" }));
			if (slot === "a") appContext.shared.setI2vMotionCameraUnlocked(false);
			appContext.notify(isKo ? `포즈 ${slot.toUpperCase()} 캡처됨 · ${still.width}×${still.height}` : `Pose ${slot.toUpperCase()} captured · ${still.width}×${still.height}`);
		} catch (error) {
			setI2vMotion((current) => ({ ...current, error: error.message, status: "error" }));
		}
	}
	function clearI2vPose(slot) {
		setI2vMotion((current) => ({ ...current, [slot]: null, status: "idle", error: "", job: null }));
		if (slot === "a") appContext.shared.setI2vMotionCameraUnlocked(false);
	}
	function clearI2vMotion() {
		setI2vMotion({ a: null, b: null, job: null, status: "idle", error: "", instruction: "", promptOverride: "", duration: I2V_MOTION_MIN_DURATION, dailyRemaining: null });
		appContext.shared.setI2vMotionCameraUnlocked(false);
	}
	function restoreI2vCamera() {
		const framing = i2vMotion.a?.framing;
		const camera = appContext.shared.shotCamRef.current;
		if (!framing || !camera) return;
		camera.position.set(framing.pos.x, framing.pos.y, framing.pos.z);
		camera.rotation.order = "YXZ";
		camera.rotation.set(framing.pitch, framing.yaw, 0);
		camera.fov = framing.fovDeg;
		camera.updateProjectionMatrix();
		appContext.shared.look.current.yaw = framing.yaw;
		appContext.shared.look.current.pitch = framing.pitch;
		appContext.shared.shotCameraPosRef.current = { ...framing.pos };
		appContext.shared.setCameraPos({ ...framing.pos });
		appContext.shared.setFovDeg(framing.fovDeg);
		appContext.shared.setI2vMotionCameraUnlocked(false);
		setI2vMotion((current) => ({ ...current, error: "", status: "idle" }));
		appContext.notify(isKo ? "A 캡처 카메라로 복원했어요." : "Restored the camera used for A.");
	}
	function framingDistance(a, b) {
		if (!a || !b) return Infinity;
		return Math.max(
			Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y), Math.abs(a.pos.z - b.pos.z),
			Math.abs(a.yaw - b.yaw), Math.abs(a.pitch - b.pitch), Math.abs(a.fovDeg - b.fovDeg),
		);
	}
	/** The AI motion card's lock line: AI video motion is not enabled for this account. */
	function showI2vMotionLock() {
		setI2vMotion((current) => ({ ...current, error: ko("AI motion generation is locked during QA.", "AI 모션 생성은 QA 중 잠겨 있어요."), status: "error" }));
	}
	/** The AI motion card shows every failure itself. For motion.generateFromVideo the
	 * answer says what happened: `{ failed }` with the reason in English, or the
	 * finished job, the footage it was ingested as (null when ingest failed) and
	 * the account's daily generations left. */
	async function generateI2vMotion(kind = "interpolate", instructionOverride = null, commandContext = null) {
		// One explicit request on the motion:* contract (#466). While the route is
		// gated, the lock itself is the demand signal. Telemetry never decides.
		const motionRequest = startMotionRequest({
			surface: !commandContext ? "fal_card" : commandContext.origin === "mcp" || commandContext.origin === "live" ? "mcp" : "agent",
			input_mode: kind === "interpolate" ? "a_to_b" : "still",
		});
		if (!appContext.shared.i2vMotionEnabled) {
			motionRequest.block("locked");
			showI2vMotionLock();
			return { failed: "AI video motion (Fal) is not enabled for this account." };
		}
		let source = i2vMotion;
		if (kind === "act" && !source.a) {
			try { source = { ...source, a: captureI2vStill() }; setI2vMotion((current) => ({ ...current, a: source.a })); }
			catch (error) {
				motionRequest.block("missing_input");
				setI2vMotion((current) => ({ ...current, error: error.message, status: "error" }));
				return { failed: "Could not capture the character's pose frame: the full body must be inside the shot frame, shaded part colours must be on (view.setPartColours { mode: \"shaded\" }), and the renderer and rig must be ready." };
			}
		}
		if (kind === "interpolate" && (!source.a || !source.b)) {
			motionRequest.block("missing_input");
			setI2vMotion((current) => ({ ...current, error: ko("Capture both A and B poses first.", "A와 B 포즈를 먼저 캡처하세요."), status: "error" }));
			return { failed: "Capture both A and B poses first." };
		}
		if (!source.a?.partColours || (kind === "interpolate" && !source.b?.partColours)) {
			motionRequest.block("missing_input");
			setI2vMotion((current) => ({ ...current, error: ko("Recapture A/B refs with shaded body-part segmentation enabled.", "색 세그멘테이션이 포함된 음영 A/B 참조를 다시 캡처하세요."), status: "error" }));
			return { failed: "The captured pose frame has no shaded body-part segmentation; the user must recapture it in the Fal card with shaded part colours on." };
		}
		if (kind === "interpolate" && framingDistance(source.a.framing, source.b.framing) > 0.001) {
			motionRequest.block("missing_input");
			setI2vMotion((current) => ({ ...current, error: ko("The camera changed between A and B. Capture both poses with the same camera.", "A와 B 사이에서 카메라가 바뀌었어요. 같은 카메라로 다시 캡처하세요."), status: "error" }));
			return { failed: "The camera changed between poses A and B; capture both with the same camera." };
		}
		// A hand-edited prompt wins verbatim; otherwise build from the description.
		// Interpolate now honours the description too (#380): the bare pose
		// difference lets the model invent the transition and produces junk.
		const description = instructionOverride || source.instruction || "";
		const prompt = source.promptOverride?.trim()
			? source.promptOverride.trim()
			: buildH3MotionPrompt(description || (kind === "interpolate" ? "" : "Make the character perform the requested action."), { interpolate: kind === "interpolate" });
		setI2vMotion((current) => ({ ...current, status: "submitting", error: "", job: null }));
		motionRequest.pass("fal");
		motionRequest.start();
		try {
			const fetchImpl = commandContext ? (url, options) => fetch(url, { ...options, signal: commandContext.signal }) : undefined;
			const submitted = await submitMotionJob({
				kind,
				stillA: source.a?.dataUrl,
				stillB: source.b?.dataUrl,
				still: source.a?.dataUrl,
				prompt,
				duration: source.duration ?? I2V_MOTION_MIN_DURATION,
			}, fetchImpl);
			const id = submitted?.job?.id;
			if (!id) throw Object.assign(new Error(ko("The server did not return a motion job ID.", "생성 작업 ID를 받지 못했어요.")), { reason: "The motion server did not return a job id." });
			setI2vMotion((current) => ({ ...current, status: "queued", job: submitted.job, dailyRemaining: submitted.dailyRemaining }));
			const finished = await waitForMotionJob(id, {
				fetchImpl,
				onUpdate: (job) => setI2vMotion((current) => ({ ...current, job, status: job?.status ?? current.status })),
			});
			commandContext?.check();
			const job = finished?.job;
			if (job?.status !== "done") throw Object.assign(new Error(job?.error || ko("AI motion generation failed.", "AI 모션 생성에 실패했어요.")), job?.error ? {} : { reason: "The AI video generation failed." });
			motionRequest.succeed();
			setI2vMotion((current) => ({ ...current, job, status: "done", dailyRemaining: finished.dailyRemaining }));
			let footage = null;
			if (job.video?.url) {
				const motionSource = { kind: "url", url: job.video.url, name: `Fal H3 Max Turbo · ${job.resolution}` };
				setMultiModelSource(motionSource);
				// Put the completed clip through the same probe/ingest path as a
				// manually supplied URL so GVHMR sees measured fps, duration and
				// a ready extraction card without another generation request.
				footage = (await ingestFootage(motionSource, commandContext)) ?? null;
				appContext.shared.setResult({
					mode: "video",
					modelLabel: "Fal H3 Max Turbo",
					prompt,
					frame: source.a?.dataUrl ?? null,
					videoUrl: job.video.url,
					motion: {
						videoUrl: job.video.url,
						resolution: job.resolution,
						width: job.width,
						height: job.height,
						fps: job.fps,
						duration: job.resultDuration ?? job.duration,
						cost: job.cost,
					},
				});
				appContext.shared.setResultOpen(true);
				// Applied = the clip is in the Studio, ready for GVHMR extraction.
				motionRequest.apply();
				// The result modal and the studio modal are both z-30; never stack them.
				appContext.shared.setI2vMotionStudioOpen(false);
				appContext.notify((isKo, ko) => isKo ? "AI 영상이 준비됐어요 · 추출 패널에서 GVHMR을 실행하세요" : "AI video is ready · run GVHMR from the extraction panel");
			}
			return { job, footage, dailyRemaining: finished.dailyRemaining ?? null };
		} catch (error) {
			const cancelled = Boolean(commandContext && (commandContext.signal.aborted || error?.code === "STALE_TARGET"));
			// 429 is the account's daily cap (workers/api daily_cap).
			motionRequest.fail(error, cancelled ? "aborted" : error?.status === 429 ? "quota" : "generation_failed");
			if (cancelled) throw error;
			setI2vMotion((current) => ({ ...current, status: "error", error: error.message || String(error) }));
			return { failed: error.reason ?? `The AI video generation failed: ${error.message || error}` };
		}
	}
	/** Why the chip cannot start an AI video motion now, as the user reads it:
	 * one already running, or none left today. The lock has its own AI motion card line. */
	function i2vMotionUnavailable() {
		if (!["idle", "done", "error", "failed"].includes(i2vMotion.status)) return ko("A generation is already running", "이미 생성이 돌고 있어요");
		if (i2vMotion.dailyRemaining === 0) return ko("No AI video motion generations left today", "오늘 남은 AI 영상 모션 생성이 없어요");
		return null;
	}
	function generateI2vMotionFromUi(instruction) {
		if (!appContext.shared.i2vMotionEnabled) {
			// Locked, the action's availability check refuses before
			// generateI2vMotion runs, so the chip records its own lock (#466).
			startMotionRequest({ surface: "agent", input_mode: "still" }).block("locked");
			showI2vMotionLock();
		} else {
			// The chip clears the typed instruction when clicked, so a refusal says why.
			const reason = i2vMotionUnavailable();
			if (reason) { appContext.notify(reason); return null; }
		}
		return appContext.shared.runStudioAction("motion.generateFromVideo", { instruction });
	}
	function updateI2vMotionQuota(dailyRemaining) { setI2vMotion((current) => ({ ...current, dailyRemaining })); }
	return {
		chooseMultiModelFile,
		pasteMultiModelUrl,
		useMultiModelUrl,
		ingestPlatformFootage,
		ingestFootage,
		extractMultiModelMotion,
		extractMultiModelMotionGpu,
		deliverExtraTakes,
		captureI2vStill,
		enterI2vFraming,
		markI2vPose,
		clearI2vPose,
		clearI2vMotion,
		restoreI2vCamera,
		framingDistance,
		showI2vMotionLock,
		generateI2vMotion,
		i2vMotionUnavailable,
		generateI2vMotionFromUi,
		updateI2vMotionQuota,
	};
}
