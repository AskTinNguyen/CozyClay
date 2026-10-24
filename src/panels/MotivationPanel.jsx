import { useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { STORY_BEAT_KINDS, storyBeatWords } from "../camera-motivation/story-beats.js";
import { motivationReason } from "../camera-motivation/check.js";
import { useMotivationCheck } from "../motion/motivation-marks.jsx";
import "./coverage.css";
import "./motivation.css";

const RULE_LABEL = { unmotivated: ["No motive", "동기 없음"], "starts-off-beat": ["Starts off the beat", "비트보다 일찍/늦게 시작"], "settles-off-beat": ["Settles off the beat", "비트에서 벗어나 멈춤"] };

/** Add a story beat at the playhead (story.addBeat, one undo entry), and list the beats with a remove each. */
function StoryBeats({ beats, frame, run, report }) {
	const [label, setLabel] = useState(""), [kind, setKind] = useState("event");
	const add = () => { report(run("story.addBeat", { frame, label: label.trim(), kind })); setLabel(""); };
	return (
		<div className="motivation-beats" data-story-beats={beats.length}>
			<label className="coverage-field"><span>{ko(`Beat at ${frame}`, `${frame} 비트`)}</span>
				<input data-story-beat-label type="text" maxLength={80} placeholder={ko("Mara makes her admission", "마라가 고백한다")} value={label} onChange={(event) => setLabel(event.target.value)} />
			</label>
			<label className="coverage-field"><span>{ko("Kind", "종류")}</span>
				<select data-story-beat-kind value={kind} onChange={(event) => setKind(event.target.value)}>
					{STORY_BEAT_KINDS.map((row) => <option key={row} value={row}>{row}</option>)}
				</select>
			</label>
			<button type="button" className="coverage-lay" data-story-beat-add disabled={!label.trim()} onClick={add}>{ko("Add story beat", "스토리 비트 추가")}</button>
			<ul className="motivation-list">
				{beats.map((beat) => (
					<li key={beat.id} data-story-beat-row={beat.id}>{storyBeatWords(beat)}
						<button type="button" data-story-beat-remove={beat.id} title={ko("Remove", "삭제")} onClick={() => report(run("story.removeBeat", { beat: beat.id }))}>×</button>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Why each move of the selected shot (or every shot) happens, with the fix for each flag. */
function MoveReasons({ check, activeShot, run, report, seek }) {
	const shots = check.shots.filter((row) => !activeShot || row.shotId === activeShot.id);
	const issues = check.issues.filter((row) => !activeShot || row.shotId === activeShot.id);
	return (
		<div className="motivation-moves" data-motivation-readout={issues.length}>
			<p className="cut-summary" data-motivation-summary={check.issueCount}>{ko(`${check.segments} move${check.segments === 1 ? "" : "s"}, ${check.issueCount} flagged`, `무브 ${check.segments}개, 문제 ${check.issueCount}개`)}
				{check.issues.map((row) => <button key={`${row.shotId}:${row.frames[0]}`} type="button" data-motivation-jump={row.frames[0]} onClick={() => seek(row.frames[0])}>{row.frames[0]}</button>)}</p>
			<ul className="cut-rules">
				{shots.flatMap((shot) => shot.segments.map((segment) => (
					<li key={`${shot.shotId}:${segment.index}`} className={`cut-rule ${segment.motivation.by ? "ok" : "high"}`} data-motivation-move={segment.moveId}>
						<strong>{shot.shotName} · f{segment.startFrame}–{segment.endFrame}</strong> {segment.motivation.by ? `${ko("The camera", "카메라가")} ${motivationReason(segment, shot.subjectName)}.` : ko("Nothing motivates this move.", "이 무브의 동기가 없습니다.")}
					</li>
				)))}
				{issues.map((issue) => (
					<li key={`${issue.shotId}:${issue.rule}:${issue.frames[0]}`} className={`cut-rule ${issue.severity}`} data-motivation-issue={issue.rule}>
						<strong>{ko(...RULE_LABEL[issue.rule])} · {issue.severity}</strong> {issue.message} <em>{ko("Fix", "수정")}: {issue.fix.text}.</em>
						{issue.fix.action === "camera.alignMove" && <button type="button" className="motivation-fix" data-motivation-fix={issue.shotId} onClick={() => report(run(issue.fix.action, issue.fix.args))}>{ko("Apply fix", "수정 적용")}</button>}
					</li>
				))}
				{!shots.some((shot) => shot.segments.length) && <li className="cut-rule ok" data-motivation-issue="none">{ko("No camera moves: holds need no motive.", "카메라 무브 없음: 고정 샷은 동기가 필요 없습니다.")}</li>}
			</ul>
		</div>
	);
}

/** Camera motivation (camera-motivation): the story beats, and why each camera move happens. */
export default function MotivationPanel({ hidden, activeShot }) {
	const { run } = useBus();
	const { shots = [], tlFrame = 0, setTlFrame } = useStudioShell() ?? {};
	const check = useMotivationCheck(shots), [status, setStatus] = useState(null);
	const report = (receipt) => setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	return (
		<Foldout hidden={hidden} title={ko("Motivation", "동기")}>
			<div className="motivation-panel" data-motivation-panel>
				<StoryBeats beats={check.storyBeats} frame={Math.round(tlFrame)} run={run} report={report} />
				<MoveReasons check={check} activeShot={activeShot} run={run} report={report} seek={(frame) => (run("timeline.seek", { frame })?.ok ? null : setTlFrame?.(frame))} />
				{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-motivation-status role="status">{status.text}</p>}
			</div>
		</Foldout>
	);
}
