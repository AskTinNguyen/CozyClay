import { ko } from "../locale.js";
import { useStudioShell } from "./studio-shell-context.js";

// The Export menu items that read the whole cut: Sequence prompt (the brief a
// video model gets, shot-prompt-engine) and the OTIO cut list. Shown once the
// timeline has a shot; `item` closes the menu and runs the handler.
export default function SequenceExportItems({ item }) {
	const { setSequencePromptOpen, downloadOtioCutList } = useStudioShell();
	return (
		<>
			<button type="button" role="menuitem" className="menubar-item" data-testid="export-sequence-prompt"
				title={ko("One brief for a video model: numbered beats with timecodes, the measured camera, the cast and the references, shaped for a model", "영상 모델용 브리프 하나: 타임코드가 붙은 비트, 측정한 카메라, 출연진과 참조, 모델에 맞춤")}
				onClick={item(() => setSequencePromptOpen(true))}>
				<span className="menubar-item-label">{ko("Sequence prompt…", "시퀀스 프롬프트…")}</span>
			</button>
			<button type="button" role="menuitem" className="menubar-item" data-testid="export-otio" title={ko("Download OTIO cut list", "OTIO 컷 목록 다운로드")} onClick={item(downloadOtioCutList)}>
				<span className="menubar-item-label">{ko("OTIO cut list", "OTIO 컷 목록")}</span>
			</button>
		</>
	);
}
