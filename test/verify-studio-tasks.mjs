#!/usr/bin/env node
// Parallel Studio tasks, P2 (the server). The plan's cases that live in the server, by number:
//   (a) the board (bin/agent/studio-tasks.mjs) with a scripted run: 11 at most three run and the rest wait in order,
//       1 a held scope waits, 8 dependsOn waits and hears the summary (a failed dependency fails it), 12 the second
//       start waits for the first model answer or STAGGER, 13 cost per task, 14 a lost Studio pauses and resumes on the
//       same scene (another scene fails it), 16 summaries are capped, 19 the same work is not started twice, 20 a task
//       past its tool or time limit is stopped and reported; cancel of a queued and of a running task;
//   (b) the main agent's words: 15 a reply that calls an unfinished task done is corrected, 17 in the user's language;
//       the task header and the board in the main agent's context;
//   (c) the routes with a scripted model and the real bus (the shipped binding): POST /agent/main answers at once while
//       two tasks edit two objects of one scene in their own scopes, the board ends with both done, the main agent
//       reports on its own when they end, a quick_edit lands inside a one-command task, and the task sessions are kept
//       with their parent's id and left out of the session list;
//   (d) a Studio reload (case 14 with the coordinator's rule): a task paused by a lost Studio resumes when the scope
//       reads as it left it; when it does not (autosave missed the task's newest edit), the task is told to re-read its
//       scope and the main agent hears task.sceneChanged; a task lost mid-command (UNCERTAIN_APPLY) on a changed scope
//       fails with that reason.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createTaskBoard, taskHeader, TASK_LIMITS } from "../bin/agent/studio-tasks.mjs";
import { doneClaimCorrection, mainContextText } from "../bin/agent/main-agent.mjs";

const sessionDir = mkdtempSync(join(tmpdir(), "cozyclay-studio-tasks-"));
process.env.COZYCLAY_AGENT_SESSIONS_DIR = sessionDir;
process.on("exit", () => rmSync(sessionDir, { recursive: true, force: true }));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// --- (a) the board -------------------------------------------------------------------------------------------
function boardFixture(limits = {}) {
	let t = 1000;
	const timers = [], runs = [], events = [];
	const board = createTaskBoard({ limits: { staggerMs: 0, ...limits }, now: () => t, emit: event => events.push(event),
		setTimer: (fn, ms) => { const timer = { fn, at: t + ms }; timers.push(timer); return timer; }, clearTimer: timer => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i, 1); },
		run: (task, options) => { const run = { task, options, ...deferred() }; runs.push(run); return run.promise; } });
	const advance = ms => { t += ms; for (const timer of timers.filter(timer => timer.at <= t)) { timers.splice(timers.indexOf(timer), 1); timer.fn(); } };
	const status = () => Object.fromEntries(board.board().map(task => [task.title, task.status]));
	return { board, runs, events, advance, status, timers };
}
const dispatch = (board, title, scope, extra = {}) => board.dispatch({ title, instructions: `do ${title}`, scope, ...extra });

