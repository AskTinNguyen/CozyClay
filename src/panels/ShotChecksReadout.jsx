import { useState } from "react";
import { ko } from "../locale.js";
import { depthWords } from "../camera-depth/layers.js";
import { useShotChecks } from "../motion/shot-check-marks.jsx";

const RULE_LABELS = { occluded: ["Blocked", "가림"], inside: ["Inside the set", "세트 안"], crop: ["Crop at a joint", "관절 크롭"] };

/** What each shot's camera does with the set (camera.checkShots' measure): the selected shot's issues with their fix and an Apply button (camera.fixShot, one undo entry), its depth layers, and the other flagged shots. */
export default function ShotChecksReadout({ activeShot, shots, run, seek }) {
	const report = useShotChecks(shots), [status, setStatus] = useState(null);
	if (!report.shots.length) return <p className="inspector-hint v2-details-hint">{ko("Add shots to check them against the set.", "샷을 추가하면 세트와 함께 점검합니다.")}</p>;
	const shot = report.shots.find((row) => row.shotId === activeShot?.id), others = report.shots.filter((row) => row.issues.length && row !== shot);
	function apply(row, issue) {
		const receipt = run("camera.fixShot", { shotId: row.shotId, rule: issue.rule });
		setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	}
	return (
		<div className="shot-checks" data-shot-checks={report.issueCount} data-shot-checks-flagged={report.flagged}>
			<p className="cut-summary" data-shot-checks-summary={report.issueCount}>{ko(`${report.shots.length} shots, ${report.flagged} flagged`, `샷 ${report.shots.length}개, 문제 ${report.flagged}개`)}
				{others.map((row) => <button key={row.shotId} type="button" data-shot-check-jump={row.shotId} onClick={() => seek(row.startFrame)}>{row.name}</button>)}</p>
			{shot ? (
				<ul className="cut-rules" data-shot-check-readout={shot.shotId}>
					{shot.issues.length ? shot.issues.map((issue) => (
						<li key={issue.rule + issue.frames[0]} className={`cut-rule ${issue.severity}`} data-shot-check-issue={issue.rule}>
							<strong>{ko(...RULE_LABELS[issue.rule])} · {issue.severity}</strong> {issue.message} <em>{ko("Fix", "수정")}: {issue.fix.text}.</em>
							{issue.fix.delta ? <button type="button" className="shot-check-fix" data-shot-check-fix={issue.rule} onClick={() => apply(shot, issue)}>{ko("Apply fix", "수정 적용")}</button> : null}
						</li>
					)) : <li className="cut-rule ok" data-shot-check-issue="none">{shot.unjudged ?? ko("Clean: nothing blocks the face, the lens is clear of the set, no edge at a joint.", "문제 없음: 얼굴 가림 없음, 렌즈가 세트 밖, 관절 크롭 없음.")}</li>}
					{depthWords(shot.layers, shot.subjectName) ? <li className="cut-rule" data-shot-depth>{ko("Depth", "깊이")}: {depthWords(shot.layers, shot.subjectName)}</li> : null}
				</ul>
			) : <p className="inspector-hint v2-details-hint">{ko("Select a shot to read its checks.", "샷을 선택하면 점검 결과를 봅니다.")}</p>}
			{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-shot-check-status role="status">{status.text}</p>}
		</div>
	);
}
