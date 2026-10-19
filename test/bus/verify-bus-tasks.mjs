// Parallel Studio tasks, P1 (the command bus), through the real App: several tasks edit one scene at once, each inside
// its scope of keys. The plan's cases that live in the bus: 1 a busy key waits (SCOPE_BUSY), 2 a write outside the scope
// is refused (SCOPE_DENIED) and the scope can grow, 3 timeline and scene are exclusive, 5 the user's edit wins and the
// task hears of it once (STALE_TARGET), 6 Ctrl+Z stops at a running task's entry, 7 cancel restores only the task's own
// keys, 9 a task that reads a key hears when another task changes it; plus undo-task, a mark and its rollback, undo of
// the task's newest edit, created ids joining the task, and a single agent turn excluding tasks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectsFixture } from './objects-fixture.mjs';
import { commandKeys } from '../../src/bus-task-scopes.js';

const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt)); return receipt; };
const refused = (receipt, code) => { assert.equal(receipt.ok, false, JSON.stringify(receipt)); assert.equal(receipt.code, code, receipt.message); return receipt; };
function setup() {
  const f = objectsFixture(), id = kind => f.store.current.objects.find(o => o.renderer === kind || o.id === kind).id;
  const ids = { cube: id('cube'), sphere: id('sphere'), chair: id('chair') };
  // A task's command carries no fresh scene revision: another task's edits move it all the time.
  const task = taskId => (action, args = {}) => f.run(action, args, 'agent', { taskId, expectedRevision: 0 });
  const begin = (taskId, scope, extra = {}) => task(taskId)('task.begin', { taskId, scope, ...extra });
  const x = objectId => f.store.current.objects.find(o => o.id === objectId)?.x;
  const move = (run, objectId, value) => run('object.set', { id: objectId, set: { position: { x: value, y: 0, z: 0 } } });
  return { f, ids, task, begin, x, move };
}

test('two tasks edit disjoint objects at once; a busy key waits; outside the scope is refused until granted', () => {
  const { f, ids, task, begin, x, move } = setup();
  try {
    const a = task('task-a'), b = task('task-b');
    ok(begin('task-a', [`object:${ids.cube}`], { title: 'cube' }));
    ok(begin('task-b', [`object:${ids.sphere}`]));
    ok(move(a, ids.cube, 1)); ok(move(b, ids.sphere, 2)); ok(move(a, ids.cube, 3));
    assert.equal(x(ids.cube), 3); assert.equal(x(ids.sphere), 2);
    refused(begin('task-c', [`object:${ids.cube}`]), 'SCOPE_BUSY');
    refused(move(a, ids.sphere, 9), 'SCOPE_DENIED');
    refused(a('task.requestScope', { taskId: 'task-a', scope: [`object:${ids.sphere}`] }), 'SCOPE_BUSY');
    ok(a('task.requestScope', { taskId: 'task-a', scope: [`object:${ids.chair}`] }));
    ok(move(a, ids.chair, 4));
    refused(move((action, args) => f.run(action, args, 'agent'), ids.cube, 5), 'SCOPE_BUSY');
    ok(a('task.finish', { taskId: 'task-a' })); ok(b('task.finish', { taskId: 'task-b' }));
  } finally { f.dispose(); }
});

test('timeline and scene are exclusive; a task and an agent turn never run together', () => {
  const { f, ids, task, begin } = setup();
  try {
    ok(begin('task-a', [`object:${ids.cube}`]));
    refused(begin('task-t', ['timeline']), 'SCOPE_BUSY');
    refused(f.run('agent.turn.begin', { turnId: 'turn-1' }, 'agent', { turnId: 'turn-1' }), 'TARGET_BUSY');
    ok(task('task-a')('task.finish', { taskId: 'task-a' }));
    ok(begin('task-t', ['timeline']));
    refused(begin('task-b', [`object:${ids.sphere}`]), 'SCOPE_BUSY');
    ok(task('task-t')('task.cancel', { taskId: 'task-t' }));
    ok(f.run('agent.turn.begin', { turnId: 'turn-1' }, 'agent', { turnId: 'turn-1' }));
    refused(begin('task-b', [`object:${ids.sphere}`]), 'TARGET_BUSY');
    ok(f.run('agent.turn.finish', { turnId: 'turn-1' }, 'agent', { turnId: 'turn-1' }));
  } finally { f.dispose(); }
});