{
	const { board, runs, status } = boardFixture();
	for (const [title, key] of [["a", "object:a"], ["b", "object:b"], ["c", "object:c"], ["d", "object:d"]]) dispatch(board, title, [key]);
	await tick();
	assert.equal(runs.length, 3, "case 11: three tasks run");
	assert.equal(status().d, "waiting");
	assert.match(board.board().find(task => task.title === "d").reason, /3 tasks are running/);
	runs[0].task.onFrame({ type: "text.delta", text: "x" });
	assert.equal(status().a, "running");
	runs[0].resolve({ status: "done", reply: "a moved", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.25, requests: 2 } });
	await tick(); await tick();
	assert.equal(status().a, "done"); assert.equal(runs.length, 4, "the waiting task starts when one ends"); assert.equal(runs[3].task.title, "d");
	assert.equal(board.board().find(task => task.title === "a").usage.cost, 0.25, "case 13: cost per task");
	console.log("PASS cases 11 and 13: three run at once, the fourth waits in order and starts when one ends; usage and cost per task");
}
{
	const { board, runs, status } = boardFixture();
	dispatch(board, "first", ["object:cube"]); dispatch(board, "second", ["object:cube", "object:sphere"]); dispatch(board, "time", ["timeline"]);
	await tick();
	assert.equal(runs.length, 1);
	assert.match(board.board().find(task => task.title === "second").reason, /object:cube is held by task/, "case 1: a held key waits");
	assert.equal(status().time, "waiting", "the timeline key runs alone");
	runs[0].resolve({ status: "done" }); await tick(); await tick();
	assert.equal(runs.length, 2); assert.equal(runs[1].task.title, "second");
	runs[1].resolve({ status: "scopeBusy", error: { message: "object:sphere is held by task x" } }); await tick(); await tick();
	assert.equal(runs.length, 3, "a begin the bus refused waits and is tried again; the timeline task starts once nothing else runs");
	console.log("PASS case 1: a task whose scope is held waits; timeline runs alone; a bus refusal at begin waits and retries");
}
{
	const { board, runs, status } = boardFixture();
	const a = dispatch(board, "make cup", ["object:cup"]);
	const b = dispatch(board, "grab cup", ["character:alex"], { dependsOn: [a.taskId] });
	await tick();
	assert.equal(runs.length, 1); assert.match(board.board().find(task => task.title === "grab cup").reason, /waits for task/);
	runs[0].resolve({ status: "done", reply: "Cup made: cylinder-3." }); await tick(); await tick();
	assert.equal(runs.length, 2);
	assert.deepEqual(runs[1].options.deps, [{ taskId: a.taskId, title: "make cup", summary: { reply: "Cup made: cylinder-3.", receipts: [] } }], "case 8: it hears the earlier summary");
	assert.match(taskHeader(runs[1].task, { deps: runs[1].options.deps }), /Earlier task .* is done: Cup made: cylinder-3\./);
	const c = dispatch(board, "x", ["object:x"]), d = dispatch(board, "y", ["object:y"], { dependsOn: [c.taskId] });
	await tick();
	runs[2].resolve({ status: "failed", error: { message: "boom" } }); await tick(); await tick();
	assert.equal(status().y, "failed"); assert.match(board.board().find(task => task.taskId === d.taskId).reason, /depends on task .* which failed/);
	assert.equal(b.status, "waiting", "dispatch answers the task as the board sees it");
	console.log("PASS case 8: a dependent task waits, hears the summary of what it depends on, and fails when that failed");
}
{
	const { board, runs, advance } = boardFixture({ staggerMs: 1500 });
	dispatch(board, "a", ["object:a"]); dispatch(board, "b", ["object:b"]); dispatch(board, "c", ["object:c"]);
	await tick();
	assert.equal(runs.length, 1, "case 12: the second start waits for the first model answer");
	runs[0].task.onFrame({ type: "tool.start", callId: "1" }); await tick();
	assert.equal(runs.length, 2, "the first answered: the second starts");
	advance(1499); await tick();
	assert.equal(runs.length, 2);
	advance(1); await tick();
	assert.equal(runs.length, 3, "or STAGGER passed");
	console.log("PASS case 12: a later start waits until the earlier task's model answered or STAGGER ms passed");
}
{
	const { board, runs, status } = boardFixture();
	dispatch(board, "cube", ["object:cube"]); await tick();
	runs[0].resolve({ status: "lost", sceneId: "scene-main" }); await tick(); await tick();
	assert.equal(status().cube, "paused", "case 14: a lost Studio pauses the task");
	board.reconnect("scene-main"); await tick();
	assert.equal(runs.length, 2); assert.match(runs[1].options.resume.note, /Studio reconnected/);
	runs[1].resolve({ status: "lost", sceneId: "scene-main" }); await tick(); await tick();
	board.reconnect("scene-other");
	assert.equal(status().cube, "failed"); assert.match(board.board()[0].reason, /another scene/);
	console.log("PASS case 14: a run whose Studio went away pauses, resumes on the same scene, and fails on another");
}
{
	const { board, runs } = boardFixture();
	dispatch(board, "long", ["object:a"]); await tick();
	runs[0].resolve({ status: "done", reply: "x".repeat(5000), receipts: Array.from({ length: 20 }, (_, i) => ({ receiptId: `r${i}` })) }); await tick(); await tick();
	const [task] = board.board();
	assert.equal(task.summary.reply.length, TASK_LIMITS.summaryChars, "case 16: the summary is capped");
	assert.equal(task.summary.receipts.length, TASK_LIMITS.receipts); assert.equal(task.summary.receipts.at(-1).receiptId, "r19");
	const text = mainContextText(board, [{ type: "task.done", taskId: task.taskId }]);
	assert.ok(text.length < TASK_LIMITS.summaryChars + 1500, "the board in the main context stays small");
	assert.match(text, /<task-board>.*<\/task-board>\n<task-events>/s);
	console.log("PASS case 16: a task's summary is capped and the board the main agent reads stays small");
}
{
	const { board, runs } = boardFixture();
	const first = board.dispatch({ title: "Move cube", instructions: "Move the cube   1 m left", scope: ["object:cube"] });
	const again = board.dispatch({ title: "move it", instructions: "move the cube 1 m left", scope: ["object:cube"] });
	assert.equal(again.duplicateOf, first.taskId, "case 19: the same work is not started twice");
	await tick(); assert.equal(runs.length, 1);
	assert.throws(() => board.dispatch({ title: "bad", instructions: "x", scope: ["chair"] }), /scope/);
	assert.throws(() => board.dispatch({ title: "bad", instructions: "x", scope: ["object:a"], dependsOn: ["nope"] }), /dependsOn/);
	console.log("PASS case 19: equal instructions on an equal scope answer the running task; bad scopes and dependencies are refused");
}
{
	const { board, runs, status, advance } = boardFixture({ maxTools: 2, maxMs: 60_000 });
	dispatch(board, "busy", ["object:a"]); dispatch(board, "slow", ["object:b"]); await tick();
	for (let i = 0; i < 3; i++) runs[0].task.onFrame({ type: "tool.start" });
	assert.ok(runs[0].options.signal.aborted, "case 20: past the tool limit the run is stopped");
	runs[0].resolve({ status: "cancelled" }); await tick(); await tick();
	assert.equal(status().busy, "failed"); assert.match(board.board()[0].reason, /more than 2 tool calls; ask the user whether to continue/);
	advance(60_000);
	assert.ok(runs[1].options.signal.aborted, "and past the time limit");
	runs[1].resolve({ status: "cancelled" }); await tick(); await tick();
	assert.match(board.board()[1].reason, /ran past 1 minutes/);
	console.log("PASS case 20: a task past its tool-call or time limit is stopped and reported as such");
}
{
	const { board, runs, status } = boardFixture({ cap: 1 });
	const a = dispatch(board, "a", ["object:a"]), b = dispatch(board, "b", ["object:b"]); await tick();
	assert.equal(board.cancel(b.taskId).status, "cancelled", "a queued task is cancelled at once");
	board.cancel(a.taskId);
	assert.ok(runs[0].options.signal.aborted, "a running one is stopped");
	runs[0].resolve({ status: "cancelled" }); await tick(); await tick();
	assert.equal(status().a, "cancelled"); assert.equal(board.cancel(a.taskId), null);
	console.log("PASS cancel: a queued task ends at once, a running one stops and ends cancelled");
}
{
	// A cancel that reaches a run which already finished on the bus (task.finish) cannot take it back: the card says done.
	const { board, runs, status } = boardFixture();
	const a = dispatch(board, "a", ["object:a"]); await tick();
	board.cancel(a.taskId);
	runs[0].resolve({ status: "done", reply: "a moved" }); await tick(); await tick();
	assert.equal(status().a, "done");
	console.log("PASS a cancel that arrives after the run finished leaves it done, not cancelled");
}

