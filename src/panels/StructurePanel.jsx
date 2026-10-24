import { useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { structureWords } from "../intensity-curve/structure.js";
import { useStructureCheck } from "../motion/intensity-strip.jsx";
import "./coverage.css";
import "./motivation.css";

const RULE_LABEL = { flat: ["Goes flat", "평탄함"], "peak-off-beat": ["Peaks off the beat", "정점이 비트에서 벗어남"], "no-build": ["No build", "고조 없음"] };

/** Sequence structure (intensity-curve): where the curve builds and peaks, each shot's intensity, and the flags with a technique stack to apply. */
export default function StructurePanel({ hidden }) {
	const { run } = useBus();
	const { shots = [] } = useStudioShell() ?? {};
	const result = useStructureCheck(shots), [status, setStatus] = useState(null);
	const report = (receipt) => setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	const { curve, issues } = result;
	return (
		<Foldout hidden={hidden} title={ko("Structure", "구조")}>
			<div className="motivation-panel" data-structure-panel>
				<p className="cut-summary" data-structure-summary={issues.length}>{curve.shots.length > 1 ? structureWords(result) : ko("Lay two shots or more to read the sequence's intensity.", "샷을 두 개 이상 놓으면 강도를 읽을 수 있습니다.")}</p>
				<ul className="motivation-list" data-structure-shots={curve.shots.length}>
					{curve.shots.map((row) => <li key={row.shotId} data-structure-shot={row.shotId} data-structure-combined={row.combined}><span>{row.index}. {row.shotName}</span><span>{row.combined.toFixed(2)}</span></li>)}
				</ul>
				<ul className="cut-rules">
					{issues.map((issue, i) => (
						<li key={`${issue.rule}:${issue.frames[0]}:${i}`} className={`cut-rule ${issue.severity}`} data-structure-issue={issue.rule}>
							<strong>{ko(...RULE_LABEL[issue.rule])} · f{issue.frames[0]}–{issue.frames[1]}</strong> {issue.message} <em>{ko("Try", "제안")}: {issue.suggestion.text}.</em>
							{issue.suggestion.action && <button type="button" className="motivation-fix" data-structure-apply={issue.suggestion.shotId} onClick={() => report(run(issue.suggestion.action, issue.suggestion.args))}>{ko("Apply suggestion", "제안 적용")}</button>}
						</li>
					))}
					{curve.shots.length > 1 && !issues.length && <li className="cut-rule ok" data-structure-issue="none">{ko(`No ${result.rules.join(", ")} issue.`, "구조 문제가 없습니다.")}</li>}
				</ul>
				{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-structure-status role="status">{status.text}</p>}
			</div>
		</Foldout>
	);
}
