import { useEffect, useRef, useState } from "react";

export function useStudioExports({
	IK_CORRECTION_BLEND_FRAMES,
	STORYBOARD_FONT,
	activeChar,
	activeCharacterId,
	activeSceneId,
	activeShot,
	asset,
	assetRecord,
	back,
	box,
	buildKeyframePack,
	buildShotPrompt,
	buildZip,
	bufferToPng,
	camera,
	cancelled,
	captureFraming,
	captureRef,
	characterViews,
	characters,
	composeStoryboard,
	DEPTH_RANGE_M,
	depthRangeFromFrames,
	embedMode,
	environment,
	environmentImage,
	exportFailureCode,
	exportOffscreenVideo,
	fovDeg,
	height,
	ikStateRef,
	ikStatesRef,
	isKo,
	isProxyFigure,
	keyLight,
	ko,
	look,
	motion,
	multiModelFootage,
	playbackScene,
	placementAt,
	poseMemberAtFrame,
	propFrameRef,
	propSyncRef,
	playgroundMode,
	promptClips,
	rigs,
	renderPass,
	restorePlaybackBones,
	sampleAt,
	scenes,
	sceneObjects,
	serializeOtio,
	setCameraTutorialHandoff,
	setRecordedVideoName,
	setToast,
	setUseCaseAskOpen,
	shot,
	shotAspectKey,
	shotAtFrame,
	shotCamRef,
	shotCaptureMeta,
	shotIndexAtFrame,
	shotOutput,
	shots,
	snapshotIkKeys,
	startExportAttempt,
	storyboardCaption,
	storyboardLine,
	syncCarriers,
	TIMELINE_FPS,
	tlFps,
	tlFrame,
	tlFrameCount,
	track,
	trackActivation,
	trackFeature
}) {
	/* --------------------------- shot video export --------------------------- */
	// Record is an offline frame-addressed export. It never starts playback and
	// never samples a wall clock: sampleAt applies one absolute timeline frame,
	// CaptureRig reads the shot camera's WebGLRenderTarget, and WebCodecs receives
	// exactly one VideoFrame for every address in the inclusive export range.
	const [recState, setRecState] = useState("idle"); // "idle" | "recording"
	const recRef = useRef(null);
	const tlFrameRef = useRef(0);
	tlFrameRef.current = tlFrame;
	const [exportStatus, setExportStatus] = useState(null);
	const retryExportRef = useRef(null);
	const frameExportRef = useRef(null);

	// Snapshot authored inputs once, not when Retry is pressed. Runtime render
	// resources are acquired per attempt; they are never part of the snapshot.
	function exportRequest(kind, run, { exportShots = shots, external = false, download = true } = {}) {
		// IK's cached chains contain live Three bones/functions, not cloneable
		// authored data. Retain that binding and copy only the evaluated keys.
		const copyIk = (state) => state ? { ...state, keys: snapshotIkKeys(state), tracked: new Set(state.tracked) } : state;
		const context = kind === "frame" ? null : {
			...structuredClone({ shots: exportShots, playbackScene, characters, activeId: activeChar.id, motion,
				framing: captureCurrentFraming(), output: shotOutput }),
			ikState: copyIk(ikStateRef.current),
			ikStates: new Map([...ikStatesRef.current].map(([id, state]) => [id, copyIk(state)])),
			rigStates: Object.values(rigs).filter(Boolean).map(snapshotExportRig),
		};
		return Object.freeze({ kind, format: kind === "frame" || kind === "contact_sheet" ? "png" : kind === "keyframe_pack" || kind === "panel_pack" ? "zip" : "mp4",
			context, run, external, download, handedOff: new Set() });
	}

	function exportRecovery(code) {
		switch (code) {
			case "unsupported_codec": return ko("MP4 encoding is unavailable. Use a current browser with H.264 WebCodecs support (such as Chrome or Edge), enable hardware acceleration, then retry.", "MP4 인코딩을 사용할 수 없어요. H.264 WebCodecs를 지원하는 최신 Chrome·Edge 등에서 하드웨어 가속을 켠 뒤 다시 시도하세요.");
			case "encode_failed": return ko("Video encoding failed. Retry the same request. If resources are tight, shorten the shot range or lower output resolution before starting a new export.", "영상 인코딩에 실패했어요. 같은 요청을 다시 시도하세요. 리소스가 부족하면 샷 범위를 줄이거나 출력 해상도를 낮춘 뒤 새로 내보내세요.");
			case "render_failed": return ko("Frame rendering failed. Let the scene finish loading, then retry. If it repeats, shorten the range or reduce output resolution for a new export.", "프레임 렌더링에 실패했어요. 장면 로딩이 끝난 뒤 다시 시도하세요. 반복되면 범위나 출력 해상도를 줄여 새로 내보내세요.");
			case "aborted": return ko("Export cancelled. No further downloads will be requested.", "내보내기를 취소했어요. 추가 다운로드는 요청하지 않아요.");
			default: return ko("Export could not finish. Retry the same request. For memory or resource problems, close other heavy tabs or use a shorter range / lower output resolution in a new export.", "내보내기를 완료하지 못했어요. 같은 요청을 다시 시도하세요. 메모리·리소스 문제라면 무거운 탭을 닫거나 범위·출력 해상도를 줄여 새로 내보내세요.");
		}
	}

	function updateExportStatus(job, phase, details = {}) {
		if (recRef.current !== job) return;
		job.cancellable = details.cancellable ?? false;
		setExportStatus({ kind: job.request.kind, phase, label: job.label, ...details });
	}

	// Yield to input between real work units, not a progress timer. This also
	// lets the preparing state render before synchronous PNG/ZIP work begins.
	function exportBoundary(job) {
		job.controller.signal.throwIfAborted();
		return new Promise((resolve) => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
			channel.port2.postMessage(null);
		}).then(() => job.controller.signal.throwIfAborted());
	}

	async function executeExportRequest(request) {
		// A synchronous ref, shared by ALL four kinds and retry, is authoritative.
		// React's busy state alone cannot guard two calls in the same event turn.
		if (recRef.current) {
			if (request.external) throw new Error(ko("An export is already running", "이미 내보내기 중입니다"));
			return null;
		}
		const job = { request, controller: new AbortController(), capture: null, cancellable: false };
		recRef.current = job;
		retryExportRef.current = request;
		setRecState("recording");
		const attempt = request.external ? null : startExportAttempt({ export_kind: request.kind, format: request.format, surface: embedMode ? "embed" : "studio" });
		updateExportStatus(job, "preparing", { cancellable: request.kind !== "frame" });
		try {
			await exportBoundary(job);
			if (request.context) {
				if (!captureRef.current || !shotCamRef.current) throw Object.assign(new Error("The shot renderer is not ready"), { exportFailureCode: "render_failed" });
				job.capture = captureRef.current.createExportCapture(request.context.output);
			}
			const output = await request.run(job);
			job.controller.signal.throwIfAborted();
			attempt?.succeed();
			updateExportStatus(job, "completed", { message: request.download
				? ko("Export completed. Download requested; check your browser's downloads. The OS save is not confirmed.", "내보내기를 완료하고 다운로드를 요청했어요. 브라우저 다운로드를 확인하세요. OS 저장 완료는 확인할 수 없어요.")
				: ko("Export pipeline completed. The requesting tool handles the file handoff.", "내보내기 처리를 완료했어요. 요청한 도구에서 파일 전달을 처리합니다.") });
			if (!request.external) {
				if (request.kind === "video") { track("export:video_succeeded", { format: "mp4" }); trackFeature("export_video"); }
				if (request.kind === "depth_video") trackFeature("export_depth_video");
				if (request.kind === "keyframe_pack") trackFeature("export_keyframe_pack");
				if (request.kind === "frame") {
					track("export:blocking_frame_succeeded", { format: "png" });
					trackFeature("export_frame"); trackActivation("export");
				}
				// A real deliverable is the moment the use-case question is worth
				// asking; never in embeds, and only while telemetry is on.
				try {
					if (!embedMode && !playgroundMode && ["video", "frame", "depth_video"].includes(request.kind) && shouldAskUseCase()) setUseCaseAskOpen(true);
				} catch {
					// The optional question can never turn a finished export into a failure.
				}
			}
			return output;
		} catch (error) {
			const code = exportFailureCode(error, request.kind === "depth_video" ? "render_failed" : "unknown");
			attempt?.fail(error, code);
			const message = exportRecovery(code);
			updateExportStatus(job, code === "aborted" ? "cancelled" : "failed", {
				code, message, retryable: !request.external, handedOff: request.handedOff.size,
			});
			setToast(message);
			if (request.external) throw error;
			return null;
		} finally {
			try { job.capture?.dispose(); }
			finally { if (recRef.current === job) recRef.current = null; setRecState("idle"); }
		}
	}

	function retryExport() {
		if (recRef.current || !retryExportRef.current || retryExportRef.current.external) return;
		return executeExportRequest(retryExportRef.current);
	}

	function applyExportFrame(frame) {
		// Props on a travel path read this ref inside their own useFrame, so a
		// recorded frame shows the same placement the preview would.
		propFrameRef.current = frame;
		const context = recRef.current?.request.context;
		for (const entry of context?.characters ?? characters) {
			if (isProxyFigure(entry)) continue;
			const activeId = context?.activeId ?? activeChar.id;
			const clip = entry.id === activeId ? (context ? context.motion : motion) : entry.sessionMotion;
			const state = context
				? (entry.id === activeId ? context.ikState : context.ikStates.get(entry.id))
				: (entry.id === activeChar.id ? ikStateRef.current : ikStatesRef.current.get(entry.id));
			const placement = placementAt(entry, frame, {
				shotAt: at => shotAtFrame(context?.shots ?? shots, at),
				takeRoot: clip ? sampleAt({ frameCount: clip.frames, motion: clip }, null, frame).subject : null,
			});
			poseMemberAtFrame(rigs[entry.id], clip, state, frame, IK_CORRECTION_BLEND_FRAMES, placement.pose ?? null);
		}
		// The bones for this frame are now written, so a carried prop can take
		// its place on them. gl.render() never runs the r3f frame loop, so this
		// pass is the recorder's stand-in for the useFrame the preview gets.
		// Riding characters move with their object first, then the props.
		syncCarriers();
		propSyncRef.current?.();
		const sampled = sampleAt(context?.playbackScene ?? playbackScene, shotAtFrame(context?.shots ?? shots, frame), frame);
		const framing = sampled.camera ?? context?.framing;
		const cam = shotCamRef.current;
		if (cam && framing) {
			cam.position.set(framing.pos.x, framing.pos.y, framing.pos.z);
			cam.rotation.order = "YXZ";
			cam.rotation.set(framing.pitch, framing.yaw, 0);
			look.current.yaw = framing.yaw;
			look.current.pitch = framing.pitch;
			cam.fov = framing.fovDeg;
			cam.updateProjectionMatrix();
		}
		return (recRef.current?.capture ?? captureRef.current)?.render() ?? null;
	}

	function snapshotExportRig(rig) {
		return { rig, bones: snapshotPlaybackBones(rig), scale: rig.scale.clone(),
			parent: rig.parent ? { node: rig.parent, position: rig.parent.position.clone(), quaternion: rig.parent.quaternion.clone() } : null };
	}

	function restoreExportRig(snapshot) {
		snapshot.rig.scale.copy(snapshot.scale);
		if (snapshot.parent) {
			snapshot.parent.node.position.copy(snapshot.parent.position);
			snapshot.parent.node.quaternion.copy(snapshot.parent.quaternion);
			snapshot.parent.node.updateMatrixWorld(true);
		}
		restorePlaybackBones(snapshot.rig, snapshot.bones);
	}

	// Restore at each synchronous capture boundary, including the depth
	// prepass, rather than holding an export pose across a hash/codec await.
	function withExportFrame(frame, render = null) {
		const cam = shotCamRef.current;
		if (!cam) throw Object.assign(new Error("The shot renderer is not ready"), { exportFailureCode: "render_failed" });
		const cameraSnapshot = { position: cam.position.clone(), quaternion: cam.quaternion.clone(),
			rotationOrder: cam.rotation.order, fov: cam.fov, yaw: look.current.yaw, pitch: look.current.pitch };
		const rigSnapshots = Object.values(rigs).filter(Boolean).map(snapshotExportRig);
		const proxySnapshots = [];
		const context = recRef.current?.request.context;
		const cast = context?.characters ?? characters;
		const scene = (recRef.current?.capture ?? captureRef.current)?.scene;
		const pickIdByCharacter = new Map(characterViews.map(view => [view.id, view.pickId]));
		if (typeof scene?.traverse === "function") scene.traverse(node => {
			const index = cast.findIndex(entry => isProxyFigure(entry) && node.userData.characterPick === pickIdByCharacter.get(entry.id));
			if (index < 0) return;
			proxySnapshots.push({ node, entry: cast[index], position: node.position.clone(), quaternion: node.quaternion.clone() });
		});
		const propFrame = propFrameRef.current;
		try {
			// Character stature lives on the rig and placement/yaw on its parent,
			// not in playback bones. Retry temporarily restores both, plus the
			// original held pose, then puts the CURRENT editor transforms back.
			for (const snapshot of recRef.current?.request.context?.rigStates ?? []) restoreExportRig(snapshot);
			for (const { node, entry } of proxySnapshots) {
				const clip = entry.id === (context?.activeId ?? activeChar.id) ? (context ? context.motion : motion) : entry.sessionMotion;
				const placement = placementAt(entry, frame, {
					shotAt: at => shotAtFrame(context?.shots ?? shots, at),
					takeRoot: clip ? sampleAt({ frameCount: clip.frames, motion: clip }, null, frame).subject : null,
				});
				node.position.set(placement.x, entry.y ?? 0, placement.z);
				node.rotation.y = proxyYaw(placement.rot, placement.posture);
				node.updateMatrixWorld(true);
			}
			const plate = applyExportFrame(frame);
			return render ? render() : plate;
		} catch (error) {
			throw Object.assign(new Error(error?.message || String(error), { cause: error }), { exportFailureCode: exportFailureCode(error, "render_failed") });
		} finally {
			for (const snapshot of rigSnapshots) restoreExportRig(snapshot);
			for (const { node, position, quaternion } of proxySnapshots) {
				node.position.copy(position);
				node.quaternion.copy(quaternion);
				node.updateMatrixWorld(true);
			}
			cam.position.copy(cameraSnapshot.position);
			cam.rotation.order = cameraSnapshot.rotationOrder;
			cam.quaternion.copy(cameraSnapshot.quaternion);
			cam.fov = cameraSnapshot.fov;
			cam.updateProjectionMatrix();
			look.current.yaw = cameraSnapshot.yaw;
			look.current.pitch = cameraSnapshot.pitch;
			propFrameRef.current = propFrame;
			syncCarriers();
			propSyncRef.current?.();
		}
	}

	function currentRecordFrameCount() {
		const contentExtent = timelineContentExtent(
			characters,
			activeChar.id,
			motion,
			promptClips,
			multiModelFootage?.frames,
		);
		// Camera-only scenes still use their authored production duration. Once
		// motion or prompt content exists, content is the authoritative record
		// range even if an older timeline count was left behind.
		return contentExtent > 0 ? contentExtent : tlFrameCount;
	}

	async function runShotExport({ startFrame = 0, endFrame, download = true, passKind = null, depthRange = null, fileName = null } = {}, job = null) {
		const resolvedEndFrame = endFrame ?? Math.max(0, currentRecordFrameCount() - 1);
		// Preserve the download-free browser seam, without a nested lifecycle.
		if (!job) return executeExportRequest(exportRequest(passKind === "depth" ? "depth_video" : "video",
			(ownedJob) => runShotExport({ startFrame, endFrame: resolvedEndFrame, download, passKind, depthRange, fileName }, ownedJob),
			{ external: true, download }));
		job.controller.signal.throwIfAborted();
		const output = job.request.context.output;
		const result = await exportOffscreenVideo({
			startFrame, endFrame: resolvedEndFrame, fps: TIMELINE_FPS,
			width: output.width, height: output.height,
			capture: (frame, kind) => withExportFrame(frame, kind
				? () => renderPass(job.capture, job.capture.scene, shotCamRef.current, kind, null, { depthRange }) : null),
			passKind, signal: job.controller.signal,
			onFrame: ({ index, frameCount }) => updateExportStatus(job, "encoding", {
				completedFrames: index + 1, frameCount, cancellable: true,
			}),
			onPhase: ({ phase, stage, cancellable }) => updateExportStatus(job, phase, { stage, cancellable }),
		});
		job.controller.signal.throwIfAborted();
		if (download) {
			const slate = (moveSequence?.slate ?? "shot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shot";
			// Default plate filename: const name = `cozyclay-${slate}.mp4`
			const name = fileName ?? `cozyclay-${slate}.mp4`;
			const url = URL.createObjectURL(result.blob);
			try { saveDownload(url, name); }
			finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
			setRecordedVideoName(name);
			setToast((isKo, ko) => isKo ? `${name} 다운로드 요청 · ${result.frameCount}프레임` : `Download requested: ${name} · ${result.frameCount} frames`);
			return { ...result, fileName: name };
		}
		return result;
	}

	function stopShotRecording() {
		const job = recRef.current;
		if (!job?.cancellable) return;
		job.controller.abort();
		updateExportStatus(job, "preparing", { message: ko("Cancelling at the current work boundary…", "현재 작업 경계에서 취소 중…") });
	}

	async function exportDepthVideo(shotId = null) {
		if (recRef.current) return null;
		const atPlayhead = shotIndexAtFrame(shots, tlFrame);
		const target = shotId ? shots.find((entry) => entry.id === shotId) : shots[atPlayhead >= 0 ? atPlayhead : 0] ?? null;
		if (shotId && !target) return null;
		const startFrame = target && (shotId || !motion) ? target.startFrame : 0;
		const endFrame = target && (shotId || !motion) ? target.endFrame : Math.max(0, currentRecordFrameCount() - 1);
		return executeExportRequest(exportRequest("depth_video", async (job) => {
			if (!target) throw Object.assign(new Error("Add a shot before exporting depth video"), { exportFailureCode: "render_failed" });
			let depthRange = null;
			if (endFrame > startFrame) {
				const samples = [];
				for (let frame = startFrame; frame <= endFrame; frame += 1) {
					job.controller.signal.throwIfAborted();
					const depth = withExportFrame(frame, () => renderPass(job.capture, job.capture.scene, shotCamRef.current, "depth"));
					if (!depth) throw Object.assign(new Error("Depth capture failed"), { exportFailureCode: "render_failed" });
					let minGrey = 255;
					let maxGrey = 0;
					for (let index = 0; index < depth.length; index += 256) {
						minGrey = Math.min(minGrey, depth[index]);
						maxGrey = Math.max(maxGrey, depth[index]);
					}
					samples.push({ min: DEPTH_RANGE_M * (1 - maxGrey / 255), max: DEPTH_RANGE_M * (1 - minGrey / 255) });
					updateExportStatus(job, "preparing", { stage: "depth", completedFrames: frame - startFrame + 1,
						frameCount: endFrame - startFrame + 1, cancellable: true });
					await exportBoundary(job);
				}
				depthRange = depthRangeFromFrames(samples, shotCamRef.current.near, DEPTH_RANGE_M);
			}
			return runShotExport({ startFrame, endFrame, passKind: "depth", depthRange, fileName: "blocking-depth.mp4" }, job);
		}));
	}

	function exportPhaseLabel(phase) {
		return ({ preparing: ko("Preparing", "준비 중"), encoding: ko("Encoding", "인코딩 중"),
			finalizing: ko("Finalizing", "마무리 중"), completed: ko("Completed", "완료"),
			failed: ko("Failed", "실패"), cancelled: ko("Cancelled", "취소됨") })[phase] ?? "";
	}


	// Observe the existing export UI boundary, independently of telemetry.
	// The first transition covers ordinary menu exports and fast failures too;
	// progress updates do not write storage on every encoded frame.
	const hasExportAttempt = exportStatus !== null;
	useEffect(() => {
		if (!hasExportAttempt) return;
		rememberCameraTutorialTerminal("export_started");
		setCameraTutorialHandoff(null);
	}, [hasExportAttempt]);

	function downloadOtioCutList() {
		if (!shots.length) {
			setToast(ko("Add at least one Shot before exporting OTIO", "OTIO를 내보내려면 샷을 하나 이상 추가하세요"));
			return;
		}
		try {
			const activeScene = scenes.find((scene) => scene.id === activeSceneId);
			const exportScene = {
				...playbackScene,
				name: activeScene?.name,
				activeCharacterId: activeChar.id,
				characters: characters.map((entry) => ({
					...entry,
					sessionMotion: entry.id === activeChar.id ? motion : entry.sessionMotion,
				})),
				objects: sceneObjects,
			};
			const serialized = serializeOtio(exportScene, shots);
			const blob = new Blob([serialized], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			const slug = (activeScene?.name ?? "cut-list")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "") || "cut-list";
			anchor.href = url;
			anchor.download = `cozyclay-${slug}.otio`;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
			const frameCount = shots.reduce((total, shot) => total + shot.endFrame - shot.startFrame + 1, 0);
			setToast(isKo
				? `OTIO 저장됨 · ${shots.length}샷 · ${frameCount}프레임`
				: `OTIO saved · ${shots.length} shots · ${frameCount} frames`);
		} catch (error) {
			setToast(error?.message || String(error));
		}
	}

	/* ======================= reference-pack exports (#165) =================
	 * Three deliverables a video model actually asks for, all built from the
	 * SAME offscreen capture rig the MP4 export uses, so what ships matches
	 * what the editor previewed:
	 *   - a per-shot keyframe pack (first/last frame, clip, camera, prompt),
	 *   - depth + normal conditioning passes of the current framing,
	 *   - a storyboard contact sheet of the whole cut.
	 */

	function saveDownload(href, name) {
		const anchor = document.createElement("a");
		anchor.href = href;
		anchor.download = name;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	}

	function loadImage(dataUrl) {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error("A captured frame could not be decoded"));
			image.src = dataUrl;
		});
	}

	function dataUrlToBytes(dataUrl) {
		const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return bytes;
	}

	// One frame of the shot as the recorder would draw it: applyExportFrame
	// poses every cast member and parks the shot camera for that absolute
	// frame, exactly as the MP4 pass does. Bones and camera are put back
	// afterwards, so a pack built mid-session leaves the viewport untouched.
	function captureShotFramePng(frame) {
		const buffer = withExportFrame(frame);
		try { return buffer ? bufferToPng(buffer) : null; }
		catch (error) {
			throw Object.assign(new Error(error?.message || String(error), { cause: error }), { exportFailureCode: exportFailureCode(error, "render_failed") });
		}
	}

	// The framing the shot camera stands in at a frame, in the same shape the
	// camera keys use — camera.json carries it so a tool can rebuild the pull.
	function shotFramingAtFrame(entry, frame) {
		const context = recRef.current?.request.context;
		const sampled = sampleAt(context?.playbackScene ?? playbackScene, entry, frame).camera ?? context?.framing;
		if (!sampled) return null;
		return { pos: { x: sampled.pos.x, y: sampled.pos.y, z: sampled.pos.z }, yaw: sampled.yaw, pitch: sampled.pitch, fovDeg: sampled.fovDeg };
	}

	function packMetaForShot(entry, shotIndex) {
		return shotCaptureMeta({
			shot: entry,
			shotIndex,
			stage: { keyLight },
			cast: characters,
			fps: tlFps,
			aspectKey: shotAspectKey,
			size: { width: shotOutput.width, height: shotOutput.height },
			frame: entry.startFrame,
			// The shot's camera block stores the MOVE; the lens lives on the
			// stage, so the live focal length fills in when the block has none.
			lens: { focalMm: shot.focalMm, fovDeg },
		});
	}

	// Build one shot's pack: both endpoint frames, the clip between them, the
	// camera state and the prompt. Returns the archive bytes plus the entry
	// names, so the download path, the embed message and QA all share it.
	async function buildShotKeyframePack(entry, index, onProgress = null, job = null) {
		// Embed/Workflow and the public QA API already own their lifecycle. The
		// shared lock still covers their endpoint captures and archive stages.
		if (!job) {
			const snapshot = structuredClone(entry);
			return executeExportRequest(exportRequest("keyframe_pack",
				(ownedJob) => buildShotKeyframePack(snapshot, index, onProgress, ownedJob), { external: true, download: false }));
		}
		updateExportStatus(job, "preparing", { stage: "frames", cancellable: true });
		await exportBoundary(job);
		const packShot = { title: entry.name, index: index + 1, startFrame: entry.startFrame, endFrame: entry.endFrame };
		onProgress?.(ko(`Rendering frames for "${entry.name}"`, `"${entry.name}" 프레임 렌더링 중`));
		const firstUrl = captureShotFramePng(entry.startFrame);
		if (!firstUrl) throw Object.assign(new Error(ko("The shot renderer is not ready", "샷 렌더러가 아직 준비되지 않았어요")), { exportFailureCode: "render_failed" });
		await exportBoundary(job);
		const lastUrl = entry.endFrame > entry.startFrame ? captureShotFramePng(entry.endFrame) : null;
		await exportBoundary(job);
		onProgress?.(ko(`Recording the clip for "${entry.name}"`, `"${entry.name}" 클립 녹화 중`));
		const recorded = await runShotExport({ startFrame: entry.startFrame, endFrame: entry.endFrame, download: false }, job);
		updateExportStatus(job, "finalizing", { stage: "archive", cancellable: true });
		await exportBoundary(job);
		const clipBytes = new Uint8Array(await recorded.blob.arrayBuffer());
		job.controller.signal.throwIfAborted();
		const meta = packMetaForShot(entry, index);
		const entries = keyframePackEntries({
			shot: packShot,
			fps: tlFps,
			firstFramePng: dataUrlToBytes(firstUrl),
			lastFramePng: lastUrl ? dataUrlToBytes(lastUrl) : null,
			clip: { data: clipBytes, ext: recorded.mimeType === "video/webm" ? "webm" : "mp4" },
			camera: {
				...meta,
				framing: {
					start: shotFramingAtFrame(entry, entry.startFrame),
					end: shotFramingAtFrame(entry, entry.endFrame),
				},
			},
			prompt: buildShotPrompt(meta, { target: "video" }),
		});
		const bytes = buildZip(entries);
		// ZIP construction is synchronous: cancellation takes effect after that
		// work unit, before any file is handed off or the next shot is started.
		await exportBoundary(job);
		return { name: keyframePackName(packShot), entries, bytes };
	}

	// The shot a pack is built for: an explicit id, else the one under the
	// playhead, else the first authored shot.
	function shotIndexForPack(shotId = null) {
		if (shotId) {
			const index = shots.findIndex((entry) => entry.id === shotId);
			if (index < 0) throw new Error(`Unknown shots ID: ${shotId}`);
			return index;
		}
		if (!shots.length) throw new Error(ko("Add at least one Shot before exporting a keyframe pack", "키프레임 팩을 내보내려면 샷을 하나 이상 추가하세요"));
		const atPlayhead = shotIndexAtFrame(shots, tlFrame);
		return atPlayhead >= 0 ? atPlayhead : 0;
	}

	/** Download the keyframe pack for one shot, or (Shift) for every shot. */
	async function exportKeyframePacks(everyShot = false, shotId = null) {
		if (recRef.current) return null;
		const atPlayhead = shotIndexAtFrame(shots, tlFrame);
		const current = shotId ? shots.findIndex((entry) => entry.id === shotId) : atPlayhead >= 0 ? atPlayhead : 0;
		if (shotId && current < 0) return null;
		const targets = everyShot ? shots.map((_, index) => index) : [current];
		return executeExportRequest(exportRequest("keyframe_pack", async (job) => {
			if (!job.request.context.shots.length) throw new Error(ko("Add at least one Shot before exporting a keyframe pack", "키프레임 팩을 내보내려면 샷을 하나 이상 추가하세요"));
			for (const [order, index] of targets.entries()) {
				if (job.request.handedOff.has(index)) continue;
				job.label = ko(`Shot ${order + 1} of ${targets.length}`, `샷 ${order + 1} / ${targets.length}`);
				const pack = await buildShotKeyframePack(job.request.context.shots[index], index, null, job);
				job.controller.signal.throwIfAborted();
				const url = URL.createObjectURL(new Blob([pack.bytes], { type: "application/zip" }));
				try { saveDownload(url, pack.name); job.request.handedOff.add(index); }
				finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
				setToast(isKo ? `${pack.name} 다운로드 요청 · 파일 ${pack.entries.length}개` : `Download requested: ${pack.name} · ${pack.entries.length} files`);
				await exportBoundary(job);
			}
		}));
	}

	/** Depth and normal conditioning passes of the framing on screen now. */
	function exportRenderPasses() {
		try {
			const dataUrls = renderPassDataUrls();
			for (const kind of ["depth", "normal"]) saveDownload(dataUrls[kind], passFileName(kind));
			setToast(ko("Depth and normal passes downloaded", "뎁스·노멀 패스를 다운로드했어요"));
			trackFeature("export_render_pass");
		} catch (error) {
			setToast(error?.message || String(error));
		}
	}

	// Both passes of the framing the shot camera stands in right now, as PNG
	// data URLs. The rig draws through that same camera for the RGB plate, so
	// the three images register pixel for pixel.
	function renderPassDataUrls(kinds = ["depth", "normal"]) {
		const capture = captureRef.current;
		const cam = shotCamRef.current;
		if (!capture || !cam) throw new Error(ko("The shot renderer is not ready", "샷 렌더러가 아직 준비되지 않았어요"));
		const output = {};
		for (const kind of kinds) {
			const dataUrl = renderPass(capture, capture.scene, cam, kind, bufferToPng);
			if (!dataUrl) throw new Error(ko("The shot renderer is not ready", "샷 렌더러가 아직 준비되지 않았어요"));
			output[kind] = dataUrl;
		}
		return output;
	}

	// One storyboard panel as a picture: the shot's first frame through the
	// offscreen capture rig, as a PNG data URL (null while the renderer has no
	// frame). The contact sheet and the Board dock tab share it.
	function capturePanelThumbnail(entry) {
		return captureShotFramePng(entry.startFrame);
	}

	/** Contact sheet of the whole cut: one thumbnail and prompt per shot. */
	async function exportStoryboard() {
		try {
			if (!shots.length) throw new Error(ko("Add at least one Shot before exporting a storyboard", "스토리보드를 내보내려면 샷을 하나 이상 추가하세요"));
			setToast(ko("Composing the storyboard…", "스토리보드 구성 중…"));
			const cells = [];
			for (const [index, entry] of shots.entries()) {
				const dataUrl = capturePanelThumbnail(entry);
				const meta = packMetaForShot(entry, index);
				cells.push({
					title: storyboardLine(`${index + 1}. ${entry.name}`),
					durationSeconds: Number(((entry.endFrame - entry.startFrame + 1) / tlFps).toFixed(2)),
					// The sheet gives each shot one caption line, and the composer draws
					// it unwrapped: the labelled prompt is folded down to the two lines a
					// board is read for (what the shot is, and on what lens), cut to what
					// fits the cell. The pack's prompt.txt keeps the full block.
					prompt: storyboardCaption(buildShotPrompt(meta, { target: "image" })),
					image: dataUrl ? await loadImage(dataUrl) : null,
				});
			}
			const canvas = composeStoryboard({
				shots: cells,
				columns: Math.min(3, cells.length),
				// 480x300 leaves a 464x164 thumbnail box (16:9 lands at 464x261 before
				// the fit, so the frame is scaled to height) and a caption block wide
				// enough for the 90 characters the composer draws at this size.
				cell: { width: 480, height: 300 },
				createCanvas: storyboardCanvas,
			});
			saveDownload(canvas.toDataURL("image/png"), "cozyclay-storyboard.png");
			setToast(isKo ? `스토리보드 저장됨 · ${cells.length}샷` : `Storyboard saved · ${cells.length} shots`);
			trackFeature("export_storyboard");
		} catch (error) {
			setToast(error?.message || String(error));
		}
	}

	function storyboardCanvas(width, height) {
		const element = document.createElement("canvas");
		element.width = width;
		element.height = height;
		const ctx = element.getContext("2d");
		// The sheet is a deliverable, so it uses the studio's own type
		// stack rather than the canvas default (10px sans-serif).
		ctx.font = STORYBOARD_FONT;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		return element;
	}

	/* ===================== storyboard exports (#644) =======================
	 * A storyboard project's panels are its stills, in still order. Each
	 * export runs as one export job (status panel, cancel, retry, analytics
	 * export_kind contact_sheet | panel_pack | animatic) and draws its frames
	 * through withExportFrame, so per-panel cast overrides and proxy paths
	 * land exactly as the preview shows them.
	 */

	function storyboardPanels(list = shots) {
		return list.filter((entry) => entry.kind === "still").sort((a, b) => a.startFrame - b.startFrame);
	}

	const noPanelsMessage = () => ko("Add a panel first — storyboard exports describe panels", "패널을 먼저 추가하세요 — 스토리보드 내보내기는 패널을 담습니다");

	// The panel's stylized picture as PNG bytes, or null when it has none (or
	// its asset is gone from this browser).
	async function panelStylizedPng(entry) {
		if (!entry.stylizedAssetId) return null;
		const record = await assetRecord(entry.stylizedAssetId);
		if (!record) {
			console.warn(`[cozyclay] stylized panel ${entry.stylizedAssetId} is missing; exporting the greybox only`);
			return null;
		}
		const bytes = new Uint8Array(record.bytes);
		if (record.type === "image/png") return bytes;
		const bitmap = await createImageBitmap(new Blob([bytes], { type: record.type }));
		try {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			canvas.getContext("2d").drawImage(bitmap, 0, 0);
			return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
		} finally {
			bitmap.close();
		}
	}

	async function loadPngBytes(bytes) {
		const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
		try { return await loadImage(url); }
		finally { URL.revokeObjectURL(url); }
	}

	const panelFolder = (order) => `panel-${String(order + 1).padStart(2, "0")}`;

	/** Contact sheet of the storyboard: the stylized picture with the greybox
	 * inset when a panel has one, and the panel caption under it. */
	async function exportContactSheet() {
		if (recRef.current) return null;
		if (!storyboardPanels().length) { setToast(noPanelsMessage()); return null; }
		return executeExportRequest(exportRequest("contact_sheet", async (job) => {
			const all = job.request.context.shots;
			const panels = storyboardPanels(all);
			updateExportStatus(job, "preparing", { stage: "frames", cancellable: true });
			const cells = [];
			for (const [order, entry] of panels.entries()) {
				const dataUrl = captureShotFramePng(entry.startFrame);
				if (!dataUrl) throw Object.assign(new Error(ko("The shot renderer is not ready", "샷 렌더러가 아직 준비되지 않았어요")), { exportFailureCode: "render_failed" });
				const stylized = await panelStylizedPng(entry);
				const meta = packMetaForShot(entry, all.indexOf(entry));
				cells.push({
					title: storyboardLine(`${order + 1}. ${entry.name}`),
					durationSeconds: Number(((entry.endFrame - entry.startFrame + 1) / tlFps).toFixed(2)),
					prompt: storyboardCaption(buildShotPrompt(meta, { target: "image" })),
					caption: storyboardLine((entry.caption ?? "").trim()),
					image: await loadImage(dataUrl),
					stylized: stylized ? await loadPngBytes(stylized) : null,
				});
				await exportBoundary(job);
			}
			const canvas = composeStoryboard({ shots: cells, columns: Math.min(3, cells.length), cell: { width: 480, height: 300 }, createCanvas: storyboardCanvas });
			job.controller.signal.throwIfAborted();
			saveDownload(canvas.toDataURL("image/png"), "cozyclay-storyboard.png");
			setToast(isKo ? `콘택트 시트 다운로드 요청 · 패널 ${cells.length}개` : `Download requested: contact sheet · ${cells.length} panels`);
			return { fileName: "cozyclay-storyboard.png", panelCount: cells.length };
		}));
	}

	// One panel's pack: the greybox as first.png, the stylized picture when
	// there is one, the still's camera and hold, and the image prompt plus caption.
	async function panelPackArgs(entry, order, all) {
		const firstUrl = captureShotFramePng(entry.startFrame);
		if (!firstUrl) throw Object.assign(new Error(ko("The shot renderer is not ready", "샷 렌더러가 아직 준비되지 않았어요")), { exportFailureCode: "render_failed" });
		const meta = packMetaForShot(entry, all.indexOf(entry));
		const caption = (entry.caption ?? "").trim();
		return {
			shot: { title: entry.name, index: order + 1, startFrame: entry.startFrame, endFrame: entry.endFrame, kind: "still" },
			fps: tlFps,
			firstFramePng: dataUrlToBytes(firstUrl),
			lastFramePng: null,
			clip: null,
			stylizedPng: await panelStylizedPng(entry),
			camera: { ...meta, framing: { start: shotFramingAtFrame(entry, entry.startFrame) } },
			prompt: buildShotPrompt(meta, { target: "image" }) + (caption ? `\nCAPTION: ${caption}` : ""),
			folder: panelFolder(order),
		};
	}

	/** Panel pack (zip) for one panel — the given one, else the selected one,
	 * else the one under the playhead, else the first — or, with `every`, one
	 * zip holding a panel-NN/ folder per panel. */
	async function exportPanelPacks(every = false, shotId = null) {
		if (recRef.current) return null;
		const panels = storyboardPanels();
		if (!panels.length) { setToast(noPanelsMessage()); return null; }
		const target = shotId ? panels.find((entry) => entry.id === shotId)
			: panels.find((entry) => entry.id === activeShot?.id)
			?? panels.find((entry) => tlFrame >= entry.startFrame && tlFrame <= entry.endFrame) ?? panels[0];
		if (!target) return null;
		return executeExportRequest(exportRequest("panel_pack", async (job) => {
			const all = job.request.context.shots;
			const contextPanels = storyboardPanels(all);
			const targets = every ? contextPanels : contextPanels.filter((entry) => entry.id === target.id);
			updateExportStatus(job, "preparing", { stage: "frames", cancellable: true });
			const packs = [];
			for (const [step, entry] of targets.entries()) {
				job.label = ko(`Panel ${step + 1} of ${targets.length}`, `패널 ${step + 1} / ${targets.length}`);
				packs.push(await panelPackArgs(entry, contextPanels.indexOf(entry), all));
				await exportBoundary(job);
			}
			updateExportStatus(job, "finalizing", { stage: "archive", cancellable: true });
			await exportBoundary(job);
			const entries = packs.flatMap((args) => keyframePackEntries(args));
			const bytes = every ? buildZip(entries) : buildKeyframePack(packs[0]);
			const name = every ? "cozyclay-panels.zip" : `cozyclay-${packs[0].folder}-${slugifyTitle(target.name)}.zip`;
			await exportBoundary(job);
			const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
			try { saveDownload(url, name); }
			finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
			setToast(isKo ? `${name} 다운로드 요청 · 파일 ${entries.length}개` : `Download requested: ${name} · ${entries.length} files`);
			return { fileName: name, entries: entries.map((entry) => entry.name) };
		}));
	}

	/** Animatic (mp4): every panel held for its hold, from frame 0 to the last
	 * still's end, at the production fps. */
	async function exportAnimatic() {
		if (recRef.current) return null;
		const panels = storyboardPanels();
		if (!panels.length) { setToast(noPanelsMessage()); return null; }
		const endFrame = panels.at(-1).endFrame;
		return executeExportRequest(exportRequest("animatic",
			(job) => runShotExport({ startFrame: 0, endFrame, fileName: "cozyclay-animatic.mp4" }, job)));
	}

	function captureCurrentFraming() {
		const cam = shotCamRef.current;
		const pos = cam ? cam.position : cameraPos;
		return captureFraming({ pos: { x: pos.x, y: pos.y, z: pos.z }, yaw: look.current.yaw, pitch: look.current.pitch, fovDeg });
	}

	/** The agent panel's Generate motion chip: the motion.generateFromVideo
	 * action. Locked, the action is unavailable and never runs, so the chip shows
	 * the AI motion card's lock line itself, as it always did. */

	// What a framing capture says about the shot it came from: lens, delivery
	// aspect, cast, cut range and the video model the shot is aimed at. Both
	// capture paths (the live command and the embed message) attach this, so a
	// still handed to a generator arrives with its production notes.
	// A frame that falls in a gap between shots describes the first shot — a
	// pull still belongs to the piece even when the playhead sits outside a cut.
	/**
	 * The reference pictures a capture travels with (#167): every visible cast
	 * member's identity sheet, then the set's environment reference. Slots that
	 * are empty simply do not appear — the array is the pictures that EXIST,
	 * never a fixed-length list with holes in it, so a consumer can attach the
	 * whole thing without filtering.
	 */
	function captureShotReferences() {
		const references = characters
			.filter((entry) => !entry.hidden && typeof entry.identityImage === "string" && entry.identityImage)
			.map((entry) => ({ role: "character", name: entry.subject || entry.id, dataUrl: entry.identityImage }));
		if (typeof environmentImage === "string" && environmentImage) {
			references.push({ role: "environment", dataUrl: environmentImage });
		}
		return references;
	}

	function captureShotMeta(frame) {
		const index = shotIndexAtFrame(shots, frame);
		const resolvedIndex = index >= 0 ? index : shots.length ? 0 : null;
		return shotCaptureMeta({
			shot: resolvedIndex == null ? null : shots[resolvedIndex],
			shotIndex: resolvedIndex,
			stage: { keyLight },
			cast: characters,
			fps: tlFps,
			aspectKey: shotAspectKey,
			size: { width: shotOutput.width, height: shotOutput.height },
			frame,
			lens: { focalMm: shot.focalMm, fovDeg },
		});
	}

	return {
		captureCurrentFraming,
		capturePanelThumbnail,
		captureShotFramePng,
		captureShotMeta,
		captureShotReferences,
		downloadOtioCutList,
		executeExportRequest,
		exportAnimatic,
		exportContactSheet,
		exportDepthVideo,
		exportKeyframePacks,
		exportPanelPacks,
		exportPhaseLabel,
		exportRenderPasses,
		exportRequest,
		exportStoryboard,
		frameExportRef,
		packMetaForShot,
		recRef,
		renderPassDataUrls,
		retryExport,
		runShotExport,
		saveDownload,
		shotIndexForPack,
		stopShotRecording,
		tlFrameRef,
		updateExportStatus,
		withExportFrame
	};
}

