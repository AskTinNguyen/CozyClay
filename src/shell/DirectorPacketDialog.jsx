import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { useStudioShell } from "./studio-shell-context.js";
import { directorPacketOpen } from "./director-packet-open.js";
import { shotsInRange } from "../shot-prompt-engine/sequence.js";
import { studioPacket } from "../director-packet/studio.js";
import { drawPacketPlan } from "../director-packet/plan-draw.js";
import { packetFileNames } from "../director-packet/files.js";
import "./sequence-prompt.css";
import "./director-packet.css";

// File › Export › Director packet: a range of shots as a shooting plan
// (src/director-packet). The preview shows the plan as it prints, the shot
// list with the flags the checks raise, and the notes; Download runs
// export.directorPacket, which renders the plan and the contact sheet and
// writes packet/ inside the range's sequence pack.
export default function DirectorPacketDialog() {
	const open = useSyncExternalStore(directorPacketOpen.subscribe, directorPacketOpen.get);
	const { readStudioState, shots, recState } = useStudioShell();
	if (!open) return null;
	return <DirectorPacketBody onClose={() => directorPacketOpen.set(false)} readStudioState={readStudioState} shots={shots} recording={recState === "recording"} />;
}

function PlanPreview({ packet }) {
	const ref = useRef(null);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		canvas.width = packet.plan.page.width;
		canvas.height = packet.plan.page.height;
		drawPacketPlan(canvas.getContext("2d"), packet.plan, { title: packet.title });
	}, [packet]);
	return <canvas ref={ref} className="director-packet-plan" data-testid="packet-plan" data-cameras={packet.plan.counts.cameras} data-lines={packet.plan.counts.lines} aria-label={ko("Plan", "플랜")} />;
}

function DirectorPacketBody({ onClose, readStudioState, shots, recording }) {
	const titleId = useId(), closeRef = useRef(null), bus = useBus();
	const ordered = useMemo(() => shotsInRange({ shots }), [shots]);
	const [from, setFrom] = useState(1), [to, setTo] = useState(ordered.length);
	const last = Math.max(1, ordered.length), lo = Math.min(from, last), hi = Math.max(lo, Math.min(to, last));
	// The editor's state when the dialog opened (it is modal: nothing edits the shots while it is up).
	const [state] = useState(readStudioState);
	const packet = useMemo(() => studioPacket(state, { range: { from: lo, to: hi } }), [state, lo, hi]);
	useEffect(() => {
		closeRef.current?.focus();
		const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	const flags = packet.shots.reduce((sum, row) => sum + row.flags.length, 0);
	const shotOption = (shot, i) => <option key={shot.id} value={i + 1}>{`${i + 1}. ${shot.name || ko("Shot", "샷")}`}</option>;
	const download = () => { void bus.run("export.directorPacket", { shotIds: packet.shots.map((row) => row.shotId) }, { origin: "ui" }); onClose(); };
	return createPortal(
		<div className="menubar-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<div className="menubar-dialog sequence-prompt director-packet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-dialog="director-packet" data-testid="director-packet-dialog">
				<header className="menubar-dialog-head">
					<h2 id={titleId}>{ko("Director packet", "디렉터 패킷")}</h2>
					<button type="button" ref={closeRef} className="menubar-dialog-close" aria-label={ko("Close", "닫기")} onClick={onClose}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
					</button>
				</header>
				<div className="menubar-dialog-body director-packet-body">
					<div className="sequence-prompt-controls">
						<label>{ko("From", "시작")}
							<select data-testid="packet-from" value={lo} onChange={(event) => setFrom(Number(event.target.value))}>{ordered.map(shotOption)}</select>
						</label>
						<label>{ko("To", "끝")}
							<select data-testid="packet-to" value={hi} onChange={(event) => setTo(Number(event.target.value))}>{ordered.map(shotOption)}</select>
						</label>
					</div>
					<p className="sequence-prompt-summary" data-testid="packet-summary">
						{`${packet.shots.length} ${packet.shots.length === 1 ? ko("shot", "샷") : ko("shots", "샷")} · ${packet.seconds}s · ${packet.cast.length} ${ko("cast", "출연")} · ${flags} ${ko(flags === 1 ? "flag" : "flags", "플래그")} · ${packet.checks.map((row) => `${row.label} ${row.summary}`).join(" · ")}`}
					</p>
					<PlanPreview packet={packet} />
					<table className="director-packet-table" data-testid="packet-shots">
						<thead><tr><th>#</th><th>{ko("Shot", "샷")}</th><th>{ko("Frames", "프레임")}</th><th>TC</th><th>{ko("Size", "크기")}</th><th>{ko("Lens", "렌즈")}</th><th>{ko("Move", "무브")}</th><th>{ko("Flags", "플래그")}</th></tr></thead>
						<tbody>
							{packet.shots.map((row) => (
								<tr key={row.shotId} data-packet-shot={row.number} data-flags={row.flags.length}>
									<td>{row.number}</td><td>{row.name}</td><td>{`${row.frames.start}-${row.frames.end}`}</td><td>{row.timecode.in}</td><td>{row.size}</td>
									<td>{row.lensMm[0] === row.lensMm[1] ? `${row.lensMm[0]} mm` : `${row.lensMm[0]}-${row.lensMm[1]} mm`}</td><td>{row.measured}</td>
									<td className={row.flags.length ? "flag" : ""}>{row.flags.map((flag) => `${flag.check}/${flag.rule}`).join(", ") || "-"}</td>
								</tr>
							))}
						</tbody>
					</table>
					<ul className="director-packet-notes" data-testid="packet-notes" aria-label={ko("Notes", "노트")}>
						{packet.notes.map((note, i) => <li key={`${note.rule}-${i}`} data-note={note.rule}>{`${note.check}: ${note.message}`}</li>)}
						{packet.continuity && <li data-note="continuity">{`${ko("Continuity", "연속성")}: ${packet.continuity}`}</li>}
					</ul>
					<p className="director-packet-files" data-testid="packet-files">{`${ko("In the sequence pack", "시퀀스 팩 안에")}: ${packetFileNames({ plan: true, contactSheet: true, intensity: Boolean(packet.intensity) }).join(", ")}`}</p>
					<div className="sequence-prompt-actions">
						<button type="button" className="sequence-prompt-button primary" data-testid="packet-download" disabled={recording || !packet.shots.length}
							title={ko("The sequence pack for these shots with packet/ inside: index.html, plan.png, contact-sheet.png, intensity.png, shot-list.csv, shot-list.md", "이 샷들의 시퀀스 팩, 안에 packet/: index.html, plan.png, contact-sheet.png, intensity.png, shot-list.csv, shot-list.md")}
							onClick={download}>{ko("Download director packet", "디렉터 패킷 다운로드")}</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
