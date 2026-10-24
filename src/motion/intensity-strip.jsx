import { useMemo, useSyncExternalStore } from "react";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { checkStructure } from "../intensity-curve/structure.js";
import { INTENSITY_COMPONENTS } from "../intensity-curve/weights.js";
import { STRIP_COLORS, stripLayout } from "../intensity-curve/strip.js";
import { studioSequenceDocument } from "../sequence-prompt-studio.js";
import { storyBeatWords } from "../camera-motivation/story-beats.js";
import { ko } from "../locale.js";
import { useShotState } from "./motivation-marks.jsx";
import "./intensity-strip.css";

const EMPTY = [];
const VIEW_W = 1000, VIEW_H = 30;
const RULE_TAG = { flat: ["FLAT", "평탄"], "peak-off-beat": ["OFF PEAK", "정점 어긋남"], "no-build": ["NO BUILD", "고조 없음"] };

// Which components the strip draws beside the combined curve: one toggle per component, shared by every strip on the page.
let shown = EMPTY;
const listeners = new Set();
const toggles = {
	subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
	read: () => shown,
	flip: (id) => { shown = shown.includes(id) ? shown.filter((row) => row !== id) : [...shown, id]; listeners.forEach((listener) => listener()); },
};

/** camera.checkStructure's measure of the shot list (intensity-curve/structure.js), recomputed when shots, cast or beats change. */
export function useStructureCheck(shots) {
	const { characters = EMPTY, filmback, sceneObjects } = useStudioShell() ?? {};
	const state = useShotState(), storyBeats = state?.storyBeats ?? EMPTY, frameCount = state?.frameCount;
	return useMemo(() => checkStructure({ ...studioSequenceDocument({ characters, filmback, objects: sceneObjects, frameCount }), shots: shots ?? EMPTY, storyBeats }),
		[shots, characters, filmback, sceneObjects, frameCount, storyBeats]);
}

/** The intensity strip under the Shots lane's blocks: the combined curve, a toggle per component, the story beats and the flagged stretches. */
export function IntensityStrip({ shots, framePct, frameCount }) {
	const result = useStructureCheck(shots), on = useSyncExternalStore(toggles.subscribe, toggles.read, toggles.read);
	if ((shots ?? EMPTY).filter((shot) => shot.kind !== "still").length < 2) return null;
	const { curve, issues, beats } = result;
	const layout = stripLayout(curve, { width: VIEW_W, height: VIEW_H, frameCount, components: on, beats, issues, pad: 3 });
	return (
		<div className="tl-intensity-strip" data-intensity-strip={curve.shots.length} data-intensity-combined={curve.shots.map((row) => row.combined).join(" ")} data-intensity-issues={issues.length}
			title={ko("Intensity: size, height, lens, movement, cutting, roll and screen jump per shot, weighted (camera.checkStructure)", "강도: 샷마다 크기, 높이, 렌즈, 움직임, 컷 속도, 롤, 화면 위치 변화를 가중 합산")}>
			<svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
				{layout.flags.map((flag, i) => <rect key={`f${i}`} x={flag.x0} y={0} width={Math.max(2, flag.x1 - flag.x0)} height={VIEW_H} fill={flag.color} opacity={0.22} />)}
				{layout.cuts.map((x, i) => <line key={`c${i}`} x1={x} x2={x} y1={0} y2={VIEW_H} stroke={STRIP_COLORS.cut} vectorEffect="non-scaling-stroke" />)}
				{layout.beats.map((beat) => <line key={beat.id} x1={beat.x} x2={beat.x} y1={0} y2={VIEW_H} stroke={STRIP_COLORS.beat} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />)}
				{layout.series.map((series) => (
					<polyline key={series.id} data-intensity-series={series.id} className={series.id === "combined" ? "tl-intensity-combined" : undefined} points={series.points.map((point) => point.join(",")).join(" ")} fill="none" stroke={series.color}
						strokeWidth={series.id === "combined" ? 2 : 1} opacity={series.id === "combined" ? 1 : 0.85} vectorEffect="non-scaling-stroke" />
				))}
			</svg>
			{issues.map((issue, i) => (
				<span key={`${issue.rule}:${issue.frames[0]}:${i}`} className={`tl-intensity-flag ${issue.rule}`} data-intensity-flag={issue.rule} data-intensity-flag-shot={issue.suggestion.shotId}
					style={{ "--tl-f": framePct(issue.frames[0], frameCount) }} title={`${issue.message} ${ko("Try", "제안")}: ${issue.suggestion.text}.`}>{ko(...RULE_TAG[issue.rule])}</span>
			))}
			{beats.map((beat) => <span key={beat.id} className="tl-intensity-beat" style={{ "--tl-f": framePct(beat.frame, frameCount) }} title={`${ko("Story beat", "스토리 비트")}: ${storyBeatWords(beat)}`} />)}
			<span className="tl-intensity-toggles" role="group" aria-label={ko("Intensity components", "강도 구성 요소")}>
				{INTENSITY_COMPONENTS.map((row) => (
					<button key={row.id} type="button" data-intensity-toggle={row.id} aria-pressed={on.includes(row.id)} style={{ "--c": STRIP_COLORS[row.id] }}
						title={`${row.label} (weight ${row.weight}): ${row.formula}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => toggles.flip(row.id)}>{row.label}</button>
				))}
			</span>
		</div>
	);
}
