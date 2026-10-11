import { useRef, useState } from "react";
import { isPlaygroundEmbed } from "./playground.js";

export function useEmbedBridge() {
	const embedMode = ["scene", "playview"].includes(new URLSearchParams(globalThis.location?.search || "").get("embed"));
	// The landing page's try-it iframe: full studio interaction on a preset
	// scene with the project chrome hidden and saving off (see playground.js).
	const playgroundMode = isPlaygroundEmbed(globalThis.location?.search);
	const [playgroundHint, setPlaygroundHint] = useState(null);
	const playgroundExportRef = useRef(null);
	return { embedMode, playgroundMode, playgroundHint, setPlaygroundHint, playgroundExportRef };
}
