// The document targets a command writes, known before it runs, for tasks that edit one scene at once (parallel Studio
// tasks, P1). A key names one target: object:<id> (a group carries its subtree), character:<id> (its placement, its
// take, its IK), shot:<id> (its camera, rail and keys), or one of the singletons stage (light, environment, lens),
// timeline (frame count, shot order and ranges) and scene (documents, the cast library, a replace of a whole kind).
// timeline and scene are exclusive: no other task runs beside them. A command that only creates (object.add, a kit,
// character.add) needs no key: what it makes joins its task. A command this table does not know writes scene, so a
// new command is safe until it is named here.
const EXCLUSIVE_KEYS = new Set(['timeline', 'scene']);
const KEY = /^(?:(?:object|character|shot):[A-Za-z0-9][A-Za-z0-9._:-]*|stage|timeline|scene)$/;
export const isScopeKey = key => typeof key === 'string' && key.length <= 140 && KEY.test(key);

const SCENE = ['cast.replace', 'cast.setCustomPoses', 'cast.showExtras', 'cast.removePose', 'objects.replace', 'shot.replace', 'ai.prepareShot'];
const TIMELINE = ['shot.create', 'shot.createStill', 'shot.split', 'shot.duplicate', 'shot.remove', 'shot.reorder', 'shot.setRange', 'shot.setTimeline'];
const CREATE = ['object.add', 'object.createKit', 'asset.import', 'character.add'];
const CHARACTER = /^(character\.|characters?\b|cast\.(savePose|setLayer)$|ik\.|motion\.)/;

/** object:<id> and every object under it. */
function objectKeys(ids, state) {
	const rows = state?.objects ?? [], out = new Set();
	const visit = id => { if (!id || out.has(`object:${id}`)) return; out.add(`object:${id}`); for (const row of rows) if (row.parent === id) visit(row.id); };
	for (const id of ids) visit(id);
	return [...out];
}
const arrangeKeys = (ops, state) => ops.flatMap(op => op.op === 'create' ? [] : op.op === 'group' ? objectKeys([op.parentId, ...op.childIds], state)
	: op.op === 'ungroup' ? objectKeys(op.childIds, state) : objectKeys([op.id], state));

/**
 * The keys command `id` with validated `args` writes against state `state` (the bus's read), or [] when it writes
 * none (a read, a view change, a pure creation). `entry` is its registry entry (kind, readOnly).
 */
export function commandKeys(id, args = {}, state = {}, entry = {}) {
	if (entry.kind === 'document' || /^(scene|project)\./.test(id) || id === 'load_scenes' || SCENE.includes(id)) return ['scene'];
	if (entry.readOnly || entry.kind === 'transient' || /^(view|timeline)\./.test(id) || ['motion.qa', 'motion.sample', 'motion.describe', 'motion.report', 'sculpt.compare', 'export.shotVideo'].includes(id)) return [];
	if (CREATE.includes(id)) return [];
	if (id === 'objects.batch') return [...new Set(args.ops.flatMap(op => commandKeys(op.name, op.args, state)))];
	if (id === 'objects.arrange') return [...new Set(arrangeKeys(args.ops, state))];
	if (id === 'characters.arrange') return args.ops.flatMap(op => op.op === 'create' ? [] : [`character:${op.characterId}`]);
	if (id.startsWith('stage.') || id === 'shot.setLens') return ['stage'];
	if (TIMELINE.includes(id)) return ['timeline'];
	if (id.startsWith('shot.')) {
		const shot = args.shotId ?? args.id ?? state.selectedShotId;
		return shot ? [`shot:${shot}`] : ['timeline'];
	}
	if (id === 'object.group') return objectKeys([args.parent, ...args.children], state);
	if (id === 'object.ungroup') return objectKeys(args.children, state);
	if (id === 'object.remove') return objectKeys(args.ids, state);
	if (id === 'object.attach' || id === 'motion.keyObject') return [`character:${args.characterId}`, ...objectKeys([args.objectId], state)];
	if (id.startsWith('object.')) return objectKeys([args.id ?? args.objectId], state);
	if (CHARACTER.test(id) && (args.characterId ?? args.id)) return [`character:${args.characterId ?? args.id}`];
	return ['scene'];
}

/** The key an id a receipt names resolves to in state, or null (the scene's own id, a removed target). */
export function keyOfId(id, state = {}) {
	if ((state.objects ?? []).some(row => row.id === id)) return `object:${id}`;
	if ((state.characters ?? []).some(row => row.id === id)) return `character:${id}`;
	if ((state.shots ?? []).some(row => row.id === id)) return `shot:${id}`;
	return null;
}

/** Why `keys` cannot join task `taskId` beside the other open tasks, or null. */
export function scopeConflict(taskId, keys, tasks) {
	for (const other of tasks.values()) {
		if (other.taskId === taskId) continue;
		const held = keys.find(key => other.keys.has(key) || EXCLUSIVE_KEYS.has(key) || [...other.keys].some(k => EXCLUSIVE_KEYS.has(k)));
		if (held) return `${held} is held by task ${other.taskId}${other.title ? ` (${other.title})` : ''}`;
	}
	return null;
}
