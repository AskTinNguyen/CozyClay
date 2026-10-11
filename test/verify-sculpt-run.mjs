#!/usr/bin/env node
import assert from "node:assert/strict";
import { createAgentPort, createSculptRun } from "../src/sculpt-run.js";

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
	return { bus, agent, now: () => time, sent: () => sent, aborted: () => aborted, events, listening: () => listeners.size };
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
	return { run, sent: f.sent, listening: f.listening };
}, ({ run, sent, listening }) => {
	assert.equal(sent(), 1);
	assert.equal(run.getState().stage, "done");
	assert.equal(listening(), 0, "a finished run leaves no bus listener");
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
	return { run, sent: () => sent, aborted: () => wasAborted, listening: f.listening };
}, ({ run, sent, aborted, listening }) => {
	assert.equal(sent(), 1);
	assert.equal(aborted(), true);
	assert.equal(listening(), 0, "a cancelled run leaves no bus listener");
	assert.equal(run.getState().stage, "cancelled");
});

await runCase("a turn without sculpt retries once then fails", async () => {
	const f = fixture({ turns: [[], []] });
	const run = createSculptRun({ ...f });
	await run.start();
	return { run, sent: f.sent, listening: f.listening };
}, ({ run, sent, listening }) => {
	assert.equal(sent(), 2);
	assert.equal(listening(), 0, "a failed run leaves no bus listener");
	assert.equal(run.getState().stage, "failed");
	assert.match(run.getState().error, /object\.sculpt/);
});

await runCase("the agent port sends UUID session and turn ids the Studio envelope accepts", async () => {
	const requests = [];
	const port = createAgentPort({ turn: async (request) => { requests.push(request); } });
	for await (const _event of port.sendTurn({ text: "one", signal: new AbortController().signal })) { /* drain */ }
	for await (const _event of port.sendTurn({ text: "two", signal: new AbortController().signal })) { /* drain */ }
	return requests;
}, (requests) => {
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	assert.equal(requests.length, 2);
	for (const request of requests) { assert.match(request.sessionId, uuid); assert.match(request.turnId, uuid); assert.equal(request.surface, "studio"); }
	assert.equal(requests[0].sessionId, requests[1].sessionId, "one session per run");
	assert.notEqual(requests[0].turnId, requests[1].turnId);
});

await runCase("a refused turn fails the run with the refusal, without a retry", async () => {
	const f = fixture({ turns: [[{ type: "error", code: "INVALID_SESSION_ID", message: "Studio sessionId must be a UUID." }]] });
	const run = createSculptRun({ ...f });
	await run.start();
	return { run, sent: f.sent };
}, ({ run, sent }) => {
	assert.equal(sent(), 1);
	assert.equal(run.getState().stage, "failed");
	assert.match(run.getState().error, /sessionId must be a UUID/);
});

await runCase("the harness scores a turn the agent left unscored, and tells the agent the exact reference", async () => {
	const f = fixture({ turns: [[sculpt()], [sculpt()]] });
	const texts = [];
	const inner = f.agent.sendTurn;
	f.agent.sendTurn = function (request) { texts.push(request.text); return inner.call(this, request); };
	const scored = [];
	const run = createSculptRun({ ...f, reference: { ...reference, assetId: "asset-snorlax" }, targetIou: 0.9, score: async (args) => { scored.push(args); return { output: { report: { iou: 0.93 }, sheetDataUrl: "data:image/png;base64,s" } }; } });
	await run.start();
	return { run, sent: f.sent, scored, texts };
}, ({ run, sent, scored, texts }) => {
	assert.deepEqual(scored, [{ id: "sculpt-1", reference: { assetId: "asset-snorlax" } }]);
	assert.equal(sent(), 1, "the harness score reached the target, so no continuation");
	assert.equal(run.getState().iou, 0.93);
	assert.equal(run.getState().stage, "done");
	assert.match(texts[0], /do not call sculpt\.compare/);
	assert.match(texts[0], /exactly one of blob, box, cylinder, torus, frame/);
});

await runCase("a continuation carries the harness score, the exact reference and the candidate step", async () => {
	const f = fixture({ turns: [[sculpt()], [sculpt()]] });
	const texts = [];
	const inner = f.agent.sendTurn;
	f.agent.sendTurn = function (request) { texts.push(request.text); return inner.call(this, request); };
	const efforts = [];
	const innerEffort = f.agent.sendTurn;
	f.agent.sendTurn = function (request) { efforts.push(request.effort); return innerEffort.call(this, request); };
	const scores = [0.5, 0.95];
	const run = createSculptRun({ ...f, maxRounds: 2, reference: { ...reference, assetId: "asset-snorlax" }, score: async () => ({ output: { iou: scores.shift(), missingByBand: { top: 0.1 }, extraByPart: [{ id: "arm", fraction: 0.02 }] } }) });
	await run.start();
	return { run, texts, efforts };
}, ({ run, texts, efforts }) => {
	assert.equal(texts.length, 2);
	assert.match(texts[1], /IoU 0\.5/);
	assert.deepEqual(efforts, [undefined, undefined], "turns use the default effort unless draftEffort is set");
	assert.match(texts[1], /"reference": \{"assetId":"asset-snorlax"\}/);
	assert.match(texts[1], /"candidates"/);
	assert.match(texts[1], /missingByBand/);
	assert.equal(run.getState().iou, 0.95);
});

await runCase("the harness does not re-score a turn the agent already scored", async () => {
	const f = fixture({ turns: [[sculpt(), compare(0.95)]] });
	let calls = 0;
	const run = createSculptRun({ ...f, score: async () => { calls += 1; return { report: { iou: 0.1 } }; } });
	await run.start();
	return { run, calls: () => calls };
}, ({ run, calls }) => {
	assert.equal(calls(), 0);
	assert.equal(run.getState().iou, 0.95);
});

await runCase("a candidate score taken before the winning edit does not stop the harness re-scoring", async () => {
	const f = fixture({ turns: [[sculpt()], [compare(0.6), sculpt()]] });
	const scores = [0.6, 0.92];
	let calls = 0;
	const run = createSculptRun({ ...f, maxRounds: 2, score: async () => { calls += 1; return { iou: scores.shift() }; } });
	await run.start();
	return { run, calls: () => calls };
}, ({ run, calls }) => {
	assert.equal(calls(), 2, "round 2's compare came before its object.sculpt, so the harness scores again");
	assert.equal(run.getState().iou, 0.92);
});

await runCase("the harness measurement goes into the first turn", async () => {
	const f = fixture({ turns: [[sculpt(), compare(0.95)]] });
	const texts = [];
	const inner = f.agent.sendTurn;
	f.agent.sendTurn = function (request) { texts.push(request.text); return inner.call(this, request); };
	const measured = [];
	const run = createSculptRun({ ...f, reference: { ...reference, assetId: "asset-snorlax" }, measure: async (ref) => { measured.push(ref); return { widthToHeight: 0.93, rows: [{ y: 0.04, spans: [[0.15, 0.26]] }] }; } });
	await run.start();
	return { texts, measured };
}, ({ texts, measured }) => {
	assert.deepEqual(measured, [{ assetId: "asset-snorlax" }]);
	assert.match(texts[0], /"widthToHeight":0\.93/);
	assert.match(texts[0], /\[0\.15,0\.26\]/);
});

if (process.exitCode) process.exit(1);
