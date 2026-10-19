// The routes of parallel Studio tasks (P2), behind a flag until the panel ships (P3): single mode stays the default.
//   POST /agent/main                      a turn of the main agent (the Studio turn envelope); streams like /agent/turn
//   GET  /agent/main/<sessionId>/board    the tasks of that main session
//   GET  /agent/main/<sessionId>/events   the board's events, live (task.queued .. task.done), and main.turn when the
//                                         main agent reports on its own
//   POST /agent/task/<taskId>/cancel      stop a task (its keys go back)
//   POST /agent/task/<taskId>/steer       { text }: add to a running task
// A task's run is an ordinary Studio turn (handleStudioTurn) in a child session the main session's owner owns, so its
// frames replay on GET /agent/turn/<turnId>/events like any turn's.
import { randomUUID } from "node:crypto";
import { createTaskBoard, taskHeader } from "./studio-tasks.mjs";
import { createMainTools, doneClaimCorrection, mainContextText } from "./main-agent.mjs";
import { MAIN_SYSTEM_PROMPT } from "./main-prompt.mjs";
import { LOST_STUDIO } from "./studio-turn-transaction.mjs";

const TERMINAL = new Set(["task.done", "task.failed", "task.cancelled", "task.paused"]);
const EVENT_TURN_TEXT = "(Task events arrived while the user waited. Tell the user what happened, in their language, in one or two lines.)";
const fakeResponse = () => ({ headersSent: false, writableEnded: false, destroyed: false, setHeader() {}, writeHead() {}, flushHeaders() {}, write: () => true, once() {}, end() { this.writableEnded = true; } });
const ownerRequest = owner => ({ headers: { cookie: `studio_owner=${encodeURIComponent(owner)}` } });

