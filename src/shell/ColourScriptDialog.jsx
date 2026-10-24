import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { colourScriptOpen } from "./colour-script-open.js";
import { colourScriptImage } from "../colour-script/image.js";
import { saveExport } from "../export-workspace.js";
import "./sequence-prompt.css";
import "./director-packet.css";

// File › Export › Colour script (colour-script A3): every shot's palette
// measured from its middle frame beside the palette its look intends, the
// story beats over it, and the colour change across each cut. Opening it runs
// shot.colourScript (which renders each middle frame through the export path);
// Download saves the strip as cozyclay-colour-script.png.
export default function ColourScriptDialog() {
	const open = useSyncExternalStore(colourScriptOpen.subscribe, colourScriptOpen.get);
	if (!open) return null;
	return <ColourScriptBody onClose={() => colourScriptOpen.set(false)} />;
}

/** The receipt's rows as the image module reads them. */
const scriptOf = (output) => ({ shots: output.shots.map((row) => ({ ...row, startFrame: row.frames[0], endFrame: row.frames[1], measured: row.measured ?? null })), cuts: output.cuts, beats: output.beats });

function ColourScriptBody({ onClose }) {
	const titleId = useId(), closeRef = useRef(null), canvasRef = useRef(null), bus = useBus();
	const [receipt, setReceipt] = useState(null);
	useEffect(() => {
		let live = true;
		Promise.resolve(bus.run("shot.colourScript", {}, { origin: "ui" })).then((answer) => { if (live) setReceipt(answer); });
		return () => { live = false; };
	}, [bus]);
	useEffect(() => {
		closeRef.current?.focus();
		const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !receipt?.ok) return;
		const image = colourScriptImage(scriptOf(receipt.output));
		canvas.width = image.width;
		canvas.height = image.height;
		const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(image.width, image.height);
		pixels.data.set(image.data);
		ctx.putImageData(pixels, 0, 0);
	}, [receipt]);
	const output = receipt?.ok ? receipt.output : null;
	const download = () => { if (canvasRef.current) void saveExport(canvasRef.current.toDataURL("image/png"), "cozyclay-colour-script.png"); };
	return createPortal(
		<div className="menubar-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<div className="menubar-dialog sequence-prompt director-packet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-dialog="colour-script" data-testid="colour-script-dialog" data-colour-script={output ? output.shots.length : ""}>
				<header className="menubar-dialog-head">
					<h2 id={titleId}>{ko("Colour script", "컬러 스크립트")}</h2>
					<button type="button" ref={closeRef} className="menubar-dialog-close" aria-label={ko("Close", "닫기")} onClick={onClose}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
					</button>
				</header>
				<div className="menubar-dialog-body director-packet-body">
					<p className="director-packet-files" data-colour-script-words>{output ? output.words : receipt ? receipt.message : ko("Rendering each shot's middle frame…", "샷마다 가운데 프레임을 렌더링하는 중…")}</p>
					<canvas ref={canvasRef} className="director-packet-plan colour-script-strip" data-testid="colour-script-strip" style={{ aspectRatio: "960 / 200", background: "#16181d" }} aria-label={ko("Colour script", "컬러 스크립트")} />
					{output && <table className="director-packet-table">
						<thead><tr><th>#</th><th>{ko("Shot", "샷")}</th><th>{ko("Look", "룩")}</th><th>{ko("Measured", "측정")}</th></tr></thead>
						<tbody>{output.shots.map((row) => (
							<tr key={row.shotId} data-colour-shot={row.shotId} data-colour-warmth={row.measured?.warmth ?? ""}>
								<td>{row.index}</td><td>{row.shotName}</td><td>{row.words || ko("stage look", "무대 룩")}</td>
								<td>{row.measured ? `${row.measured.swatches.map((swatch) => swatch.hex).join(" ")} · lum ${row.measured.meanLuminance.toFixed(2)} · warmth ${row.measured.warmth.toFixed(2)}` : "-"}</td>
							</tr>
						))}</tbody>
					</table>}
					{output && <ul className="director-packet-notes">{output.cuts.filter((cut) => cut.kind !== "matched").map((cut) => <li key={cut.cutFrame} className={cut.kind === "hard" ? "flag" : ""} data-colour-cut={cut.kind}>{cut.words}</li>)}</ul>}
					<div className="sequence-prompt-actions">
						<button type="button" className="sequence-prompt-button primary" data-testid="colour-script-download" disabled={!output} onClick={download}>{ko("Download PNG", "PNG 다운로드")}</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