test("the user's edit wins and the task hears it once; Ctrl+Z stops at a running task's entry", () => {
  const { f, ids, task, begin, x, move } = setup();
  try {
    const a = task('task-a');
    ok(begin('task-a', [`object:${ids.cube}`]));
    ok(move(a, ids.cube, 1));
    refused(f.run('edit.undo', {}), 'TARGET_BUSY');
    ok(move((action, args) => f.run(action, args, 'ui'), ids.cube, 7));
    assert.equal(x(ids.cube), 7, 'the UI is never refused');
    const stale = refused(move(a, ids.cube, 2), 'STALE_TARGET');
    assert.match(stale.message, /changed outside this task/);
    ok(move(a, ids.cube, 2));
    ok(a('task.finish', { taskId: 'task-a' }));
    ok(f.run('edit.undo', {}));
  } finally { f.dispose(); }
});

test("cancel restores only the task's keys and removes what it created; undo-task after finish; conflicts named", () => {
  const { f, ids, task, begin, x, move } = setup();
  try {
    const a = task('task-a'), b = task('task-b'), x0 = x(ids.cube), count = f.store.current.objects.length;
    ok(begin('task-a', [`object:${ids.cube}`])); ok(begin('task-b', [`object:${ids.sphere}`]));
    ok(move(a, ids.cube, 1));
    const made = ok(a('object.duplicate', { objectId: ids.cube }));
    assert.equal(f.store.current.objects.length, count + 1);
    const madeId = made.affectedIds.find(id => ![ids.cube, ids.sphere, ids.chair].includes(id));
    ok(move(a, madeId, 6));
    ok(move(b, ids.sphere, 2));
    const cancelled = ok(a('task.cancel', { taskId: 'task-a' }));
    assert.equal(x(ids.cube), x0, 'the cube is back');
    assert.equal(f.store.current.objects.length, count, 'the duplicate is gone');
    assert.equal(x(ids.sphere), 2, "the other task's edit stays");
    assert.ok(cancelled.authored);
    ok(b('task.finish', { taskId: 'task-b' }));
    ok(move((action, args) => f.run(action, args, 'ui'), ids.sphere, 8));
    refused(f.run('task.undo', { taskId: 'task-b' }), 'UNDO_CONFLICT');
    ok(begin('task-c', [`object:${ids.chair}`]));
    ok(move(task('task-c'), ids.chair, 3));
    ok(task('task-c')('task.finish', { taskId: 'task-c' }));
    const undone = ok(f.run('task.undo', { taskId: 'task-c' }));
    assert.notEqual(x(ids.chair), 3); assert.ok(undone.authored);
    refused(f.run('task.undo', { taskId: 'task-c' }), 'UNDO_EXPIRED');
  } finally { f.dispose(); }
});

test("a mark and its rollback; undo_edit of the task's newest edit; a reader hears of a change", () => {
  const { f, ids, task, begin, x, move } = setup();
  try {
    const a = task('task-a'), b = task('task-b');
    ok(begin('task-a', [`object:${ids.cube}`, `object:${ids.chair}`]));
    ok(begin('task-b', [`object:${ids.sphere}`], { reads: [`object:${ids.cube}`] }));
    ok(move(a, ids.cube, 1));
    ok(a('task.mark', { taskId: 'task-a' }));
    ok(move(a, ids.cube, 2)); ok(move(a, ids.chair, 5));
    ok(a('task.rollback', { taskId: 'task-a' }));
    assert.equal(x(ids.cube), 1, 'back to the mark'); assert.notEqual(x(ids.chair), 5);
    const newest = ok(move(a, ids.cube, 4)), older = ok(move(a, ids.chair, 6));
    refused(a('edit.undo', { receiptId: newest.receiptId }), 'UNDO_CONFLICT');
    ok(a('edit.undo', { receiptId: older.receiptId }));
    ok(a('edit.undo', { receiptId: newest.receiptId }));
    assert.equal(x(ids.cube), 1);
    const heard = ok(move(b, ids.sphere, 2));
    assert.ok(heard.warnings.some(w => w.code === 'DEPENDENCY_CHANGED'), JSON.stringify(heard.warnings));
    ok(a('task.finish', { taskId: 'task-a' })); ok(b('task.finish', { taskId: 'task-b' }));
  } finally { f.dispose(); }
});

