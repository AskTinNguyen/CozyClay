import { useState, useSyncExternalStore } from "react";
import { ko } from "../locale.js";
import { atlasPageHref, readAtlasUrl, referencesFor, writeAtlasUrl } from "../camera-references/index.js";
import "./technique-picker.css";

const ATLAS_EVENT = "cozyclay:atlas-url";

/** The atlas URL this viewer set, read from storage so every Further reading block stays in step. */
const subscribe = (onChange) => {
	globalThis.addEventListener?.(ATLAS_EVENT, onChange);
	globalThis.addEventListener?.("storage", onChange);
	return () => { globalThis.removeEventListener?.(ATLAS_EVENT, onChange); globalThis.removeEventListener?.("storage", onChange); };
};
function useAtlasUrl() {
	const url = useSyncExternalStore(subscribe, () => readAtlasUrl(), () => null);
	const save = (value) => {
		writeAtlasUrl(value);
		globalThis.dispatchEvent?.(new Event(ATLAS_EVENT));
	};
	return [url, save];
}

/** Where the owner's local atlas runs: pages link there once it is set; blank clears it. Keyed by the stored URL, so a save resets the draft. */
function AtlasUrlField({ url, onSave }) {
	const [draft, setDraft] = useState(url ?? "");
	return (
		<div className="technique-atlas" title={ko("Where your cinematic-atlas runs; book pages open there. Blank clears it.", "cinematic-atlas 주소. 책 페이지가 거기서 열려요. 비우면 해제.")} data-atlas-url-form>
			<span>{ko("Atlas", "아틀라스")}</span>
			<input data-atlas-url type="url" value={draft} placeholder="http://127.0.0.1:8000/" aria-label={ko("Atlas URL", "아틀라스 URL")}
				onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => (event.key === "Enter" ? onSave(draft) : null)} />
			<button type="button" data-atlas-url-save onClick={() => onSave(draft)}>{ko("Set", "설정")}</button>
		</div>
	);
}

/**
 * Book citations for a technique, coverage pattern or cut rule (section "techniques", "patterns" or "cuts").
 * Pages link to the atlas when its URL is set and stay plain text otherwise; `setting` shows the URL field.
 */
export default function FurtherReading({ section, id, setting = false, children = null }) {
	const [atlasUrl, saveAtlasUrl] = useAtlasUrl();
	const refs = referencesFor(section, id);
	return (
		<div className="technique-reading" data-further-reading={id} data-atlas-linked={atlasUrl ? "yes" : "no"}>
			<strong>{ko("Further reading", "더 알아보기")}</strong>
			{refs.length ? (
				<ul>
					{refs.map((ref) => (
						<li key={ref.book} data-reference-book={ref.book}>
							{ref.author}, <cite>{ref.title}</cite>{[ref.edition, ref.year].filter(Boolean).length ? ` (${[ref.edition, ref.year].filter(Boolean).join(", ")})` : ""}, p.{" "}
							{ref.pages.map((page, index) => (
								<span key={page}>
									{index ? ", " : ""}
									{atlasUrl ? <a data-reference-page={page} href={atlasPageHref(atlasUrl, ref.book, page)} target="_blank" rel="noreferrer">{page}</a> : <span data-reference-page={page}>{page}</span>}
								</span>
							))}
						</li>
					))}
				</ul>
			) : (
				<p data-reference-none>{ko("No book page in the atlas for this one yet.", "아틀라스에 아직 이 항목의 책 페이지가 없어요.")}</p>
			)}
			{children}
			{setting && <AtlasUrlField key={atlasUrl ?? ""} url={atlasUrl} onSave={saveAtlasUrl} />}
		</div>
	);
}
