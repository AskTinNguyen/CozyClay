// packet/index.html (director-packet A3): one printable page that references
// the packet's other files. A header (title, range, length, aspect), the plan,
// each further picture the packet carries, the cast, the story beats when
// there are any, the shot list with its flags, and the notes. Print CSS sets
// an A4 landscape page; the browser prints it (Non-Goals: no PDF). Pure text.
import { SHOT_LIST_COLUMNS } from "./shot-list.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const SHOWN = new Set(["number", "name", "tc_in", "duration_s", "subject", "size", "angle", "lens_mm", "move", "measured", "capabilities", "composition", "coverage", "transition_in"]);

const STYLE = `@page { size: A4 landscape; margin: 10mm; }
body { font: 11px/1.4 system-ui, sans-serif; color: #26231e; background: #fff; margin: 16px; }
h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #cfc9bc; }
.meta { color: #6d685d; margin: 0 0 10px; } figure { margin: 0 0 8px; break-inside: avoid; } figure img { width: 100%; border: 1px solid #cfc9bc; }
figcaption { color: #6d685d; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ddd8cc; padding: 3px 5px; vertical-align: top; text-align: left; }
th { background: #f3f1ea; } tr { break-inside: avoid; } .flag { color: #a8321f; } .flag.low { color: #8a6d1f; } ul { margin: 4px 0; padding-left: 18px; }
@media print { body { margin: 0; } .page-break { break-before: page; } }`;

function table(head, rows) {
	return `<table><thead><tr>${head.map((cell) => `<th>${escape(cell)}</th>`).join("")}</tr></thead><tbody>\n${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n")}\n</tbody></table>`;
}

/**
 * @param {object} packet  directorPacket's answer
 * @param {Array<{ file, title, caption }>} pictures  the images the pack carries, in page order (the plan first)
 */
export function packetPage(packet, pictures) {
	const columns = SHOT_LIST_COLUMNS.filter(([id]) => SHOWN.has(id));
	const flags = (row) => row.flags.map((flag) => `<div class="flag ${escape(flag.severity)}">${escape(`${flag.check} · ${flag.rule} (${flag.severity}): ${flag.message}`)}</div>`).join("");
	const shotRows = packet.shots.map((row) => [...columns.map(([, , value]) => escape(value(row))), flags(row)]);
	const notes = [
		...packet.checks.map((check) => `<li>${escape(`${check.label}: ${check.summary}.`)}</li>`),
		...packet.notes.map((note) => `<li class="flag ${escape(note.severity)}">${escape(`${note.check} · ${note.rule}: ${note.message}`)}</li>`),
		...(packet.continuity ? [`<li>${escape(`Continuity: ${packet.continuity}`)}</li>`] : []),
	];
	const [plan, ...rest] = pictures;
	const figure = (picture) => `<figure><img src="${escape(picture.file)}" alt="${escape(picture.title)}"><figcaption>${escape(picture.caption)}</figcaption></figure>`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(packet.title)}: director packet</title>
<style>
${STYLE}
</style>
</head>
<body>
<h1>${escape(packet.title)}: director packet</h1>
<p class="meta">${escape(`Shots ${packet.range.from}-${packet.range.to} of ${packet.range.of} · frames ${packet.range.startFrame}-${packet.range.endFrame} · ${packet.seconds}s at ${packet.fps} fps · ${packet.aspect ?? "project aspect"}${packet.look ? ` · ${packet.look}` : ""}${packet.set ? ` · ${packet.set}` : ""}`)}</p>
${plan ? figure(plan) : ""}
<h2>Cast</h2>
${table(["", "Who", "Subject of shots", "Character sheet"], packet.cast.map((row) => [escape(row.letter), escape(row.descriptor), escape(row.subjectOf.join(", ") || "-"), row.characterSheet ? "yes" : "no"]))}
${packet.beats ? `<h2>Story beats</h2>\n${table(["Frame", "TC", "Kind", "Beat", "Shot"], packet.beats.map((beat) => [escape(beat.frame), escape(beat.timecode ?? "-"), escape(beat.kind), escape(beat.label), escape(beat.shot ?? "-")]))}` : ""}
<h2>Shot list</h2>
<p class="meta">Also as <a href="shot-list.csv">shot-list.csv</a> and <a href="shot-list.md">shot-list.md</a>; the data as <a href="packet.json">packet.json</a>.</p>
${table([...columns.map(([, title]) => title), "Flags"], shotRows)}
<h2>Notes</h2>
<ul>
${notes.join("\n")}
</ul>
${rest.map((picture, i) => `${i === 0 ? '<div class="page-break"></div>\n' : ""}<h2>${escape(picture.title)}</h2>\n${figure(picture)}`).join("\n")}
</body>
</html>
`;
}
