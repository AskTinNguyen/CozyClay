import { useMemo } from "react";
import { ko } from "../locale.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { checkCoverage } from "../camera-coverage/completeness.js";

const FALLBACK_FILMBACK = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const KIND_LABELS = { master: ["Master", "마스터"], sizes: ["Sizes", "사이즈"], "line-change": ["Line", "축"], branch: ["Branch", "분기"] };

/** Is there enough here to edit? The coverage check (camera-coverage/completeness.js) over every shot, with each gap's suggested stack. */
export default function CoverageReadout({ shots }) {
	const { characters = [], filmback } = useStudioShell() ?? {};
	const visible = useMemo(() => characters.filter((row) => !row.hidden), [characters]);
	const report = useMemo(() => checkCoverage(shots ?? [], { cast: visible, filmback: filmback ?? FALLBACK_FILMBACK }), [shots, visible, filmback]);
	const nameOf = (id) => (visible.find((row) => row.id === id)?.subject ?? id ?? "").split(",")[0];
	if (!report.shots) return <p className="inspector-hint v2-details-hint">{ko("Lay coverage to check it.", "커버리지를 깔면 점검합니다.")}</p>;
	return (
		<div className="coverage-readout" data-coverage-readout={report.gaps.length} data-coverage-complete={report.complete ? "yes" : "no"}>
			<p className="cut-summary">{report.complete ? ko(`Enough to edit: ${report.shots} shots, ${report.cast.length} cast.`, `편집 가능: 샷 ${report.shots}개, 인물 ${report.cast.length}명.`)
				: ko(`${report.gaps.length} gap${report.gaps.length === 1 ? "" : "s"} over ${report.shots} shots`, `샷 ${report.shots}개에 빈틈 ${report.gaps.length}개`)}</p>
			<ul className="cut-rules">
				{report.complete ? <li className="cut-rule ok" data-coverage-gap="none">{ko("A master, two sizes of everyone, the line changes covered, the branches matched.", "마스터, 인물별 두 사이즈, 축 전환, 분기 일치.")}</li>
					: report.gaps.map((gap, i) => (
						<li key={i} className={`cut-rule ${gap.kind === "line-change" ? "high" : "medium"}`} data-coverage-gap={gap.kind}>
							<strong>{ko(...KIND_LABELS[gap.kind])}</strong> {gap.message} <em>{ko("Suggest", "제안")}: {gap.suggest.stack.map((item) => item.id).join(" + ")}{gap.suggest.subjectId ? ` · ${nameOf(gap.suggest.subjectId)}` : ""}.</em>
						</li>
					))}
			</ul>
		</div>
	);
}
