#!/usr/bin/env node
import assert from "node:assert/strict";
import { createSculptRun } from "../src/sculpt-run.js";

const reference = { dataUrl: "data:image/png;base64,AA==", name: "reference.png" };
function fixture({ turns, clockStep = 1 } = {}) {
	let time = 0;
	const events = [];
	const listeners = new Set();
	let sent = 0;
	let aborted = 0;
	const bus = { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
	const agent = {
		async *sendTurn({ signal }) {
			const script = turns[Math.min(sent++, turns.length - 1)] ?? [];
			for (const event of script) {
				if (signal.aborted) { aborted += 1; return; }
				if (event.bus) for (const listener of listeners) listener(event.bus);
				yield event.stream ?? event;
			}
			time += clockStep;
		},
	};
	return { bus, agent, now: () => time, sent: () => sent, aborted: () => aborted, events };
}
const sculpt = (id = "sculpt-1") => ({ bus: { action: "object.sculpt", args: { id }, result: { affectedIds: [id] } } });
const compare = (iou, sheetDataUrl = `data:image/png;base64,sheet-${iou}`) => ({ bus: { action: "sculpt.compare", args: { id: "sculpt-1" }, result: { report: { iou }, sheetDataUrl } } });

async function runCase(name, setup, check) {
	try { await check(await setup()); console.log(`PASS ${name}`); }
	catch (error) { console.log(`FAIL ${name} - ${error.stack?.split("\n").slice(0, 3).join(" | ") ?? error.message}`); process.exitCode = 1; }
}

await runCase("measured loop reports draft, score, refine, score, done", async () => {
	const f = fixture({ turns: [[sculpt(), compare(0.5)], [sculpt(), compare(0.94)]] });
	const run = createSculptRun({ ...f, maxRounds: 2, targetIou: 0.95 });
	const stages = []; run.subscribe(state => stages.push(state.stage));
	await run.start();
	return { run, stages };
}, ({ run, stages }) => {
	assert.deepEqual(stages.filter((stage, index) => stage !== stages[index - 1]), ["measure", "draft", "score", "refine", "score", "done"], stages.join(" -> "));
	assert.equal(run.getState().iou, 0.94);
});

await runCase("target IoU stops after the first turn", async () => {
	const f = fixture({ turns: [[sculpt(), compare(0.95)], [sculpt(), compare(0.1)]] });
	const run = createSculptRun({ ...f, targetIou: 0.9 });
	await run.start();
	return { run, sent: f.sent };
}, ({ run, sent }) => {
	assert.equal(sent(), 1);
	assert.equal(run.getState().stage, "done");
});

await runCase("continuations are capped at maxRounds", async () => {
	const f = fixture({ turns: [[sculpt(), compare(0.1)], [sculpt(), compare(0.2)], [sculpt(), compare(0.3)], [sculpt(), compare(0.4)]] });
	const run = createSculptRun({ ...f, maxRounds: 3, targetIou: 0.99 });
	await run.start();
	return { run, sent: f.sent };
}, ({ run, sent }) => {
	assert.equal(sent(), 3);
	assert.equal(run.getState().round, 3);
	assert.equal(run.getState().stage, "done");
});

await runCase("time budget ends the loop", async () => {
	const f = fixture({ turns: [[sculpt(), compare(0.1)], [sculpt(), compare(0.2)]], clockStep: 10 });
	const run = createSculptRun({ ...f, maxRounds: 3, timeBudgetMs: 10, targetIou: 0.99 });
	await run.start();
	return { run, sent: f.sent };
}, ({ run, sent }) => {
	assert.equal(sent(), 1);
	assert.equal(run.getState().stage, "done");
});

await runCase("cancel aborts the turn and sends nothing after", async () => {
	const f = fixture({ turns: [[sculpt()]] });
	let wasAborted = false;
	let sent = 0;
	f.agent.sendTurn = async function* ({ signal }) {
		sent += 1;
		signal.addEventListener("abort", () => { wasAborted = true; }, { once: true });
		await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
	};
	const run = createSculptRun({ ...f });
	const pending = run.start();
	run.cancel();
	await pending;
	return { run, sent: () => sent, aborted: () => wasAborted };
}, ({ run, sent, aborted }) => {
	assert.equal(sent(), 1);
	assert.equal(aborted(), true);
	assert.equal(run.getState().stage, "cancelled");
});

await runCase("a turn without sculpt retries once then fails", async () => {
	const f = fixture({ turns: [[], []] });
	const run = createSculptRun({ ...f });
	await run.start();
	return { run, sent: f.sent };
}, ({ run, sent }) => {
	assert.equal(sent(), 2);
	assert.equal(run.getState().stage, "failed");
	assert.match(run.getState().error, /object\.sculpt/);
});

if (process.exitCode) process.exit(1);
