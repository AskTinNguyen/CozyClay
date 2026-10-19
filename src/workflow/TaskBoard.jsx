// The task board under the main agent's chat in task mode (task-board.js): one card per task with its state, scope,
// live progress, cost, and cancel / undo task / add instruction; a card opens its own frame stream. It also marks the
// outliner rows inside a running task's scope, and carries the main agent's own reports (main.turn) into the chat.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { compileActivity, watchCompileActivity } from "../commands/motion3-compile.js";
import { ACTIVE_STATUSES, TASK_STATUS_COPY, compileState, costLabel, createTaskBoardClient, emptyBoard, progressLine, reduceBoard, reduceScopes, seedBoard } from "./task-board.js";
import "./task-board.css";

const RETRY_MS = 2000;
const sleep = (ms, signal) => new Promise(resolve => { const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });

function TaskFrames({ client, turnId, labelOf }) {
	const [lines, setLines] = useState([]);
	useEffect(() => {
		if (!turnId) return undefined;
		const controller = new AbortController();
		let reply = "";
		client.frames(turnId, frame => {
			if (frame.type === "text.delta") { reply += frame.text ?? ""; setLines(list => [...list.filter(line => line.kind !== "reply"), { kind: "reply", text: reply }]); return; }
			const label = frame.type === "tool.done" ? null : progressLine(frame, labelOf);
			if (frame.type === "tool.start") reply = "";
			if (label) setLines(list => [...list.filter(line => line.kind !== "reply"), ...(reply ? [{ kind: "said", text: reply }] : []), { kind: frame.type === "error" ? "error" : "tool", text: label }].slice(-40));
		}, controller.signal).catch(() => {});
		return () => controller.abort();
	}, [client, turnId, labelOf]);
	if (!lines.length) return <p className="task-frames-empty">{ko("No steps yet.", "아직 단계가 없어요.")}</p>;
	return <ol className="task-frames">{lines.map((line, index) => <li key={index} data-kind={line.kind}>{line.text}</li>)}</ol>;
}

function TaskCard({ task, compile, client, labelOf, onUndo }) {
	const [open, setOpen] = useState(false);
	const [steering, setSteering] = useState("");
	const [notice, setNotice] = useState("");
	const active = ACTIVE_STATUSES.has(task.status);
	const act = async (run, done) => { setNotice(""); try { await run(); if (done) setNotice(done); } catch (error) { setNotice(String(error?.message ?? error)); } };
	const waitingCompile = compile.waiting > 0 && task.status === "running";
	return <div className="task-card" data-status={task.status} data-task-id={task.taskId}>
		<button type="button" className="task-card-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
			<span className="task-card-title">{task.title}</span>
			<span className="task-card-status">{TASK_STATUS_COPY[task.status] ?? task.status}</span>
		</button>
		<div className="task-card-scope">{(task.scope ?? []).map(key => <span key={key} className="task-scope-chip">{key}</span>)}</div>
		{task.status === "running" && <p className="task-card-progress">{waitingCompile ? ko("Compile waiting for a free worker", "compile 대기 중 (작업자 비는 중)") : task.progress || ko("Working…", "작업 중…")}</p>}
		{task.reason && task.status !== "done" && <p className="task-card-reason">{task.reason}</p>}
		{task.notes?.map((text, index) => <p key={index} className="task-card-note">{text}</p>)}
		{task.summary?.reply && !active && <p className="task-card-summary">{task.summary.reply}</p>}
		<div className="task-card-foot">
			<span className="task-card-cost">{costLabel(task.usage)}</span>
			{active && <button type="button" className="agent-ghost-button" onClick={() => act(() => client.cancel(task.taskId), ko("Cancelled; its changes go back.", "취소함: 바뀐 것은 되돌아가요."))}>{ko("Cancel", "취소")}</button>}
			{task.status === "done" && !task.undone && <button type="button" className="agent-ghost-button" onClick={() => act(() => onUndo(task.taskId), ko("Undone.", "되돌림."))}>{ko("Undo task", "작업 되돌리기")}</button>}
		</div>
		{task.status === "running" && <form className="task-card-steer" onSubmit={event => { event.preventDefault(); const text = steering.trim(); if (text) act(() => client.steer(task.taskId, text), ko("Sent to the task.", "작업에 전달함.")).then(() => setSteering("")); }}>
			<input id={`task-steer-${task.taskId}`} value={steering} onChange={event => setSteering(event.target.value)} placeholder={ko("Add an instruction…", "지시 추가…")} aria-label={ko("Add an instruction", "지시 추가")} />
		</form>}
		{notice && <p className="task-card-notice" role="status">{notice}</p>}
		{open && <TaskFrames key={task.turnId} client={client} turnId={task.turnId} labelOf={labelOf} />}
	</div>;
}

