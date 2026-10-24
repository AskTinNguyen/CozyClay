import { ko } from "../locale.js";
import { useStudioShell } from "./studio-shell-context.js";
import { directorPacketOpen } from "./director-packet-open.js";
import { colourScriptOpen } from "./colour-script-open.js";

// The Export menu items that read the whole cut: Sequence prompt (the brief a
// video model gets, shot-prompt-engine), Director packet (the shooting plan,
// director-packet), Colour script (colour-script) and the OTIO cut list. Shown once the timeline has a shot;
// `item` closes the menu and runs the handler.
export default function SequenceExportItems({ item }) {
	const { setSequencePromptOpen, downloadOtioCutList } = useStudioShell();
	return (
		<>
			<button type="button" role="menuitem" className="menubar-item" data-testid="export-sequence-prompt"
				title={ko("One brief for a video model: numbered beats with timecodes, the measured camera, the cast and the references, shaped for a model", "영상 모델용 브리프 하나: 타임코드가 붙은 비트, 측정한 카메라, 출연진과 참조, 모델에 맞춤")}
				onClick={item(() => setSequencePromptOpen(true))}>
				<span className="menubar-item-label">{ko("Sequence prompt…", "시퀀스 프롬프트…")}</span>
			</button>
			<button type="button" role="menuitem" className="menubar-item" data-testid="export-director-packet"
				title={ko("A shooting plan for a range: the top-down plan, the shot list with its flags, a contact sheet and the notes, inside the sequence pack", "구간의 촬영 계획: 평면도, 플래그가 붙은 샷 목록, 콘택트 시트와 노트, 시퀀스 팩 안에")}
				onClick={item(() => directorPacketOpen.set(true))}>
				<span className="menubar-item-label">{ko("Director packet…", "디렉터 패킷…")}</span>
			</button>
			<button type="button" role="menuitem" className="menubar-item" data-testid="export-colour-script"
				title={ko("Every shot's palette measured from its middle frame beside the palette its look intends, with the colour change at each cut", "샷마다 가운데 프레임에서 잰 팔레트와 룩이 의도한 팔레트, 컷마다 색 변화")}
				onClick={item(() => colourScriptOpen.set(true))}>
				<span className="menubar-item-label">{ko("Colour script…", "컬러 스크립트…")}</span>
			</button>
			<button type="button" role="menuitem" className="menubar-item" data-testid="export-otio" title={ko("Download OTIO cut list", "OTIO 컷 목록 다운로드")} onClick={item(downloadOtioCutList)}>
				<span className="menubar-item-label">{ko("OTIO cut list", "OTIO 컷 목록")}</span>
			</button>
		</>
	);
}
