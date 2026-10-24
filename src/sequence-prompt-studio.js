// The Studio's side of the sequence brief: the sequence document built from
// the editor's state (readStudioState), with each character's installed motion
// v3 take compiled once (as verify_result's beats contact sheet does) so the
// brief can mark story beats from it. Compiles are cached per take object.
import { compileSpec } from "./motion3/pipeline.js";
import { motionScene } from "./motion3/scene.js";
import { skeletonFor } from "./motion3/rigs/index.js";
import { motionEntry, sequenceDocument } from "./shot-prompt-engine/document.js";
import { buildSequencePrompt } from "./shot-prompt-engine/sequence.js";
import { sequencePackFiles } from "./shot-prompt-engine/references.js";
import { sequencePackName } from "./keyframe-pack.js";
import { buildZip } from "./zip-store.js";
import { ko } from "./locale.js";

const TAKE_SCHEMA = "cozyclay.take.v3";
const compiled = new WeakMap();

function compileTake(take, character, objects) {
	if (compiled.has(take)) return compiled.get(take);
	let answer = null;
	try {
		const sk = skeletonFor(take.rig ?? character.model);
		answer = sk ? compileSpec({ fps: 24, ...take.spec }, { sk, scene: motionScene(objects ?? []) }, { lenient: true }) : null;
	} catch (error) {
		console.warn("[cozyclay] sequence brief: the take did not compile; its story beats are left out", error);
	}
	const entry = answer ? { timeline: answer.timeline, observations: answer.observations, expanded: { objects: answer.expanded?.objects } } : null;
	compiled.set(take, entry);
	return entry;
}

/**
 * @param {object} s  readStudioState(): sceneName, aspect, stage, characters (sessionMotion), shots, frameCount, activeCharacterId, filmback, objects
 * @param {{ title?: string }} [options]
 */
export function studioSequenceDocument(s, { title } = {}) {
	const motion = (s.characters ?? []).filter((row) => !row.hidden && row.sessionMotion?.schema === TAKE_SCHEMA && row.sessionMotion.spec)
		.map((row) => motionEntry(row, row.sessionMotion, compileTake(row.sessionMotion, row, s.objects)));
	return sequenceDocument({
		title: title ?? s.sceneName, shots: s.shots ?? [], characters: s.characters ?? [], objects: s.objects ?? [], fps: 24, aspect: s.aspect ?? s.stage?.shotAspect ?? null, filmback: s.filmback,
		frameCount: s.frameCount, activeCharacterId: s.activeCharacterId, look: s.stage?.style, environment: s.stage?.environment, environmentImage: s.stage?.environmentImage, motion, storyBeats: s.storyBeats, stage: s.stage,
	});
}

/** The document and the brief for some shots of the editor (all of them without shotIds). */
export function studioSequenceBrief(s, { shotIds = null, profile = null, range = null } = {}) {
	const document = studioSequenceDocument(s);
	return { document, brief: buildSequencePrompt(document, { range: shotIds ? { shotIds } : range, profile }) };
}

/** A single shot pack's brief files: its one-beat brief, shaped for the shot's target model. */
export function shotSequenceFiles(s, shot) {
	const { document, brief } = studioSequenceBrief(s, { shotIds: [shot.id], profile: shot.targetModel ?? null });
	return sequencePackFiles(brief, document);
}

/**
 * The sequence pack export: every shot's keyframe pack (frames, clip, camera, prompt) in one zip, with the
 * range's sequence-prompt.txt, references.json, composition guides and reference pictures. `extra(job)`
 * adds more entries inside the same export job (the director packet's packet/ folder); the export answers
 * { name, files } once the zip is handed off, or null when it did not run.
 * @param {object} deps  App's export plumbing: readStudioState, executeExportRequest, exportRequest, buildShotKeyframePack(entry, index, onProgress, job, withSequence), saveExport, setToast, isRecording
 */
export function sequencePackExporter(deps) {
	return async (shotIds, profile = null, extra = null) => {
		if (deps.isRecording()) return null;
		const { document, brief } = studioSequenceBrief(deps.readStudioState(), { shotIds, profile }), name = sequencePackName(document.title);
		return deps.executeExportRequest(deps.exportRequest("keyframe_pack", async (job) => {
			const entries = [], shots = job.request.context.shots;
			for (const [order, beat] of brief.beats.entries()) {
				const index = shots.findIndex((entry) => entry.id === beat.id);
				if (index < 0) continue;
				job.label = ko(`Shot ${order + 1} of ${brief.beats.length}`, `샷 ${order + 1} / ${brief.beats.length}`);
				entries.push(...(await deps.buildShotKeyframePack(shots[index], index, null, job, false)).entries);
			}
			entries.push(...sequencePackFiles(brief, document), ...(extra ? await extra(job) : []));
			await deps.saveExport(new Blob([buildZip(entries)], { type: "application/zip" }), name);
			deps.setToast(ko(`${name} exported · ${entries.length} files`, `${name} 내보내기 완료 · 파일 ${entries.length}개`));
			return { name, files: entries.map((entry) => entry.name) };
		}));
	};
}