// --- (b) the main agent's words ----------------------------------------------------------------------------
{
	const tasks = [{ taskId: "t-1", title: "컵 잡기", status: "running" }, { taskId: "t-2", title: "Lighting", status: "done" }];
	assert.match(doneClaimCorrection("컵 잡기 작업을 완료했습니다.", tasks, "컵 잡게 해"), /정정: "컵 잡기" 작업은 아직 끝나지 않았습니다. 지금 진행 중입니다/, "case 15 + 17: corrected in Korean");
	assert.match(doneClaimCorrection("The 컵 잡기 task is done.", tasks, "have her grab the cup"), /Correction: task "컵 잡기" has not finished; it is running/);
	assert.equal(doneClaimCorrection("Lighting is done. 컵 잡기 is still running.", tasks, "x"), null, "a true claim, and a running task called running, pass");
	assert.equal(doneClaimCorrection("I started t-1.", tasks, "x"), null);
	console.log("PASS cases 15 and 17: a reply calling an unfinished task done is corrected, in the user's language");
}

// --- (c) the routes, a scripted model and the real bus ---------------------------------------------------------
const { objectsFixture } = await import("./bus/objects-fixture.mjs");
const { dispatchLiveFrame } = await import("../src/live-control.js");
const { createFakeModel } = await import("./fixtures/fake-model.mjs");
const { createAgentHandler } = await import("../bin/agent/agent-routes.mjs");
const { MAIN_SYSTEM_PROMPT } = await import("../bin/agent/main-prompt.mjs");
{
	const f = objectsFixture(), id = kind => f.store.current.objects.find(o => o.renderer === kind || o.id === kind).id;
	const ids = { cube: id("cube"), sphere: id("sphere"), chair: id("chair") }, x = objectId => f.store.current.objects.find(o => o.id === objectId)?.x;
	const read = () => { const context = f.binding.handlers.read_studio_context({ host: f.host() }); return { ...context, host: { ...context.host, workspaceHandle: "handle-1" } }; };
	const commands = [];
	const hub = {
		async command(name, payload) {
			commands.push({ name, taskId: payload.taskId, action: payload.args?.action });
			const response = await dispatchLiveFrame(JSON.stringify({ type: "cmd", id: randomUUID(), name, args: payload }), f.binding.handlers);
			if (!response.ok) throw Object.assign(new Error(response.error), { code: String(response.error).split(":")[0] });
			return response.value;
		},
		workspaceId: () => f.host().workspaceId, resolveWorkspace: () => "handle-1", connected: true, workspaceHandles: ["handle-1"],
	};
	const fakeModel = createFakeModel();
	const said = (context, text) => JSON.stringify(context.messages).includes(text);
	const toolResults = context => context.messages.filter(message => message.role === "toolResult").length;
	let mainTurns = 0;
	const step = async context => {
		if (context.systemPrompt === MAIN_SYSTEM_PROMPT) {
			const last = context.messages.at(-1);
			if (last.role === "user" && said({ messages: [last] }, "Task events arrived")) { mainTurns++; return fauxAssistantMessage([fauxText("두 작업이 모두 끝났어요.")]); }
			if (last.role === "user") return fauxAssistantMessage([
				fauxToolCall("dispatch_task", { title: "cube", instructions: `Move ${ids.cube} to x 1.`, scope: [`object:${ids.cube}`] }, { id: `m-${randomUUID()}` }),
				fauxToolCall("dispatch_task", { title: "sphere", instructions: `Move ${ids.sphere} to x 2.`, scope: [`object:${ids.sphere}`] }, { id: `m-${randomUUID()}` }),
				fauxToolCall("quick_edit", { scope: [`object:${ids.chair}`], tool: "run_action", args: { action: "object.set", args: { id: ids.chair, set: { position: { x: 3, y: 0, z: 0 } } } } }, { id: `m-${randomUUID()}` }),
			]);
			return fauxAssistantMessage([fauxText("큐브와 구를 옮기는 작업 두 개를 시작했고, 의자는 바로 옮겼어요.")]);
		}
		const target = said(context, `Move ${ids.cube}`) ? ids.cube : ids.sphere, to = target === ids.cube ? 1 : 2;
		if (toolResults(context) === 0) return fauxAssistantMessage([fauxToolCall("run_action", { action: "object.set", args: { id: target, set: { position: { x: to, y: 0, z: 0 } } } }, { id: `t-${randomUUID()}` })]);
		return fauxAssistantMessage([fauxText(`Moved ${target} to x ${to}. QA: none.`)]);
	};
	fakeModel.fauxProvider.setResponses(Array.from({ length: 40 }, () => step));
	let server;
	const handler = createAgentHandler({ auth: { getAccessToken: async () => "token" }, codex: { parseQuotaHeaders: () => ({ primary: {}, credits: {} }) }, models: fakeModel.models, fauxProvider: fakeModel.fauxProvider,
		liveHub: hub, studioRuntime: { readContext: async () => read() }, supervisor: false, studioTasks: () => true, taskLimits: { staggerMs: 0 }, port: () => server.address().port });
	server = createServer((req, res) => handler(req, res).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(error.stack); }));
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	const origin = `http://127.0.0.1:${server.address().port}`, sessionId = randomUUID();
	const response = await fetch(`${origin}/agent/main`, { method: "POST", headers: { "content-type": "application/json", origin },
		body: JSON.stringify({ surface: "studio", sessionId, turnId: randomUUID(), text: "큐브는 x 1, 구는 x 2로 옮기고 의자는 x 3으로", context: read(), model: "faux/scripted" }) });
	const cookie = response.headers.get("set-cookie").split(";")[0];
	const frames = [...(await response.text()).matchAll(/^data: (.+)$/gm)].map(match => JSON.parse(match[1]));
	assert.equal(frames.at(-1).type, "done", "the main turn ends");
	assert.ok(frames.filter(frame => frame.type === "tool.done" && frame.name === "dispatch_task").every(frame => frame.ok), "two tasks dispatched");
	assert.equal(x(ids.chair), 3, "quick_edit moved the chair inside a one-command task");
	const quick = commands.filter(command => command.action === "task.begin" || command.action === "task.finish");
	assert.ok(quick.length >= 2, "quick_edit opened and finished a task");
	const get = path => fetch(`${origin}${path}`, { headers: { origin, cookie } });
	let board;
	for (let i = 0; i < 200; i++) { board = (await (await get(`/agent/main/${sessionId}/board`)).json()).tasks; if (board.every(task => task.status === "done")) break; await new Promise(r => setTimeout(r, 25)); }
	assert.deepEqual(board.map(task => task.status), ["done", "done"], JSON.stringify(board));
	assert.equal(x(ids.cube), 1); assert.equal(x(ids.sphere), 2);
	assert.ok(board.every(task => task.summary.reply.startsWith("Moved")), "each task's report is its summary");
	const taskCommands = commands.filter(command => command.name === "run_action" && command.action === "object.set" && command.taskId);
	assert.equal(new Set(taskCommands.map(command => command.taskId)).size, 3, "each object.set ran inside its own task (two tasks and the quick edit)");
	assert.equal((await get(`/agent/main/${sessionId}/board`)).status, 200);
	assert.equal((await fetch(`${origin}/agent/main/${sessionId}/board`, { headers: { origin, cookie: "studio_owner=intruder" } })).status, 403, "another owner reads nothing");
	for (let i = 0; i < 200 && !mainTurns; i++) await new Promise(r => setTimeout(r, 25));
	assert.equal(mainTurns, 1, "the main agent reported once on its own when the tasks ended");
	const turnReplay = await (await get(`/agent/turn/${encodeURIComponent(board[0].turnId)}/events?after=0`)).text();
	assert.match(turnReplay, /"type":"done"/, "a task's frames replay on its turn like any turn's");
	const metas = readdirSync(sessionDir).filter(name => name.endsWith(".meta.json")).map(name => JSON.parse(readFileSync(join(sessionDir, name), "utf8")));
	assert.equal(metas.filter(meta => meta.parentId === sessionId).length, 2, "task sessions keep their parent's id");
	const listed = (await (await get("/agent/sessions?surface=studio")).json()).sessions;
	assert.ok(listed.every(meta => !meta.parentId) && listed.some(meta => meta.sessionId === sessionId), "the session list shows the main session, not its tasks");
	const disabled = createAgentHandler({ auth: { getAccessToken: async () => "token" }, liveHub: hub, studioTasks: () => false });
	const res = { statusCode: 0, writeHead(code) { this.statusCode = code; }, setHeader() {}, end() {} };
	await disabled({ method: "POST", url: "/agent/main", headers: {} }, res, "/agent/main");
	assert.equal(res.statusCode, 404, "the flag is off by default: single mode stays");
	// The panel's Tasks switch opts one session in without the flag: its main turn carries x-cozyclay-tasks: on.
	const optIn = Object.assign(Readable.from([Buffer.from("{}")]), { method: "POST", url: "/agent/main", headers: { "x-cozyclay-tasks": "on", "content-type": "application/json" } });
	const answered = { statusCode: 0, writeHead(code) { this.statusCode = code; }, setHeader() {}, end() {} };
	await disabled(optIn, answered, "/agent/main");
	assert.equal(answered.statusCode, 400, "an opted-in main turn reaches the main agent's route (here refused for its empty envelope), not a 404");
	await handler.close?.(); await new Promise(resolve => server.close(resolve)); f.dispose();
	console.log("PASS the routes: the main agent answers at once, two tasks edit two objects of one scene in their own scopes, a quick edit lands, the main agent reports when they end, task sessions keep their parent");
}

