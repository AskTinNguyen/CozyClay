// Where a motion compile runs. In the browser: one module Web Worker (motion3/compile-worker.js), started
// on the first compile and reused, jobs answered in arrival order, so a compile costs the worker's time
// and never blocks the viewport (the main thread runs the compiler ~4x slower and freezes while it does).
// Where there is no Worker (Node, tests) or the worker fails: the same job on the calling thread,
// synchronously, so `registry.run("motion.compile", ...)` there still answers at once. The answer is the
// same either way (compile-job.js runs the same code on the same plain inputs).
import { runCompileJob } from "../motion3/compile-job.js";
import { StudioProtocolError } from "../studio-agent-protocol.js";

/** A job error (or a worker's serialized one) as the Studio's protocol error when it carries a code. */
function rethrow(error) {
	if (error?.code && !(error instanceof StudioProtocolError)) throw new StudioProtocolError(error.code, error.message);
	if (error instanceof Error) throw error;
	throw Object.assign(new Error(error?.message ?? String(error)), { name: error?.name ?? "Error" });
}
const local = job => { try { return runCompileJob(job); } catch (error) { return rethrow(error); } };

/** The browser's module worker, or null where there is none. */
function browserWorker() {
	if (typeof Worker !== "function") return null;
	return new Worker(new URL("../motion3/compile-worker.js", import.meta.url), { type: "module", name: "motion-compile" });
}

/**
 * createCompileRunner({ spawn }) -> { run(job) -> answer | Promise<answer>, takeWarning() -> string | null }
 * spawn() -> a Worker-like object (postMessage, onmessage, onerror, terminate) or null for the calling thread.
 */
export function createCompileRunner({ spawn = browserWorker } = {}) {
	let worker, dead = false, warning = null, next = 0;
	const pending = new Map();
	/** The worker failed (would not start, or crashed): every job from now on, and those in flight, run here. */
	const fallBack = reason => {
		dead = true;
		worker?.terminate?.();
		worker = null;
		warning ??= `The motion compile worker stopped (${reason}); compiling on the main thread, which is slower and blocks the editor while it runs.`;
		for (const [id, { job, resolve, reject }] of pending) { pending.delete(id); try { resolve(local(job)); } catch (error) { reject(error); } }
	};
	const started = () => {
		if (worker || dead) return worker;
		try { worker = spawn(); } catch (error) { fallBack(error?.message ?? String(error)); return null; }
		if (!worker) { dead = true; return null; }
		worker.onmessage = ({ data: { id, value, error } }) => {
			const job = pending.get(id);
			if (!job) return;
			pending.delete(id);
			if (error) { try { rethrow(error); } catch (thrown) { job.reject(thrown); } } else job.resolve(value);
		};
		worker.onerror = event => { event?.preventDefault?.(); fallBack(event?.message || "worker error"); };
		worker.onmessageerror = () => fallBack("an answer could not be read");
		return worker;
	};
	return {
		run(job) {
			if (!started()) return local(job);
			return new Promise((resolve, reject) => {
				const id = ++next;
				pending.set(id, { job, resolve, reject });
				try { worker.postMessage({ id, job }); } catch (error) { fallBack(error?.message ?? String(error)); }
			});
		},
		/** The fallback note, once (a receipt warning), or null. */
		takeWarning() { const note = warning; if (note) warning = ""; return note || null; },
	};
}
