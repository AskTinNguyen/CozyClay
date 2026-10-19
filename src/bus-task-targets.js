// What a task's scope keys are in the editor's document stores, for the bus's tasks (bus-tasks.js): a snapshot of a
// key is its rows (an object's row; a character's cast row and motion layer; a shot's row) or, for stage and timeline,
// the whole slices; restoring puts every row back where it stood (or removes a row the task created) in one composed
// entry, so undo, history and saves see an ordinary edit. scene is not restorable: documents have no undo.
import { StudioProtocolError } from './studio-agent-protocol.js';

const ROWS = { object: [['objects', null]], character: [['cast', 'characters'], ['motion', null]], shot: [['shot', 'shots']] };
const WHOLE = { stage: ['stage'], timeline: ['shot', 'motion'] };
const split = key => { const at = key.indexOf(':'); return at < 0 ? [key] : [key.slice(0, at), key.slice(at + 1)]; };

function put(slice, part) {
	if ('whole' in part) return part.whole;
	const rows = (part.path ? slice[part.path] : slice).filter(row => row.id !== part.id);
	if (part.row) rows.splice(Math.min(part.index, rows.length), 0, part.row);
	return part.path ? { ...slice, [part.path]: rows } : rows;
}

/** snapshotTarget(key) and restoreTargets([{ key, value }]) over the app's store domains (ports.storeDomain, ports.beginAction). */
export function taskTargetPorts(ports) {
	const store = domain => ports.storeDomain?.(domain)?.documentStore;
	const rowParts = (kind, id, read) => ROWS[kind].filter(([domain]) => store(domain)).map(([domain, path]) => {
		const slice = store(domain).read(domain), rows = (path ? slice?.[path] : slice) ?? [];
		const index = read ? rows.findIndex(row => row.id === id) : -1;
		return { domain, path, id, index, row: index < 0 ? undefined : rows[index] };
	});
	return {
		snapshotTarget(key) {
			const [kind, id] = split(key);
			if (WHOLE[kind]) return WHOLE[kind].filter(store).map(domain => ({ domain, whole: store(domain).read(domain) }));
			return ROWS[kind] ? rowParts(kind, id, true) : null;
		},
		restoreTargets(values) {
			const parts = values.flatMap(({ key, value }) => {
				if (value === null) throw new StudioProtocolError('CAPABILITY_MISSING', `${key} cannot be restored: a document change has no undo.`);
				const [kind, id] = split(key);
				return value ?? rowParts(kind, id, false);
			});
			const domains = [...new Set(parts.map(part => part.domain))];
			if (!domains.length) return { historyEntryId: null };
			const session = ports.beginAction(domains[0], null);
			try {
				for (const domain of domains.slice(1)) session.touch(domain);
				session.run(() => { for (const part of parts) store(part.domain).write(part.domain, slice => put(slice, part)); });
				return session.commit();
			} catch (error) { session.cancel(); throw error; }
		},
	};
}
