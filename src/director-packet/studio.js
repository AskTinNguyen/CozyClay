// The Studio's side of the director packet (director-packet A3, A4): the
// packet for a range of the editor's shots, its plan drawn on a canvas
// (plan-draw.js) and its contact sheet rendered through the export path (one
// frame per shot at its middle, the shot camera, tiled by
// studio-contact-sheet.js and numbered as the shot list numbers them), written
// as packet/ inside the sequence pack for the same range.
import { directorPacket } from "./packet.js";
import { drawPacketPlan } from "./plan-draw.js";
import { packetFiles } from "./files.js";
import { intensityStrip } from "./intensity.js";
import { buildContactSheet } from "../studio-contact-sheet.js";
import { studioSequenceDocument } from "../sequence-prompt-studio.js";
import { ko } from "../locale.js";

const SHEET_MAX_SIDE = 1600;

function canvasBytes(canvas) {
	const binary = atob(canvas.toDataURL("image/png").split(",")[1]);
	return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** The plan as PNG bytes, at its page size. */
function planPng(packet) {
	const canvas = document.createElement("canvas");
	canvas.width = packet.plan.page.width;
	canvas.height = packet.plan.page.height;
	drawPacketPlan(canvas.getContext("2d"), packet.plan, { title: packet.title });
	return canvasBytes(canvas);
}

/** The intensity strip as PNG bytes (rows top-down), or null without an intensity section. */
function intensityPng(packet) {
	const strip = intensityStrip(packet);
	if (!strip) return null;
	const canvas = document.createElement("canvas");
	canvas.width = strip.width;
	canvas.height = strip.height;
	const ctx = canvas.getContext("2d"), image = ctx.createImageData(strip.width, strip.height);
	image.data.set(strip.data);
	ctx.putImageData(image, 0, 0);
	return canvasBytes(canvas);
}

/** The middle frame of each row, the grid they tile in (up to four across). */
function contactSheetCells(packet) {
	const frames = packet.shots.map((row) => Math.floor((row.frames.start + row.frames.end) / 2)), columns = Math.max(1, Math.min(4, frames.length));
	return { frames, columns, rows: Math.max(1, Math.ceil(frames.length / columns)) };
}

/** The contact sheet as PNG bytes: renderFrameBuffer(frame) -> { data (rows bottom-up), width, height }. */
function contactSheetPng(packet, renderFrameBuffer) {
	const { frames, columns, rows } = contactSheetCells(packet);
	const sheet = buildContactSheet(frames, renderFrameBuffer, { maxSide: SHEET_MAX_SIDE, columns, rows });
	const canvas = document.createElement("canvas");
	canvas.width = sheet.width;
	canvas.height = sheet.height;
	const ctx = canvas.getContext("2d"), image = ctx.createImageData(sheet.width, sheet.height), stride = sheet.width * 4;
	// The sheet's rows run bottom-up (WebGL read-back order): flip into canvas order.
	for (let y = 0; y < sheet.height; y += 1) image.data.set(sheet.data.subarray((sheet.height - 1 - y) * stride, (sheet.height - y) * stride), y * stride);
	ctx.putImageData(image, 0, 0);
	const tileW = sheet.width / columns, tileH = sheet.height / rows;
	ctx.font = "600 15px system-ui, sans-serif";
	ctx.textBaseline = "middle";
	packet.shots.forEach((row, i) => {
		const x = (i % columns) * tileW, y = Math.floor(i / columns) * tileH, words = `${row.number} · ${row.name} · f${frames[i]}`;
		ctx.fillStyle = "rgba(0, 0, 0, 0.62)"; ctx.fillRect(x, y, Math.min(tileW, ctx.measureText(words).width + 16), 26);
		ctx.fillStyle = "#ffffff"; ctx.fillText(words, x + 8, y + 13);
		ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);
	});
	return canvasBytes(canvas);
}

/** The packet for some of the editor's shots (readStudioState's state). */
export const studioPacket = (state, { shotIds = null, range = null, placeAt } = {}) => directorPacket(studioSequenceDocument(state), { range: shotIds ? { shotIds } : range, ...(placeAt ? { placeAt } : {}) });

/**
 * The director packet export: the sequence pack for the shots plus packet/.
 * @param {{ exportSequencePack, readStudioState, renderFrameBuffer }} deps  sequencePackExporter's export, and the export path's frame render
 * @returns {(shotIds: string[], options?: { placeAt? }) => Promise<{ name, files, packet } | null>}
 */
export function directorPacketExporter(deps) {
	return async (shotIds, { placeAt } = {}) => {
		const packet = studioPacket(deps.readStudioState(), { shotIds, placeAt });
		if (!packet.shots.length) return null;
		const result = await deps.exportSequencePack(shotIds, null, async (job) => {
			job.label = ko("Director packet: plan and contact sheet", "디렉터 패킷: 플랜과 콘택트 시트");
			return packetFiles(packet, { plan: planPng(packet), contactSheet: contactSheetPng(packet, deps.renderFrameBuffer), intensity: intensityPng(packet) });
		});
		return result ? { ...result, packet } : null;
	};
}