export function createStudioTaskRoutes({ enabled, handleStudioTurn, studioSessions, studioOwnerTokens, emitStudioEvent, writeStudioStream, newRecord, readContext, parseCookies, json, readBody, validateEnvelope, limits, eventTurnDelayMs = 400 }) {
	const mains = new Map();
	const ownerOf = sessionId => studioSessions.get(sessionId)?.owner;

	function mainOf(sessionId) {
		let main = mains.get(sessionId);
		if (main) return main;
		const feedId = `main:${sessionId}`;
		main = { sessionId, feedId, feed: newRecord(), events: [], host: null, model: undefined, effort: undefined, eventTimer: null };
		main.board = createTaskBoard({ limits, run: (task, options) => runTask(main, task, options), emit: event => {
			main.events.push(event);
			emitStudioEvent(feedId, event);
			if (TERMINAL.has(event.type)) eventTurnSoon(main);
		} });
		mains.set(sessionId, main);
		return main;
	}

	// The main agent reports on its own when a task ends and nobody is talking to it.
	function eventTurnSoon(main) {
		if (main.eventTimer) return;
		main.eventTimer = setTimeout(async () => {
			main.eventTimer = null;
			const session = studioSessions.get(main.sessionId);
			if (!session?.owner || !main.host || !main.events.length) return;
			if (session.activeTurnId) return eventTurnSoon(main);
			let context;
			try { context = await readContext(main.host); } catch { return; }
			const turnId = randomUUID();
			emitStudioEvent(main.feedId, { type: "main.turn", turnId });
			await runMain(main, ownerRequest(session.owner), fakeResponse(), { surface: "studio", sessionId: main.sessionId, turnId, text: EVENT_TURN_TEXT, context, model: main.model, effort: main.effort }).catch(() => {});
		}, eventTurnDelayMs);
	}

	function runMain(main, req, res, value) {
		main.host = value.context.host; main.model = value.model; main.effort = value.effort;
		main.board.reconnect(value.context.host.sceneId);
		const userText = value.text;
		return handleStudioTurn(req, res, { ...value, main: {
			systemPrompt: MAIN_SYSTEM_PROMPT,
			tools: ({ studio, hub, admission }) => createMainTools({ board: main.board, studio, hub, admission, workspaceHandle: value.context.host.workspaceHandle }),
			contextText: () => mainContextText(main.board, main.events.splice(0)),
			check: reply => doneClaimCorrection(reply, main.board.board(), userText),
		} }, "/agent/turn");
	}

	async function runTask(main, task, { resume, deps, signal }) {
		const owner = ownerOf(main.sessionId);
		let context;
		try { context = await readContext(main.host); }
		catch (error) { if (LOST_STUDIO.has(error?.code)) return { status: "lost", sceneId: main.host?.sceneId }; throw error; }
		const sessionId = task.sessionId ??= randomUUID();
		if (!studioSessions.has(sessionId)) {
			studioOwnerTokens.set(sessionId, owner);
			studioSessions.set(sessionId, { owner, history: [], persistedItems: 0, meta: null, turns: new Map(), controller: null, host: null, updatedAt: Date.now() });
		}
		const turnId = task.turnId = randomUUID();
		const out = { receipts: [], reply: "", segment: "", error: null, usage: null, lost: false, busy: false };
		const session = () => studioSessions.get(sessionId);
		const stop = () => { session()?.controller?.abort(); void session()?.modelSession?.abort?.("task stop"); };
		signal.addEventListener("abort", stop, { once: true });
		task.steer = text => session()?.modelSession?.steer(text, []);
		const observe = frame => {
			task.onFrame?.(frame);
			if (frame.type === "text.delta") { out.segment += frame.text ?? ""; out.reply = out.segment; }
			else if (frame.type === "tool.start") out.segment = "";
			else if (frame.type === "tool.done" && frame.ok && frame.result?.receiptId) out.receipts.push({ receiptId: frame.result.receiptId, action: frame.result.action ?? frame.name, affectedIds: (frame.result.affectedIds ?? []).slice(0, 6) });
			else if (frame.type === "tool.done" && !frame.ok && LOST_STUDIO.has(String(frame.error ?? "").split(":")[0])) { out.lost = true; stop(); }
			else if (frame.type === "error") { out.error = { code: frame.code, message: frame.message }; if (frame.code === "SCOPE_BUSY") out.busy = true; if (LOST_STUDIO.has(frame.code)) out.lost = true; }
			else if (frame.type === "done" && frame.usage) out.usage = { ...frame.usage, cost: frame.cost ?? 0 };
		};
		try {
			await handleStudioTurn(ownerRequest(owner), fakeResponse(), { surface: "studio", sessionId, turnId, text: taskHeader(task, { deps, resume }), context, model: main.model, effort: main.effort, observe,
				task: { taskId: task.taskId, scope: task.scope, reads: task.reads, title: task.title, parentId: main.sessionId, get lost() { return out.lost; } } }, "/agent/turn");
		} catch (error) {
			if (LOST_STUDIO.has(error?.code)) return { status: "lost", sceneId: context.host.sceneId };
			return { status: "failed", error, usage: out.usage };
		} finally { signal.removeEventListener("abort", stop); task.steer = null; }
		const common = { reply: out.reply, receipts: out.receipts, usage: out.usage };
		if (out.lost) return { status: "lost", sceneId: context.host.sceneId, ...common };
		if (out.busy) return { status: "scopeBusy", error: out.error, ...common };
		if (signal.aborted) return { status: "cancelled", ...common };
		return out.error ? { status: "failed", error: out.error, ...common } : { status: "done", ...common };
	}

	const owned = (req, sessionId) => sessionId && ownerOf(sessionId) && parseCookies(req).studio_owner === ownerOf(sessionId);
	const taskOwner = taskId => [...mains.values()].find(main => main.board.get(taskId));

	return async function route(req, res, path) {
		if (!enabled()) { json(res, 404, { error: "not found" }); return true; }
		if (path === "/agent/main" && req.method === "POST") {
			let value;
			try { value = await validateEnvelope(await readBody(req)); } catch (error) { json(res, 400, { error: error?.toJSON?.() ?? "invalid request" }); return true; }
			const session = studioSessions.get(value.sessionId);
			if (session && parseCookies(req).studio_owner !== session.owner) { json(res, 403, { error: { code: "AUTH_REQUIRED", message: "Studio session owner mismatch." } }); return true; }
			await runMain(mainOf(value.sessionId), req, res, value);
			return true;
		}
		const board = /^\/agent\/main\/([^/]+)\/(board|events)$/.exec(path);
		if (board && req.method === "GET") {
			const sessionId = decodeURIComponent(board[1]), main = mains.get(sessionId);
			if (!main || !owned(req, sessionId)) { json(res, 403, { error: { code: "AUTH_REQUIRED", message: "Not owned by this session." } }); return true; }
			if (board[2] === "board") json(res, 200, { tasks: main.board.board() });
			else writeStudioStream(res, main.feed, Number(new URL(req.url, "http://127.0.0.1").searchParams.get("after") || 0));
			return true;
		}
		const action = /^\/agent\/task\/([^/]+)\/(cancel|steer)$/.exec(path);
		if (action && req.method === "POST") {
			const taskId = decodeURIComponent(action[1]), main = taskOwner(taskId);
			if (!main || !owned(req, main.sessionId)) { json(res, 403, { error: { code: "AUTH_REQUIRED", message: "Not owned by this session." } }); return true; }
			if (action[2] === "cancel") { const view = main.board.cancel(taskId); json(res, view ? 200 : 409, view ?? { error: { code: "STALE_TARGET", message: "The task already ended." } }); return true; }
			const body = await readBody(req).catch(() => null);
			const task = main.board.get(taskId);
			if (typeof body?.text !== "string" || !body.text.trim()) { json(res, 400, { error: "invalid request" }); return true; }
			if (!task.steer) { json(res, 409, { error: { code: "NO_ACTIVE_TURN", message: `The task is ${task.status}.` } }); return true; }
			await task.steer(body.text);
			json(res, 200, { ok: true, queued: true }); return true;
		}
		json(res, 404, { error: "not found" }); return true;
	};
}
