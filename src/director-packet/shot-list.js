// The packet's shot list as text files (director-packet A3): shot-list.csv
// (RFC 4180: one header row, every field quoted when it holds a comma, a quote
// or a line break, CRLF rows) for a spreadsheet or an engine importer, and
// shot-list.md for a person. The same columns in both. Pure.

export const SHOT_LIST_COLUMNS = Object.freeze([
	["number", "#", (row) => row.number], ["name", "Shot", (row) => row.name],
	["start_frame", "Start", (row) => row.frames.start], ["end_frame", "End", (row) => row.frames.end],
	["tc_in", "TC in", (row) => row.timecode.in], ["tc_out", "TC out", (row) => row.timecode.out],
	["duration_s", "Dur (s)", (row) => row.durationSeconds], ["subject", "Subject", (row) => row.subject],
	["size", "Size", (row) => row.size], ["angle", "Angle", (row) => row.angle],
	["lens_mm", "Lens (mm)", (row) => (row.lensMm[0] === row.lensMm[1] ? `${row.lensMm[0]}` : `${row.lensMm[0]}-${row.lensMm[1]}`)],
	["move", "Move", (row) => row.move], ["measured", "Measured", (row) => row.measured],
	["capabilities", "Capabilities", (row) => row.capabilities.join("; ")], ["composition", "Composition", (row) => row.composition ?? ""],
	["coverage", "Coverage", (row) => row.coverage ?? ""], ["transition_in", "In", (row) => row.transitionIn],
	["flags", "Flags", (row) => row.flags.map((flag) => `${flag.check}/${flag.rule} (${flag.severity}): ${flag.message}`).join(" | ")],
]);

const csvField = (value) => {
	const text = String(value ?? "");
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** shot-list.csv: a header of the column ids, then one row per shot. */
export function shotListCsv(packet) {
	const rows = [SHOT_LIST_COLUMNS.map(([id]) => id), ...packet.shots.map((row) => SHOT_LIST_COLUMNS.map(([, , value]) => value(row)))];
	return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const mdCell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");

/** shot-list.md: a title, the range, the cast, the beats, the shot table and the notes. */
export function shotListMarkdown(packet) {
	const head = SHOT_LIST_COLUMNS.filter(([id]) => id !== "flags");
	const lines = [
		`# ${packet.title}: shot list`, "",
		`Shots ${packet.range.from}-${packet.range.to} of ${packet.range.of}, frames ${packet.range.startFrame}-${packet.range.endFrame}, ${packet.seconds}s at ${packet.fps} fps, ${packet.aspect ?? "the project aspect"}.`, "",
		"## Cast", "", ...packet.cast.map((row) => `- ${row.letter}: ${row.descriptor}${row.subjectOf.length ? ` (subject of shot ${row.subjectOf.join(", ")})` : ""}`), "",
	];
	if (packet.beats) lines.push("## Story beats", "", ...packet.beats.map((beat) => `- f${beat.frame}${beat.timecode ? ` (${beat.timecode})` : ""}: ${beat.kind}, ${beat.label}${beat.shot ? `, in shot ${beat.shot}` : ""}`), "");
	lines.push("## Shots", "", `| ${head.map(([, title]) => title).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`,
		...packet.shots.map((row) => `| ${head.map(([, , value]) => mdCell(value(row))).join(" | ")} |`), "");
	const flagged = packet.shots.filter((row) => row.flags.length);
	lines.push("## Notes", "", ...packet.checks.map((check) => `- ${check.label}: ${check.summary}.`));
	for (const row of flagged) for (const flag of row.flags) lines.push(`- Shot ${row.number} (${flag.check}, ${flag.severity}): ${flag.message}`);
	for (const note of packet.notes) lines.push(`- Range (${note.check}, ${note.severity}): ${note.message}`);
	if (packet.continuity) lines.push(`- Continuity: ${packet.continuity}`);
	return `${lines.join("\n")}\n`;
}
