// Story beats from the cast's motion, read from what the deterministic motion
// compiler reports about an installed take (docs/motion-api-v3.1.md C4, C13),
// never from the frozen files themselves:
//   walk      the timeline's walkTo / walk spans: the first foot that lifts and
//             the frame both feet are down for good (its planted runs)
//   reach     a reachGrip span's start; grab and release are its events
//   turn      a run of frames where the body's heading turns 30 degrees or more
//             (the hips' yaw, per frame)
//   jump      the observations' air runs: take-off and landing
// Frames are take frames placed on the timeline (the take's frame + where it starts); beatsIn maps
// them through a shot's speed to the frame the shot plays them at. Pure.

import { retimeFrame, timelineFrame } from "../camera-capabilities/speed.js";

const TURN_RATE = 1.2, TURN_MIN = 30, AIR_MIN = 2;
const WALKS = new Set(["walkTo", "walk"]);

/** Runs of frames where |yaw change| per frame passes TURN_RATE degrees, joined across gaps of 2, kept when they turn TURN_MIN or more. */
function turnRuns(yaw) {
	const runs = [];
	let run = null;
	for (let f = 1; f < (yaw?.length ?? 0); f++) {
		const step = ((yaw[f] - yaw[f - 1] + 540) % 360) - 180;
		if (Math.abs(step) >= TURN_RATE) {
			if (run && f - run.end <= 3) run.end = f;
			else runs.push(run = { start: f - 1, end: f });
		}
	}
	return runs.map((row) => ({ ...row, turn: ((yaw[row.end] - yaw[row.start] + 540) % 360) - 180 })).filter((row) => Math.abs(row.turn) >= TURN_MIN);
}

function walkFrames(entry) {
	const runs = Object.values(entry.planted ?? {}).filter((list) => Array.isArray(list) && list.length);
	if (!runs.length) return entry.f;
	// The walk starts when the first planted foot leaves the ground and ends when the last one lands to stay.
	const lift = Math.min(...runs.map((list) => (list[0][0] <= entry.f[0] + 1 ? list[0][1] + 1 : entry.f[0])));
	const settle = Math.max(...runs.map((list) => list.at(-1)[0]));
	return [lift, Math.max(lift, settle)];
}

/**
 * @param {{ characterId:string, name:string, startFrame?:number, timeline?:Array, observations?:object, objects?:object, yaw?:number[] }} take
 * @returns {Array<{ characterId, name, frame:number, kind:string, words:string }>} ordered by frame
 */
export function motionBeats(take) {
	const at = (frame) => frame + (take.startFrame ?? 0), who = take.name || take.characterId, beats = [];
	const add = (frame, kind, words) => beats.push({ characterId: take.characterId, name: who, frame: at(frame), kind, words: `${who} ${words}` });
	const grabbed = new Set();
	for (const entry of take.timeline ?? []) {
		if (WALKS.has(entry.beat) && Array.isArray(entry.f)) {
			const [lift, settle] = walkFrames(entry);
			add(lift, "walk-start", "starts walking");
			add(settle, "walk-end", "stops walking");
		}
		if (entry.beat === "reachGrip" && Array.isArray(entry.f)) add(entry.f[0], "reach", "reaches out");
		for (const event of entry.events ?? []) {
			if (event.event !== "grab" && event.event !== "release") continue;
			grabbed.add(`${event.event} ${event.object}`);
			add(event.f, event.event, event.event === "grab" ? `grabs ${event.object}` : `lets go of ${event.object}`);
		}
	}
	for (const [id, object] of Object.entries(take.objects ?? {})) {
		for (const event of ["grab", "release"]) if (Number.isFinite(object?.[event]) && object[event] > 0 && !grabbed.has(`${event} ${id}`)) add(object[event], event, event === "grab" ? `grabs ${id}` : `lets go of ${id}`);
	}
	for (const run of turnRuns(take.yaw)) add(run.start, "turn", `turns ${Math.round(Math.abs(run.turn))}° to ${run.turn > 0 ? "the left" : "the right"} (until f${at(run.end)})`);
	for (const [up, down] of take.observations?.balance?.air ?? []) {
		if (down - up + 1 < AIR_MIN) continue;
		add(up, "jump", "leaves the ground");
		add(down + 1, "land", "lands");
	}
	return beats.sort((a, b) => a.frame - b.frame || a.kind.localeCompare(b.kind));
}

/**
 * The beats a shot plays, at the timeline frame it plays each one: a shot with a speed shows take frames
 * retimeFrame(start) up to retimeFrame(end + 1) (slow motion fewer, a fast shot more), so a beat's take
 * frame maps back through timelineFrame. Answers copies with `frame` (timeline) and `takeFrame`.
 */
export function beatsIn(beats, shot) {
	const from = retimeFrame(shot, shot.startFrame), until = retimeFrame(shot, shot.endFrame + 1);
	return beats.filter((beat) => beat.frame >= from && beat.frame < until)
		.map((beat) => ({ ...beat, takeFrame: beat.frame, frame: Math.min(shot.endFrame, Math.round(timelineFrame(shot, beat.frame))) }));
}
