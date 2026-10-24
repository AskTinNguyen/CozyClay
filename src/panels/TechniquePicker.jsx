import { useMemo, useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { TECHNIQUES, describeTechnique, techniqueById } from "../camera-techniques/index.js";
import { searchTechniques, slotOf } from "../camera-techniques/resolve.js";
import { currentTechnique } from "../camera-techniques/storage.js";
import { techniqueDiagram } from "../camera-techniques/diagram.js";
import CompositionFields from "./CompositionFields.jsx";
import FurtherReading from "./FurtherReading.jsx";
import "./technique-picker.css";

const KINDS = [["all", "All", "전체"], ["size", "Size", "크기"], ["angle", "Angle", "앵글"], ["move", "Move", "무브"], ["lens", "Lens", "렌즈"], ["coverage", "Coverage", "커버리지"], ["modifier", "Modifier", "효과"]];
const MOODS = [...new Set(TECHNIQUES.flatMap((entry) => entry.moods))].sort();
const points = (list) => list.map((p) => p.join(",")).join(" ");

/** The top-down plan of a technique: cast dots, the camera path, the lens wedge. */
function TechniqueDiagram({ id }) {
	const plan = useMemo(() => techniqueDiagram([id]), [id]);
	if (!plan) return <div className="technique-diagram empty" data-technique-diagram="none">{ko("Prompt words only", "프롬프트 문구만")}</div>;
	return (
		<svg className="technique-diagram" data-technique-diagram={plan.rail ? "rail" : plan.still ? "still" : "keys"} viewBox="0 0 132 92" role="img"
			aria-label={ko("Top-down camera plan", "위에서 본 카메라 경로")}>
			{plan.startWedge && !plan.rail && <polygon className="wedge start" points={points(plan.startWedge)} />}
			<polygon className="wedge" points={points(plan.wedge)} />
			{plan.cast.map((row, i) => (
				<g key={i} className={row.subject ? "cast subject" : "cast"}>
					<line x1={row.at[0]} y1={row.at[1]} x2={row.facing[0]} y2={row.facing[1]} />
					<circle cx={row.at[0]} cy={row.at[1]} r={row.subject ? 4 : 3.2} />
				</g>
			))}
			{!plan.still && <polyline className={plan.rail ? "path rail" : "path"} points={points(plan.path)} />}
			{!plan.still && <circle className="camera start" cx={plan.start[0]} cy={plan.start[1]} r="2.6" />}
			<circle className="camera" cx={plan.end[0]} cy={plan.end[1]} r="3.2" />
		</svg>
	);
}

/** One parameter of the focused technique: an enum picks, a number types. */
function ParamField({ name, schema, value, onChange }) {
	if (schema.type === "cast") return null;
	const options = schema.type === "size" ? [null, ...schema.options] : schema.options;
	return (
		<label className="technique-param">
			<span>{name}</span>
			{options ? (
				<select data-technique-param={name} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
					{options.map((option) => <option key={option ?? "auto"} value={option ?? ""}>{option ?? ko("auto", "자동")}</option>)}
				</select>
			) : (
				<input data-technique-param={name} type="number" min={schema.min} max={schema.max} step={schema.unit === "m" ? 0.1 : 1} value={value}
					onChange={(event) => onChange(Number(event.target.value))} />
			)}
			{schema.unit && <small>{schema.unit}</small>}
		</label>
	);
}

export default function TechniquePicker({ hidden, activeShot }) {
	const { run } = useBus();
	const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [mood, setMood] = useState("");
	const [focusId, setFocusId] = useState(null), [params, setParams] = useState({}), [status, setStatus] = useState(null);
	const rows = useMemo(() => searchTechniques(query, { kind: kind === "all" ? null : kind, mood: mood || null }), [query, kind, mood]);
	const applied = currentTechnique(activeShot), focus = techniqueById(focusId);
	// Picking a technique stacks it on what the shot already carries: a new size, angle,
	// move or coverage replaces the one in its slot, a modifier adds.
	function apply(id, own) {
		if (!activeShot) return;
		const slot = slotOf(techniqueById(id));
		const kept = (applied?.stack ?? []).filter((row) => techniqueById(row.id) && row.id !== id && (slot === "modifier" || slotOf(techniqueById(row.id)) !== slot));
		send([...kept, { id, params: own }]);
	}
	// The stored composition and side ride every re-apply, so a new pick keeps where the subject sits (camera-coverage).
	function send(stack, composition = applied?.composition ?? null) {
		const receipt = run("camera.applyTechnique", { shotId: activeShot.id, stack, ...(composition ? { composition } : {}), ...(applied?.side ? { side: applied.side } : {}) });
		setStatus(receipt?.ok ? { ok: true, text: receipt.summary, warnings: receipt.warnings.map((row) => row.message) } : { ok: false, text: receipt?.message ?? "" });
	}
	function pick(id) {
		const own = Object.fromEntries(Object.entries(describeTechnique(id).params).map(([key, schema]) => [key, schema.default]));
		setFocusId(id); setParams(own); apply(id, own);
	}
	function change(key, value) {
		const next = { ...params, [key]: value };
		setParams(next); apply(focusId, next);
	}
	return (
		<Foldout hidden={hidden} title={ko("Techniques", "촬영 기법")}>
			<div className="technique-picker" data-technique-picker>
				{applied ? (
					<div className="technique-applied" data-technique-applied={applied.label}>
						{applied.stack.map((row) => (
							<button key={row.id} type="button" className="technique-chip" title={ko("Remove from the stack", "스택에서 빼기")}
								onClick={() => (applied.stack.length > 1 ? send(applied.stack.filter((other) => other.id !== row.id)) : null)}>
								{techniqueById(row.id)?.tag ?? row.id}{applied.stack.length > 1 ? " ×" : ""}
							</button>
						))}
						<small>{applied.label.split(" · ").at(-1)}</small>
					</div>
				) : (
					<p className="inspector-hint v2-details-hint">{activeShot ? ko("Pick a technique to frame or move the selected shot.", "기법을 고르면 선택한 샷의 카메라가 바뀝니다.") : ko("Select a shot first.", "먼저 샷을 선택하세요.")}</p>
				)}
				<input className="technique-search" data-technique-search type="search" value={query} placeholder={ko("Search: push in, vertigo, uneasy…", "검색: 푸시 인, 버티고, 불안…")}
					aria-label={ko("Search camera techniques", "촬영 기법 검색")} onChange={(event) => setQuery(event.target.value)} />
				<div className="technique-kinds" role="tablist">
					{KINDS.map(([value, en, kr]) => (
						<button key={value} type="button" role="tab" aria-selected={kind === value} data-technique-kind={value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{ko(en, kr)}</button>
					))}
				</div>
				<select className="technique-mood" data-technique-mood value={mood} aria-label={ko("Mood", "분위기")} onChange={(event) => setMood(event.target.value)}>
					<option value="">{ko("Any mood", "모든 분위기")}</option>
					{MOODS.map((value) => <option key={value} value={value}>{value}</option>)}
				</select>
				<ul className="technique-list" data-technique-count={rows.length}>
					{rows.map((entry) => (
						<li key={entry.id}>
							<button type="button" data-technique-id={entry.id} disabled={!activeShot} className={(entry.id === focusId ? "focused " : "") + (applied?.stack.some((row) => row.id === entry.id) ? "applied" : "")}
								title={entry.description} onClick={() => pick(entry.id)}>
								<span>{entry.name}</span><small>{entry.requires.length ? ko("prompt", "문구") : entry.tag}</small>
							</button>
						</li>
					))}
				</ul>
				{focus && (
					<div className="technique-detail" data-technique-detail={focus.id}>
						<TechniqueDiagram id={focus.id} />
						<p>{focus.description}</p>
						<div className="technique-params" data-technique-params>
							{Object.entries(focus.params).map(([key, schema]) => <ParamField key={key} name={key} schema={schema} value={params[key]} onChange={(value) => change(key, value)} />)}
						</div>
						<CompositionFields value={applied?.composition ?? null} onChange={(next) => (applied ? send(applied.stack, next) : null)} />
						{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-technique-status role="status">{status.text}{status.warnings?.length ? ` ${status.warnings.join(" ")}` : ""}</p>}
						<FurtherReading section="techniques" id={focus.id} setting><a className="technique-more" href="https://grokfilm.app" target="_blank" rel="noreferrer">grokfilm.app</a></FurtherReading>
					</div>
				)}
			</div>
		</Foldout>
	);
}