test('what a command writes, known before it runs', () => {
  const state = { objects: [{ id: 'g' }, { id: 'p', parent: 'g' }], selectedShotId: 's1' };
  assert.deepEqual(commandKeys('object.set', { id: 'g' }, state), ['object:g', 'object:p'], 'a group carries its subtree');
  assert.deepEqual(commandKeys('object.add', {}, state), [], 'a creation needs no key');
  assert.deepEqual(commandKeys('motion.compile', { characterId: 'a' }, state, { kind: 'job' }), ['character:a']);
  assert.deepEqual(commandKeys('motion.qa', { characterId: 'a' }, state, { kind: 'job', readOnly: true }), [], 'a read needs no key');
  assert.deepEqual(commandKeys('shot.placeCamera', {}, state), ['shot:s1']);
  assert.deepEqual(commandKeys('shot.setRange', { shotId: 's1' }, state), ['timeline']);
  assert.deepEqual(commandKeys('stage.applyLighting', {}, state), ['stage']);
  assert.deepEqual(commandKeys('scene.switch', { sceneId: 'b' }, state, { kind: 'document' }), ['scene']);
  assert.deepEqual(commandKeys('objects.arrange', { ops: [{ op: 'create' }, { op: 'update', id: 'p' }] }, state), ['object:p']);
  assert.deepEqual(commandKeys('some.newCommand', {}, state, { kind: 'mutation' }), ['scene'], 'an unknown command writes scene');
});

test('the panel hears a task\'s scope grow and the user editing inside it (task.scope, task.userEdit)', () => {
  const { f, ids, task, begin, move } = setup();
  const heard = [];
  const stop = f.binding.bus.subscribe(event => { if (/^task\./.test(event?.type)) heard.push(event); });
  try {
    const a = task('task-a');
    ok(begin('task-a', [`object:${ids.cube}`], { title: 'cube' }));
    ok(a('task.requestScope', { taskId: 'task-a', scope: [`object:${ids.chair}`] }));
    ok(move((action, args) => f.run(action, args, 'ui'), ids.cube, 7));
    ok(move((action, args) => f.run(action, args, 'ui'), ids.sphere, 8));
    ok(a('task.finish', { taskId: 'task-a' }));
    assert.deepEqual(heard.map(event => event.type), ['task.begun', 'task.scope', 'task.userEdit', 'task.finished']);
    assert.deepEqual(heard[1].scope, [`object:${ids.cube}`, `object:${ids.chair}`]);
    assert.deepEqual(heard[2], { type: 'task.userEdit', taskId: 'task-a', keys: [`object:${ids.cube}`] }, 'only the edit inside the scope is told');
  } finally { stop(); f.dispose(); }
});

test('undo task, newest first: once the later task is undone, the earlier one undoes though its key has a new token', () => {
  const { f, ids, task, begin, x, move } = setup();
  try {
    const ui = (action, args) => f.run(action, args, 'ui');
    const before = x(ids.cube);
    ok(begin('task-a', [`object:${ids.cube}`])); ok(move(task('task-a'), ids.cube, 1)); ok(task('task-a')('task.finish', { taskId: 'task-a' }));
    ok(begin('task-b', [`object:${ids.cube}`])); ok(move(task('task-b'), ids.cube, 2)); ok(task('task-b')('task.finish', { taskId: 'task-b' }));
    refused(ui('task.undo', { taskId: 'task-a' }), 'UNDO_CONFLICT');
    ok(ui('task.undo', { taskId: 'task-b' }));
    assert.equal(x(ids.cube), 1);
    ok(ui('task.undo', { taskId: 'task-a' }));
    assert.equal(x(ids.cube), before);
  } finally { f.dispose(); }
});