/** Marks outliner rows (data-node-id is the scope key: object:<id>, character:<id>) inside running tasks' scopes. */
function useScopeBadges(scopes, titles) {
	useEffect(() => {
		const owner = new Map();
		for (const [taskId, keys] of Object.entries(scopes)) for (const key of keys) owner.set(key, titles[taskId] ?? taskId);
		const paint = () => {
			for (const row of document.querySelectorAll("[data-node-id]")) {
				const title = owner.get(row.getAttribute("data-node-id"));
				if (title) { row.setAttribute("data-task-scope", title); row.setAttribute("title", ko(`In task: ${title}`, `작업 중: ${title}`)); }
				else if (row.hasAttribute("data-task-scope")) { row.removeAttribute("data-task-scope"); row.removeAttribute("title"); }
			}
		};
		paint();
		const observer = new MutationObserver(paint);
		observer.observe(document.body, { childList: true, subtree: true });
		return () => { observer.disconnect(); owner.clear(); paint(); };
	}, [scopes, titles]);
}

export default function TaskBoard({ sessionId, pulse, labelOf, onMainNote }) {
	const client = useMemo(() => createTaskBoardClient(), []);
	const bus = useBus();
	const [board, dispatch] = useReducer((state, action) => (action.seed ? seedBoard(state, action.seed) : action.reset ? emptyBoard() : reduceBoard(state, action.event)), undefined, emptyBoard);
	const [scopes, setScopes] = useState({});
	const [activity, setActivity] = useState(compileActivity);
	const afterRef = useRef(0);
	const noteRef = useRef(onMainNote);
	useEffect(() => { afterRef.current = board.after; noteRef.current = onMainNote; }, [board.after, onMainNote]);

	useEffect(() => { dispatch({ reset: true }); afterRef.current = 0; }, [sessionId]);
	useEffect(() => watchCompileActivity(setActivity), []);
	useEffect(() => bus.subscribe(event => {
		if (typeof event?.type !== "string" || !event.type.startsWith("task.")) return;
		setScopes(current => reduceScopes(current, event));
		if (event.type === "task.userEdit" || event.type === "task.undone") dispatch({ event });
	}), [bus]);

	// The board's live events; the main session exists only after its first turn, so a refusal retries (pulse: a turn ended).
	useEffect(() => {
		if (!sessionId) return undefined;
		const controller = new AbortController();
		(async () => {
			while (!controller.signal.aborted) {
				try {
					const { tasks } = await client.board(sessionId);
					dispatch({ seed: tasks });
					await client.events(sessionId, afterRef.current, event => {
						if (event.type === "main.turn" && event.turnId) {
							let text = "";
							client.frames(event.turnId, frame => { if (frame.type === "text.delta") text += frame.text ?? ""; if (frame.type === "tool.start") text = ""; }, controller.signal)
								.then(() => noteRef.current?.(text), () => {});
						}
						dispatch({ event });
					}, controller.signal);
				} catch { /* not there yet, or the stream dropped: try again */ }
				await sleep(RETRY_MS, controller.signal);
			}
		})();
		return () => controller.abort();
	}, [client, sessionId, pulse]);

	// A running card's progress line: its own frames, the last tool it started.
	const running = board.order.filter(id => board.tasks[id]?.status === "running" && board.tasks[id]?.turnId);
	const runningKey = running.map(id => `${id}:${board.tasks[id].turnId}`).join();
	useEffect(() => {
		const controllers = running.map(id => {
			const controller = new AbortController(), { turnId } = board.tasks[id];
			client.frames(turnId, frame => { const line = progressLine(frame, labelOf); if (line) dispatch({ event: { type: "task.progress", taskId: id, status: "running", progress: line } }); }, controller.signal).catch(() => {});
			return controller;
		});
		return () => controllers.forEach(controller => controller.abort());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, runningKey, labelOf]);

	const titles = useMemo(() => Object.fromEntries(board.order.map(id => [id, board.tasks[id].title])), [board]);
	useScopeBadges(scopes, titles);

	const undo = async taskId => {
		const receipt = await bus.run("task.undo", { taskId });
		if (receipt?.ok === false) throw new Error(receipt.message ?? receipt.code);
		dispatch({ event: { type: "task.undone", taskId } });
	};

	if (!board.order.length) return <div className="task-board" data-empty="true"><p className="task-board-empty">{ko("Tasks the main agent starts show here. Keep talking while they run.", "main 에이전트가 시작한 작업이 여기 보여요. 작업이 도는 동안에도 계속 말할 수 있어요.")}</p></div>;
	return <div className="task-board" aria-label={ko("Tasks", "작업")}>
		{[...board.order].reverse().map(id => <TaskCard key={id} task={board.tasks[id]} compile={compileState(activity, id)} client={client} labelOf={labelOf} onUndo={undo} />)}
	</div>;
}
