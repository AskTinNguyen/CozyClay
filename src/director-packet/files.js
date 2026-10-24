// The director packet's files inside the sequence pack (director-packet A3):
// packet/index.html, packet/shot-list.csv, packet/shot-list.md,
// packet/packet.json and the pictures the Studio rendered (plan.png,
// contact-sheet.png, and each further picture a landed feature adds). A picture
// that was not rendered is left out of the folder and off the page. Pure.
import { packetPage } from "./page.js";
import { shotListCsv, shotListMarkdown } from "./shot-list.js";

const PACKET_FOLDER = "packet";

/** The pictures a packet can carry, in page order. `images[id]` holds the PNG bytes the Studio rendered. */
const PACKET_PICTURES = Object.freeze([
	{ id: "plan", file: "plan.png", title: "Plan", caption: "Top-down plan: numbered cameras with their frustums and moves, the lines of action, the cast's marks and paths." },
	{ id: "contactSheet", file: "contact-sheet.png", title: "Contact sheet", caption: "One frame per shot at its middle, numbered as in the shot list." },
]);

/** The file names a packet folder holds, given which pictures were rendered. */
export function packetFileNames(images = {}) {
	return [
		"index.html", "shot-list.csv", "shot-list.md", "packet.json",
		...PACKET_PICTURES.filter((picture) => images[picture.id]).map((picture) => picture.file),
	].map((name) => `${PACKET_FOLDER}/${name}`);
}

/**
 * @param {object} packet  directorPacket's answer
 * @param {Record<string, Uint8Array>} [images]  PNG bytes by PACKET_PICTURES id
 * @returns {Array<{ name, data }>} zip entries under packet/
 */
export function packetFiles(packet, images = {}) {
	const pictures = PACKET_PICTURES.filter((picture) => images[picture.id]);
	return [
		{ name: `${PACKET_FOLDER}/index.html`, data: packetPage(packet, pictures) },
		{ name: `${PACKET_FOLDER}/shot-list.csv`, data: shotListCsv(packet) },
		{ name: `${PACKET_FOLDER}/shot-list.md`, data: shotListMarkdown(packet) },
		{ name: `${PACKET_FOLDER}/packet.json`, data: `${JSON.stringify(packet, null, 2)}\n` },
		...pictures.map((picture) => ({ name: `${PACKET_FOLDER}/${picture.file}`, data: images[picture.id] })),
	];
}
