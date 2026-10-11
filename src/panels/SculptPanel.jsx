import { useRef, useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko, isKo } from "../locale.js";
import "./sculpt.css";

// Sculpt mode side panel (#739). Pure view: the run controller owns the run state and the
// reference; this panel only renders it and reports the operator's intent through callbacks.

const STAGES = [
	["measure", ko("Measure", "측정")],
	["draft", ko("Draft", "초안")],
	["score", ko("Score", "채점")],
	["refine", ko("Refine", "다듬기")],
];
const RUNNING = new Set(["measure", "draft", "score", "refine"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function pickImage(files) {
	return [...(files ?? [])].find((file) => IMAGE_TYPES.has(file.type)) ?? null;
}

function formatElapsed(ms) {
	const seconds = Math.max(0, Math.round((ms || 0) / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`;
}

function formatIou(iou) {
	return Number.isFinite(iou) ? iou.toFixed(3) : "—";
}

export default function SculptPanel({ run, reference, onReference, onStart, onCancel, onPlaceInScene, canStart, startRefusal, sculptName, hidden }) {
	const fileRef = useRef(null);
	const [dragging, setDragging] = useState(false);
	const [showSheet, setShowSheet] = useState(false);

	const stage = run?.stage ?? "idle";
	const running = RUNNING.has(stage);
	const stageIndex = STAGES.findIndex(([id]) => id === stage);
	const iou = Number.isFinite(run?.iou) ? run.iou : null;
	const target = Number.isFinite(run?.targetIou) ? run.targetIou : null;
	const showProgress = stage !== "idle";
	const startDisabled = !canStart || Boolean(startRefusal);

	const take = (files) => {
		const file = pickImage(files);
		if (file) onReference?.(file);
	};
	const openPicker = () => fileRef.current?.click();

	return (
		<Foldout hidden={hidden} title={ko("Sculpt from image", "이미지로 조형")}>
			<div className="sculpt-panel" data-testid="sculpt-panel" data-stage={stage}
				onPaste={(event) => {
					const file = pickImage(event.clipboardData?.files);
					if (!file) return;
					event.preventDefault();
					onReference?.(file);
				}}>

				<div className="sculpt-label"><span>{ko("Reference", "참조 이미지")}</span>{reference?.name && <small title={reference.name}>{reference.name}</small>}</div>
				{reference ? (
					<div className="sculpt-well sculpt-well-filled" data-testid="sculpt-reference"
						onDragOver={(event) => { if (event.dataTransfer?.types?.includes("Files")) event.preventDefault(); }}
						onDrop={(event) => { event.preventDefault(); take(event.dataTransfer?.files); }}>
						<img src={reference.dataUrl} alt={isKo ? `참조 이미지: ${reference.name}` : `Reference: ${reference.name}`} />
						<button type="button" className="btn ghost small sculpt-well-replace" data-testid="sculpt-reference-replace"
							disabled={running} aria-label={ko("Replace reference image", "참조 이미지 바꾸기")} onClick={openPicker}>
							{ko("Replace", "바꾸기")}
						</button>
					</div>
				) : (
					<div className="sculpt-well sculpt-well-empty" data-testid="sculpt-dropzone" data-dragging={dragging ? "true" : undefined}
						role="button" tabIndex={0} aria-label={ko("Drop or paste a reference image, or press Enter to choose a file", "참조 이미지를 끌어놓거나 붙여넣기, 또는 Enter로 파일 선택")}
						onClick={openPicker}
						onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); } }}
						onDragOver={(event) => { if (event.dataTransfer?.types?.includes("Files")) { event.preventDefault(); setDragging(true); } }}
						onDragLeave={() => setDragging(false)}
						onDrop={(event) => { event.preventDefault(); setDragging(false); take(event.dataTransfer?.files); }}>
						<span className="sculpt-well-title">{ko("Drop or paste a reference image", "참조 이미지를 끌어놓거나 붙여넣으세요")}</span>
						<span className="sculpt-well-sub">PNG · JPEG · WebP</span>
						<span className="btn ghost small" aria-hidden="true">{ko("Choose file", "파일 선택")}</span>
					</div>
				)}
				<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="multimodel-file-input" data-testid="sculpt-reference-input"
					aria-label={ko("Reference image file", "참조 이미지 파일")}
					onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; take(files); }} />

				{running ? (
					<button type="button" className="btn full sculpt-cancel" data-testid="sculpt-cancel" onClick={() => onCancel?.()}>
						{ko("Cancel", "취소")}
					</button>
				) : (
					<button type="button" className="btn primary full" data-testid="sculpt-start" disabled={startDisabled}
						aria-describedby={startRefusal ? "sculpt-start-refusal" : undefined} onClick={() => onStart?.()}>
						{ko("Start (fast draft)", "시작 (빠른 초안)")}
					</button>
				)}
				{!running && startRefusal && <p className="inspector-hint sculpt-refusal" id="sculpt-start-refusal" role="status" data-testid="sculpt-start-refusal">{startRefusal}</p>}

				{showProgress && (
					<div className="sculpt-progress" data-testid="sculpt-progress">
						<ol className="sculpt-stepper" aria-label={ko("Sculpt stages", "조형 단계")}>
							{STAGES.map(([id, label], index) => {
								const state = stage === "done" || (stageIndex >= 0 && index < stageIndex) ? "complete" : index === stageIndex ? "current" : "pending";
								return (
									<li key={id} className="sculpt-step" data-state={state} data-stage={id} aria-current={state === "current" ? "step" : undefined}>
										<span className="sculpt-step-dot" aria-hidden="true" />
										<span className="sculpt-step-label">{label}</span>
									</li>
								);
							})}
						</ol>

						<div className="sculpt-stats">
							<span data-testid="sculpt-round">{isKo ? `라운드 ${run.round} / ${run.maxRounds}` : `Round ${run.round} / ${run.maxRounds}`}</span>
							<span data-testid="sculpt-elapsed">{formatElapsed(run.elapsedMs)}</span>
						</div>

						<div className="sculpt-iou">
							<div className="sculpt-label">
								<span>{stage === "done" ? ko("Final IoU", "최종 IoU") : "IoU"}</span>
								<small data-testid="sculpt-iou">{formatIou(iou)}{target !== null && <span className="sculpt-iou-target"> / {formatIou(target)}</span>}</small>
							</div>
							<div className="sculpt-iou-bar" role="meter" aria-label={ko("Silhouette match (IoU)", "실루엣 일치도 (IoU)")}
								aria-valuemin={0} aria-valuemax={1} aria-valuenow={iou ?? undefined}
								data-reached={iou !== null && target !== null && iou >= target ? "true" : undefined}
								style={{ "--sculpt-iou": iou ?? 0, "--sculpt-target": target ?? 0 }}>
								<span className="sculpt-iou-fill" />
								{target !== null && <span className="sculpt-iou-marker" data-testid="sculpt-iou-target" title={isKo ? `목표 ${formatIou(target)}` : `Target ${formatIou(target)}`} />}
							</div>
						</div>

						{run.message && <p className="inspector-hint sculpt-message" role="status">{run.message}</p>}
						{stage === "done" && <p className="inspector-hint sculpt-done" role="status" data-testid="sculpt-done">{isKo ? `완료 — IoU ${formatIou(iou)}` : `Done — IoU ${formatIou(iou)}`}</p>}
						{stage === "cancelled" && <p className="inspector-hint" role="status" data-testid="sculpt-cancelled">{ko("Cancelled.", "취소했어요.")}</p>}
						{stage === "failed" && <p className="inspector-hint sculpt-error" role="alert" data-testid="sculpt-error">{run.error || ko("The sculpt run failed.", "조형에 실패했어요.")}</p>}
					</div>
				)}

				{run?.sheetDataUrl && (
					<div className="sculpt-sheet">
						<button type="button" className="btn ghost small full" data-testid="sculpt-sheet-toggle" aria-pressed={showSheet}
							onClick={() => setShowSheet((value) => !value)}>
							{showSheet ? ko("Hide overlay sheet", "오버레이 시트 숨기기") : ko("Show overlay sheet", "오버레이 시트 보기")}
						</button>
						{showSheet && <img className="sculpt-sheet-image" data-testid="sculpt-sheet" src={run.sheetDataUrl} alt={ko("Reference beside the sculpt overlay", "참조 이미지와 조형 오버레이")} />}
					</div>
				)}

				<button type="button" className="btn full" data-testid="sculpt-place" disabled={!sculptName || running}
					aria-label={sculptName ? (isKo ? `${sculptName} 장면에 배치` : `Place ${sculptName} in scene`) : ko("Place in scene", "장면에 배치")}
					onClick={() => onPlaceInScene?.()}>
					{ko("Place in scene", "장면에 배치")}
				</button>

				<p className="inspector-hint sculpt-hint" data-testid="sculpt-hint">
					{ko("Fix details by chatting with the Agent (⌘B) while the sculpt is selected.", "조형물을 선택한 채 에이전트(⌘B)와 대화해 디테일을 고치세요.")}
				</p>
			</div>
		</Foldout>
	);
}
