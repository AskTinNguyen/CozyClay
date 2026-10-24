/**
 * director-packet-tool.mjs — render_packet: a range of shots as a director
 * packet, in memory (director-packet A5). It answers the shot list (the
 * packet's shot-list.md) and the packet data (packet.json: the cast, the story
 * beats, a row per shot with the flags the existing checks raise, the notes and
 * the plan primitives). No pictures are rendered here: with an editor
 * connected it reads the editor's shots, otherwise the shots cover_scene
 * planned; the full pack, with plan.png and contact-sheet.png inside the
 * sequence pack, is the editor's export.directorPacket
 * (`cclay live run export.directorPacket`).
 */
import { directorPacket } from "../src/director-packet/packet.js";
import { packetFileNames } from "../src/director-packet/files.js";
import { shotListCsv, shotListMarkdown } from "../src/director-packet/shot-list.js";
import { promptDocument } from "./render-prompt-tool.mjs";

/** MCP annotations (tool-handlers.mjs TOOL_ANNOTATIONS). */
export const PACKET_TOOL_ANNOTATIONS = Object.freeze({
	render_packet: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

/**
 * @param {object} deps  the registry's helpers: tool, z, text, liveError, state, scene, stage, findCharacter, filmback, refreshLiveDescription, isLive
 */
export function directorPacketTool(deps) {
	const { tool, z, text, liveError } = deps;
	return tool(
		"render_packet",
		{
			title: "Render the director packet for a range of shots",
			description:
				"A range of shots as a shooting plan for a mocap team, a game engine or a collaborator: the shot list (number, name, frames and timecode, duration, " +
				"size, angle, lens mm, the move in measured words, capabilities, composition, coverage role, transition in, and the flags of the cut, coverage, " +
				"motivation and shot checks) and the packet data (cast, story beats, notes, and the plan's primitives: numbered cameras with frustums and move paths, " +
				"every pair's line of action, the cast's marks and walks). In memory: no pictures. With an editor connected it reads the editor's shots; otherwise " +
				"the shots cover_scene planned. The full pack (packet/index.html, plan.png, contact-sheet.png, shot-list.csv, shot-list.md inside the sequence pack) " +
				"is written by the editor: cclay live run export.directorPacket. With two shots or more the data also carries the intensity curve (intensity-curve) and the pack intensity.png.",
			inputSchema: {
				from_shot: z.number().int().min(1).optional().describe("first shot (1-based, time order)"),
				to_shot: z.number().int().min(1).optional().describe("last shot (inclusive)"),
				format: z.enum(["markdown", "csv"]).default("markdown").describe("the shot list as shot-list.md (default) or shot-list.csv"),
				include_plan: z.boolean().default(true).describe("include the plan primitives in the data"),
			},
		},
		async ({ from_shot, to_shot, format, include_plan }) => {
			const live = deps.isLive();
			if (live) {
				try {
					await deps.refreshLiveDescription();
				} catch (error) {
					return liveError(error);
				}
			}
			const document = promptDocument(deps, live);
			if (!document.shots.length) return text(live ? "The editor has no shots yet: add one (shot.create) or cover the scene (cover_scene)." : "No shots in memory: plan some with cover_scene, or connect an editor.");
			const packet = directorPacket(document, { range: { from: from_shot, to: to_shot } });
			if (!packet.shots.length) return text(`No shots in ${from_shot ?? 1}-${to_shot ?? "end"}: the sequence has ${packet.range.of}.`);
			const data = include_plan ? packet : { ...packet, plan: { counts: packet.plan.counts } };
			const files = packetFileNames({ plan: true, contactSheet: true, intensity: Boolean(packet.intensity) });
			const head = `Director packet: ${packet.title}, shots ${packet.range.from}-${packet.range.to} of ${packet.range.of}, ${packet.seconds}s; ` +
				`${packet.checks.map((row) => `${row.label.toLowerCase()} ${row.summary}`).join("; ")}; plan ${Object.entries(packet.plan.counts).map(([key, value]) => `${value} ${key}`).join(", ")} ` +
				`(${live ? "the editor's shots" : "memory: the shots cover_scene planned"}; no pictures rendered here, ${live ? `the editor's export.directorPacket writes ${files.join(", ")} inside the sequence pack` : "an editor's export.directorPacket renders plan.png, contact-sheet.png and intensity.png"}).`;
			return { content: [
				{ type: "text", text: `${head}\n\n${format === "csv" ? shotListCsv(packet) : shotListMarkdown(packet)}` },
				{ type: "text", text: JSON.stringify(data) },
			] };
		},
	);
}
