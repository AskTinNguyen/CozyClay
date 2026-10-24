import { useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { COVERAGE_PATTERNS, coveragePattern } from "../camera-coverage/patterns.js";
import { TRANSITION_TYPES, repairTransition, transitionWords } from "../camera-coverage/transitions.js";
import { useCutChecks } from "../motion/cut-flags.jsx";
import "./coverage.css";

const REPEATING = new Set(["shot-reverse-shot", "dialogue-singles"]);
const TYPE_LABELS = { cut: ["Cut", "컷"], dissolve: ["Dissolve", "디졸브"], "fade-to-black": ["Fade to black", "페이드 아웃"], "fade-from-black": ["Fade from black", "페이드 인"],
	whip: ["Whip pan", "휩 팬"], "match-cut": ["Match cut", "매치 컷"], "j-cut": ["J-cut (audio first)", "J컷 (소리 먼저)"], "l-cut": ["L-cut (audio runs over)", "L컷 (소리 이어짐)"] };
const nameOf = (row) => (row.subject ?? row.name ?? row.id).split(",")[0];

/** Coverage: pick a pattern and cast and lay it over the selected shot's range (camera.cover, one undo entry). */
function CoverageAction({ activeShot, characters, run }) {
	const visible = characters.filter((row) => !row.hidden);
	const [pattern, setPattern] = useState("shot-reverse-shot"), [a, setA] = useState(""), [b, setB] = useState(""), [count, setCount] = useState(4), [status, setStatus] = useState(null);
	const first = a || visible[0]?.id || "", second = b || visible.find((row) => row.id !== first)?.id || "";
	function lay() {
		const receipt = run("camera.cover", { pattern, cast: [first, ...(second && second !== first ? [second] : [])], ...(activeShot ? { shotId: activeShot.id } : {}), ...(REPEATING.has(pattern) ? { shots: count } : {}) });
		setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	}
	const castSelect = (value, set, testId, label) => (
		<label className="coverage-field"><span>{label}</span>
			<select data-coverage-cast={testId} value={value} onChange={(event) => set(event.target.value)}>
				{visible.map((row) => <option key={row.id} value={row.id}>{nameOf(row)}</option>)}
			</select>
		</label>
	);
	return (
		<div className="coverage-action" data-coverage-action>
			<label className="coverage-field"><span>{ko("Pattern", "패턴")}</span>
				<select data-coverage-pattern value={pattern} onChange={(event) => setPattern(event.target.value)}>
					{COVERAGE_PATTERNS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
				</select>
			</label>
			<p className="inspector-hint v2-details-hint">{coveragePattern(pattern).description}</p>
			{castSelect(first, setA, "a", ko("Cast A", "인물 A"))}
			{coveragePattern(pattern).cast > 1 || pattern === "action-coverage" ? castSelect(second, setB, "b", ko("Cast B", "인물 B")) : null}
			{REPEATING.has(pattern) && (
				<label className="coverage-field"><span>{ko("Shots", "샷 수")}</span>
					<input data-coverage-shots type="number" min={2} max={8} value={count} onChange={(event) => setCount(Math.max(2, Math.min(8, Number(event.target.value) || 2)))} />
				</label>
			)}
			<button type="button" className="coverage-lay" data-coverage-lay disabled={!first} onClick={lay}>
				{activeShot ? ko(`Lay over ${activeShot.name} (${activeShot.startFrame}–${activeShot.endFrame})`, `${activeShot.name}에 커버리지 깔기`) : ko("Lay over the timeline", "타임라인에 커버리지 깔기")}
			</button>
			{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-coverage-status role="status">{status.text}</p>}
		</div>
	);
}

/** The cut into the selected shot: its transition and what the editing rules read there. */
function CutInspector({ activeShot, shots, run, seek }) {
	const { cuts, issueCount } = useCutChecks(shots), cut = activeShot ? cuts.find((row) => row.to === activeShot.id) : null;
	const transition = repairTransition(activeShot?.transition) ?? { type: "cut" };
	const [status, setStatus] = useState(null);
	function set(patch) {
		const next = { ...transition, ...patch }, receipt = run("camera.setTransition", { shotId: activeShot.id, type: next.type, ...(next.frames ? { frames: next.frames } : {}), ...(next.offsetFrames ? { offsetFrames: next.offsetFrames } : {}) });
		setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	}
	if (!activeShot) return <p className="inspector-hint v2-details-hint">{ko("Select a shot to inspect the cut into it.", "샷을 선택하면 그 샷으로 들어가는 컷을 봅니다.")}</p>;
	return (
		<div className="cut-inspector" data-cut-inspector={cut ? cut.cutFrame : "none"}>
			<p className="cut-summary" data-cut-summary={issueCount}>{ko(`${cuts.length} cuts, ${issueCount} flagged`, `컷 ${cuts.length}개, 문제 ${issueCount}개`)}
				{cuts.filter((row) => row.issues.length).map((row) => <button key={row.cutFrame} type="button" data-cut-jump={row.cutFrame} onClick={() => seek(row.cutFrame)}>{row.cutFrame}</button>)}</p>
			{cut ? <h4 className="cut-title">{ko(`Cut at ${cut.cutFrame}: ${cut.fromName} → ${cut.toName}`, `${cut.cutFrame} 컷: ${cut.fromName} → ${cut.toName}`)}</h4>
				: <p className="inspector-hint v2-details-hint">{ko(`${activeShot.name} opens the sequence; only a fade from black leads into it.`, `${activeShot.name}은 첫 샷입니다.`)}</p>}
			<label className="coverage-field"><span>{ko("Transition", "트랜지션")}</span>
				<select data-cut-transition-type value={transition.type} onChange={(event) => set({ type: event.target.value, frames: undefined, offsetFrames: undefined })}>
					{TRANSITION_TYPES.map((type) => <option key={type} value={type}>{ko(...TYPE_LABELS[type])}</option>)}
				</select>
			</label>
			{transition.frames ? (
				<label className="coverage-field"><span>{ko("Frames", "프레임")}</span>
					<input data-cut-transition-frames type="number" min={2} max={96} value={transition.frames} onChange={(event) => set({ frames: Number(event.target.value) || 2 })} />
				</label>
			) : null}
			{transition.offsetFrames ? (
				<label className="coverage-field"><span>{ko("Audio offset", "소리 오프셋")}</span>
					<input data-cut-transition-offset type="number" min={1} max={96} value={transition.offsetFrames} onChange={(event) => set({ offsetFrames: Number(event.target.value) || 1 })} />
				</label>
			) : null}
			{transition.type !== "cut" && <p className="inspector-hint v2-details-hint" data-cut-transition-words>{transitionWords(transition)}</p>}
			{cut && (
				<ul className="cut-rules" data-cut-rules-readout={cut.issues.length}>
					{cut.issues.length ? cut.issues.map((issue, i) => (
						<li key={i} className={`cut-rule ${issue.severity}`} data-cut-issue={issue.rule}>
							<strong>{issue.rule === "line" ? "180°" : issue.rule.toUpperCase()} · {issue.severity}</strong> {issue.message} <em>{ko("Fix", "수정")}: {issue.fix.text}.</em>
						</li>
					)) : <li className="cut-rule ok" data-cut-issue="none">{ko("Clean: same side of the line, no jump, directions and eyelines hold.", "문제 없음: 같은 쪽, 점프컷 없음, 방향과 시선 유지.")}</li>}
					{cut.unjudged && <li className="cut-rule">{cut.unjudged}</li>}
				</ul>
			)}
			{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-cut-status role="status">{status.text}</p>}
		</div>
	);
}

export default function CoveragePanel({ hidden, activeShot }) {
	const { run } = useBus();
	const { characters = [], shots = [], setTlFrame } = useStudioShell() ?? {};
	return (<>
		<Foldout hidden={hidden} title={ko("Coverage", "커버리지")}>
			<CoverageAction activeShot={activeShot} characters={characters} run={run} />
		</Foldout>
		<Foldout hidden={hidden} title={ko("Cut", "컷")}>
			<CutInspector activeShot={activeShot} shots={shots} run={run} seek={(frame) => (run("timeline.seek", { frame })?.ok ? null : setTlFrame?.(frame))} />
		</Foldout>
	</>);
}