// --- (d) a Studio reload while a task runs -----------------------------------------------------------------------
async function reloadScenario({ lostWith, reloadKeeps }) {
	let cur = objectsFixture(), down = false;
	const cube = cur.store.current.objects.find(o => o.renderer === "cube").id;
	const read = () => { if (down) throw Object.assign(new Error("LIVE_HUB_UNAVAILABLE: no editor"), { code: "LIVE_HUB_UNAVAILABLE" }); const context = cur.binding.handlers.read_studio_context({ host: cur.host() }); return { ...context, host: { ...context.host, workspaceHandle: "handle-1" } }; };
	const hub = {
		async command(name, payload) {
			if (down) throw Object.assign(new Error(`${lostWith}: Live editor disconnected while a command was running.`), { code: lostWith });
			const response = await dispatchLiveFrame(JSON.stringify({ type: "cmd", id: randomUUID(), name, args: payload }), cur.binding.handlers);
			if (!response.ok) throw Object.assign(new Error(response.error), { code: String(response.error).split(":")[0] });
			return response.value;
		},
		workspaceId: () => cur.host().workspaceId, resolveWorkspace: () => "handle-1", connected: true, workspaceHandles: ["handle-1"],
	};
	const notes = [], fakeModel = createFakeModel();
	const lastUser = context => JSON.stringify([...context.messages].reverse().find(message => message.role === "user") ?? {});
	const step = async context => {
		if (context.systemPrompt === MAIN_SYSTEM_PROMPT) {
			const last = context.messages.at(-1);
			if (last.role === "user" && lastUser(context).includes("Move the cube")) return fauxAssistantMessage([fauxToolCall("dispatch_task", { title: "cube", instructions: `Move ${cube} to x 1, then to x 2.`, scope: [`object:${cube}`] }, { id: `m-${randomUUID()}` })]);
			return fauxAssistantMessage([fauxText("알겠어요.")]);
		}
		const user = lastUser(context);
		if (/reads as you left it|scene changed while the Studio reloaded/.test(user) && context.messages.at(-1).role === "user") { notes.push(user.includes("scene changed") ? "changed" : "same"); return fauxAssistantMessage([fauxText("Resumed and finished.")]); }
		const results = context.messages.filter(message => message.role === "toolResult").length;
		if (results === 0) return fauxAssistantMessage([fauxToolCall("run_action", { action: "object.set", args: { id: cube, set: { position: { x: 1, y: 0, z: 0 } } } }, { id: `t-${randomUUID()}` })]);
		if (results === 1) { await new Promise(r => setTimeout(r, 60)); down = true; return fauxAssistantMessage([fauxToolCall("run_action", { action: "object.set", args: { id: cube, set: { position: { x: 2, y: 0, z: 0 } } } }, { id: `t-${randomUUID()}` })]); }
		return fauxAssistantMessage([fauxText("Moved.")]);
	};
	fakeModel.fauxProvider.setResponses(Array.from({ length: 30 }, () => step));
	let server;
	const handler = createAgentHandler({ auth: { getAccessToken: async () => "token" }, codex: { parseQuotaHeaders: () => ({ primary: {}, credits: {} }) }, models: fakeModel.models, fauxProvider: fakeModel.fauxProvider,
		liveHub: hub, studioRuntime: { readContext: async () => read() }, supervisor: false, studioTasks: () => true, taskLimits: { staggerMs: 0 }, port: () => server.address().port });
	server = createServer((req, res) => handler(req, res).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(error.stack); }));
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	const origin = `http://127.0.0.1:${server.address().port}`, sessionId = randomUUID();
	const post = async (text, cookie) => fetch(`${origin}/agent/main`, { method: "POST", headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
		body: JSON.stringify({ surface: "studio", sessionId, turnId: randomUUID(), text, context: read(), model: "faux/scripted" }) });
	const first = await post("Move the cube");
	const cookie = first.headers.get("set-cookie").split(";")[0]; await first.text();
	const board = async () => (await (await fetch(`${origin}/agent/main/${sessionId}/board`, { headers: { origin, cookie } })).json()).tasks[0];
	const until = async want => { let task; for (let i = 0; i < 300; i++) { task = await board(); if (want.includes(task.status)) return task; await new Promise(r => setTimeout(r, 20)); } return task; };
	const paused = await until(["paused", "failed"]);
	assert.equal(paused.status, "paused", JSON.stringify(paused));
	// The reload: a new editor on the same scene, from what autosave kept.
	const kept = structuredClone(cur.store.current.objects).map(o => (o.id === cube && !reloadKeeps ? { ...o, x: 0 } : o));
	cur.dispose(); cur = objectsFixture(kept); down = false;
	await (await post("다시 연결됐어", cookie)).text();
	const ended = await until(["done", "failed"]);
	// The board's feed replays every event from the start; read what arrives in a short window.
	const reader = (await fetch(`${origin}/agent/main/${sessionId}/events?after=0`, { headers: { origin, cookie } })).body.getReader();
	let events = "";
	const stopAt = Date.now() + 300;
	while (Date.now() < stopAt) { const chunk = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r(null), stopAt - Date.now()))]); if (!chunk || chunk.done) break; events += new TextDecoder().decode(chunk.value); }
	await reader.cancel();
	await handler.close?.(); await new Promise(resolve => server.close(resolve)); cur.dispose();
	return { ended, notes, events };
}
{
	const same = await reloadScenario({ lostWith: "LIVE_HUB_UNAVAILABLE", reloadKeeps: true });
	assert.equal(same.ended.status, "done", JSON.stringify(same.ended));
	assert.deepEqual(same.notes, ["same"], "the scope reads as the task left it: it resumes");
	assert.ok(!same.events.includes("task.sceneChanged"));
	const changed = await reloadScenario({ lostWith: "LIVE_HUB_UNAVAILABLE", reloadKeeps: false });
	assert.equal(changed.ended.status, "done");
	assert.deepEqual(changed.notes, ["changed"], "autosave missed its edit: the task is told to re-read its scope");
	assert.match(changed.events, /"type":"task.sceneChanged".*"keys":\["object:cube"\]/s, "the main agent hears it");
	const mid = await reloadScenario({ lostWith: "UNCERTAIN_APPLY", reloadKeeps: false });
	assert.equal(mid.ended.status, "failed");
	assert.match(mid.ended.reason, /scene changed while the Studio reloaded .* mid-command/);
	assert.deepEqual(mid.notes, [], "a task lost mid-command on a changed scope does not resume blind");
	console.log("PASS case 14 after a reload: a paused task resumes when its scope reads as it left it, re-reads when it changed (and the main agent hears it), and fails when it was mid-command");
}
process.exit(0);
