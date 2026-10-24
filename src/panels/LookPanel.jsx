import { useEffect, useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { LIGHTING_PRESETS } from "../stage-lighting.js";
import { LOOK_RECIPES } from "../colour-script/recipes.js";
import { lookText, paletteWithSwatch } from "../colour-script/edit.js";
import "./coverage.css";
import "./look.css";

const NUMBERS = [["exposure", ["Exposure", "노출"], 0.2, 3, 0.05, 1], ["warmth", ["Key warmth", "키 색온도"], 0, 1, 0.05, 0.5], ["fill", ["Fill", "필"], 0, 3, 0.05, 1], ["fog", ["Haze", "안개"], 0, 1, 0.05, 0]];
const COLOURS = [["keyColor", ["Key colour", "키 색"], "#ffffff"], ["sky", ["Sky", "하늘"], "#3a3d44"]];

/** The shot's own look (colour-script A7): a recipe in story words, the partial look over the stage, the palette it is meant to read as, and the palette measured from its middle frame. */
export default function LookPanel({ hidden, activeShot }) {
	const { run } = useBus();
	const look = activeShot?.look ?? null, [status, setStatus] = useState(null), [reading, setReading] = useState(null);
	// What the measure belongs to: a reading of another shot or an older look is not shown.
	const lookKey = `${activeShot?.id ?? ""}:${JSON.stringify(look)}`, measured = reading?.key === lookKey ? reading.value : null;
	const report = (receipt) => setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	const measure = async () => {
		if (!activeShot) return;
		const key = lookKey, receipt = await run("shot.colourScript", { shotIds: [activeShot.id] });
		setReading({ key, value: receipt?.ok ? receipt.output.shots[0]?.measured ?? null : null });
		if (!receipt?.ok) report(receipt);
	};
	const set = async (args) => report(await run("shot.setLook", { shotId: activeShot.id, ...args }));
	// Measure again when the shot or its look settles (rendered through the export path, one middle frame).
	useEffect(() => {
		if (hidden || !activeShot) return undefined;
		const timer = setTimeout(() => void measure(), 150);
		return () => clearTimeout(timer);
	}, [lookKey, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
	const swatches = look?.palette?.swatches ?? [];
	return (
		<Foldout hidden={hidden} title={ko("Look", "룩")}>
			<div className="coverage-action look-panel" data-look-panel={activeShot?.id ?? ""} data-look-recipe={look?.recipe ?? ""}>
				{!activeShot ? <p className="cut-summary">{ko("Select a shot to give it a look of its own.", "샷을 선택하면 고유 룩을 줄 수 있습니다.")}</p> : <>
				<p className="cut-summary" data-look-words>{lookText(look)}</p>
				<label className="coverage-field"><span>{ko("Recipe", "레시피")}</span>
					<select data-look-recipe-select value={look?.recipe ?? ""} onChange={(event) => (event.target.value ? set({ recipe: event.target.value }) : set({ clear: true }))}>
						<option value="">{ko("Stage look", "무대 룩")}</option>
						{LOOK_RECIPES.map((row) => <option key={row.id} value={row.id} title={row.mood}>{row.label}</option>)}
					</select>
				</label>
				<label className="coverage-field"><span>{ko("Preset", "프리셋")}</span>
					<select data-look-field="preset" value={look?.preset ?? ""} onChange={(event) => set({ look: { preset: event.target.value || null } })}>
						<option value="">{ko("From the stage", "무대 따라")}</option>
						{LIGHTING_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
					</select>
				</label>
				{NUMBERS.map(([field, label, min, max, step, fallback]) => (
					<label key={field} className="coverage-field look-number"><span>{ko(...label)}</span>
						<input type="range" data-look-field={field} min={min} max={max} step={step} value={look?.[field] ?? fallback} onChange={(event) => set({ look: { [field]: Number(event.target.value) } })} />
						<output>{look?.[field] === undefined ? "—" : look[field].toFixed(2)}</output>
					</label>
				))}
				{COLOURS.map(([field, label, fallback]) => (
					<label key={field} className="coverage-field look-colour"><span>{ko(...label)}</span>
						<input type="color" data-look-field={field} value={look?.[field] ?? fallback} onChange={(event) => set({ look: { [field]: event.target.value } })} />
						{look?.[field] && <button type="button" className="btn ghost" onClick={() => set({ look: { [field]: null } })}>{ko("Clear", "지우기")}</button>}
					</label>
				))}
				<div className="look-swatches" data-look-intended={swatches.length}>
					<span>{ko("Intended", "의도")}{look?.palette?.word ? ` · ${look.palette.word}` : ""}</span>
					{[0, 1, 2, 3, 4].map((i) => (
						<input key={i} type="color" aria-label={ko(`Intended swatch ${i + 1}`, `의도 견본 ${i + 1}`)} data-look-swatch={i} value={swatches[i] ?? "#808080"}
							onChange={(event) => set({ palette: paletteWithSwatch(look?.palette, i, event.target.value) })} />
					))}
				</div>
				<div className="look-swatches measured" data-look-measured={measured ? measured.swatches.length : 0} data-look-warmth={measured?.warmth ?? ""} data-look-luminance={measured?.meanLuminance ?? ""}>
					<span>{ko("Measured", "측정")}</span>
					{measured ? measured.swatches.map((swatch) => <i key={swatch.hex} style={{ background: swatch.hex, flexGrow: Math.max(0.05, swatch.share) }} title={`${swatch.hex} ${Math.round(swatch.share * 100)}%`} />)
						: <em>{ko("measuring…", "측정 중…")}</em>}
				</div>
				{measured && <p className="look-readout">{ko(`Luminance ${measured.meanLuminance.toFixed(2)} · warmth ${measured.warmth.toFixed(2)} · saturation ${measured.saturation.toFixed(2)}`, `밝기 ${measured.meanLuminance.toFixed(2)} · 색온도 ${measured.warmth.toFixed(2)} · 채도 ${measured.saturation.toFixed(2)}`)}</p>}
				{look && <button type="button" className="btn ghost" data-look-clear onClick={() => set({ clear: true })}>{ko("Back to the stage look", "무대 룩으로")}</button>}
				</>}
				{status && <p className={status.ok ? "technique-status" : "technique-status refused"} data-look-status role="status">{status.text}</p>}
			</div>
		</Foldout>
	);
}
