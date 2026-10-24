import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ko } from "../locale.js";
import { useStudioShell } from "./studio-shell-context.js";
import { MODEL_PROFILES } from "../model-profiles.js";
import { shotsInRange } from "../shot-prompt-engine/sequence.js";
import { studioSequenceBrief } from "../sequence-prompt-studio.js";
import "./sequence-prompt.css";

// Export › Sequence prompt: the brief a video model gets for a range of shots
// (src/shot-prompt-engine), shaped by a model profile, with what breaks the
// profile's limits and a fix for each, a copy button, and the sequence pack
// (every shot's keyframe pack plus sequence-prompt.txt and references.json).
export default function SequencePromptDialog() {
	const { sequencePromptOpen, setSequencePromptOpen, readStudioState, shots, exportSequencePack, recState } = useStudioShell();
	if (!sequencePromptOpen) return null;
	return <SequencePromptBody onClose={() => setSequencePromptOpen(false)} readStudioState={readStudioState} shots={shots} exportSequencePack={exportSequencePack} recording={recState === "recording"} />;
}

function SequencePromptBody({ onClose, readStudioState, shots, exportSequencePack, recording }) {
	const titleId = useId(), closeRef = useRef(null), textRef = useRef(null);
	const ordered = useMemo(() => shotsInRange({ shots }), [shots]);
	const [from, setFrom] = useState(1), [to, setTo] = useState(ordered.length), [profile, setProfile] = useState(""), [copiedText, setCopiedText] = useState(null);
	const last = Math.max(1, ordered.length), lo = Math.min(from, last), hi = Math.max(lo, Math.min(to, last));
	// The editor's state when the dialog opened (it is modal: nothing edits the shots while it is up).
	const [state] = useState(readStudioState);
	const brief = useMemo(() => studioSequenceBrief(state, { range: { from: lo, to: hi }, profile: profile || null }).brief, [state, lo, hi, profile]);
	useEffect(() => {
		closeRef.current?.focus();
		const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	async function copy() {
		try {
			await navigator.clipboard.writeText(brief.text);
		} catch {
			// Clipboard permission denied: select the text so Ctrl+C copies it.
			textRef.current?.select();
			document.execCommand?.("copy");
		}
		setCopiedText(brief.text);
	}
	const shotOption = (shot, i) => <option key={shot.id} value={i + 1}>{`${i + 1}. ${shot.name || ko("Shot", "샷")}`}</option>;
	return createPortal(
		<div className="menubar-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<div className="menubar-dialog sequence-prompt" role="dialog" aria-modal="true" aria-labelledby={titleId} data-dialog="sequence-prompt" data-testid="sequence-prompt-dialog">
				<header className="menubar-dialog-head">
					<h2 id={titleId}>{ko("Sequence prompt", "시퀀스 프롬프트")}</h2>
					<button type="button" ref={closeRef} className="menubar-dialog-close" aria-label={ko("Close", "닫기")} onClick={onClose}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
					</button>
				</header>
				<div className="menubar-dialog-body sequence-prompt-body">
					<div className="sequence-prompt-controls">
						<label>{ko("From", "시작")}
							<select data-testid="sequence-from" value={lo} onChange={(event) => setFrom(Number(event.target.value))}>{ordered.map(shotOption)}</select>
						</label>
						<label>{ko("To", "끝")}
							<select data-testid="sequence-to" value={hi} onChange={(event) => setTo(Number(event.target.value))}>{ordered.map(shotOption)}</select>
						</label>
						<label>{ko("Model", "모델")}
							<select data-testid="sequence-profile" value={profile} onChange={(event) => setProfile(event.target.value)}>
								<option value="">{ko("Any model", "모든 모델")}</option>
								{MODEL_PROFILES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
							</select>
						</label>
					</div>
					<p className="sequence-prompt-summary" data-testid="sequence-summary">
						{`${brief.beats.length} ${brief.beats.length === 1 ? ko("beat", "비트") : ko("beats", "비트")} · ${Number(brief.seconds.toFixed(2))}s · ${brief.aspect ?? "—"} · ${brief.clips.length} ${ko(brief.clips.length === 1 ? "clip" : "clips", "클립")} · ${brief.references.entries.length} ${ko("references", "참조")}`}
						{brief.profile.id && <span className="sequence-prompt-checked">{` · ${ko("limits checked", "제한 확인")} ${brief.profile.checkedAt}`}</span>}
					</p>
					{brief.warnings.length > 0 ? (
						<ul className="sequence-prompt-warnings" data-testid="sequence-warnings" aria-label={ko("Warnings", "경고")}>
							{brief.warnings.map((row, i) => <li key={`${row.code}-${i}`} data-code={row.code}><strong>{row.message}</strong> {row.fix}</li>)}
						</ul>
					) : (
						<p className="sequence-prompt-ok" data-testid="sequence-no-warnings">{brief.profile.id ? ko(`Fits ${brief.profile.name}.`, `${brief.profile.name}에 맞습니다.`) : ko("No model limits applied.", "모델 제한 없음.")}</p>
					)}
					<textarea ref={textRef} className="sequence-prompt-text" data-testid="sequence-brief" readOnly spellCheck={false} value={brief.text} aria-label={ko("Sequence brief", "시퀀스 브리프")} />
					<div className="sequence-prompt-actions">
						<button type="button" className="sequence-prompt-button primary" data-testid="sequence-copy" onClick={copy}>{copiedText === brief.text ? ko("Copied", "복사됨") : ko("Copy brief", "브리프 복사")}</button>
						<button type="button" className="sequence-prompt-button" data-testid="sequence-pack" disabled={recording || !brief.beats.length}
							title={ko("Every shot's keyframe pack in one zip, with sequence-prompt.txt and references.json", "모든 샷의 키프레임 팩을 zip 하나로, sequence-prompt.txt와 references.json 포함")}
							onClick={() => { void exportSequencePack(brief.beats.map((beat) => beat.id), profile || null); onClose(); }}>{ko("Download sequence pack", "시퀀스 팩 다운로드")}</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
