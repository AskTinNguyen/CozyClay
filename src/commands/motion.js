// Motion and IK commands share one per-character authored-intent owner.
import { STUDIO_IK_CHAIN_TRACKS, studioActionDeclaration } from "../studio-actions.js";
import { fail, characterOf } from "./shared.js";
import { elementSetSchema, registerElementSet } from './elements.js';
import './elements/motion.js';
import './elements/character.js';
import { createMotionEdit, trimMotionEdit, splitMotionEdit, setMotionSegmentSpeed, removeMotionSegment } from '../ardy/motion-edit.js';
const id = { type: 'string', minLength: 1 }, frame = { type: 'integer', minimum: 0 };
const input = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const drop = { oneOf: [{ type: 'null' }, input({ from_s: { type: 'number', minimum: 0 }, to_s: { type: 'number', exclusiveMinimum: 0 }, meters: { type: 'number', exclusiveMinimum: 0, maximum: 30 } })] };
const mutation = (id, label, properties, required) => ({ id, label, description: label, kind: 'mutation', undoDomain: 'motion', input: input(properties, required) });
const setInput = elementSetSchema('motion');
// A collection transaction has no single native character target. Normalize
// that scope explicitly so begin/update carry the same target sentinel.
for (const variant of setInput.oneOf) variant.properties.characterId = { type: 'null', default: null };
const vector3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const rangePin = input({ id: { ...id, maxLength: 64 }, track: { type: 'string', enum: ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] },
	startFrame: frame, endFrame: frame, blend: { type: 'integer', minimum: 1, maximum: 240 }, reach: { type: 'string', enum: ['limb', 'body'] },
	target: { oneOf: [input({ space: { const: 'world' }, position: vector3 }), input({ space: { const: 'object' }, objectId: id, local: vector3 })] },
}, ['id', 'track', 'startFrame', 'endFrame', 'blend', 'target']);
const rangePins = [
	mutation('motion.rangePin.apply', 'Apply range pin', { characterId: id, pin: rangePin, replaceExisting: { type: 'boolean', default: false } }, ['characterId', 'pin']),
	mutation('motion.rangePin.remove', 'Remove range pin', { characterId: id, pinId: id }),
];
const platformFit = [
	{ id: 'motion.platformFit.run', label: 'Fit motion to platforms', description: 'Analyse scene platforms and prepare or apply an IK correction.', kind: 'job', domain: 'motion', timeoutMs: 300000, input: input({ characterId: id, preview: { type: 'boolean', default: false } }, ['characterId']) },
	{ id: 'motion.platformFit.remove', label: 'Remove platform fit', description: 'Apply or remove the reviewed platform-fit correction.', kind: 'job', domain: 'motion', timeoutMs: 300000, input: input({ characterId: id, apply: { type: 'boolean', default: false } }, ['characterId']) },
];
const edits = [
	{ ...mutation('motion.set', 'Set take fields', {}), input: setInput },
	mutation('motion.trim', 'Trim motion', { characterId: id, start: frame, end: frame }),
	mutation('motion.resetTrim', 'Restore full take', { characterId: id }),
	mutation('motion.cut', 'Cut motion segment', { characterId: id, frame }),
	mutation('motion.setSegmentSpeed', 'Set segment speed', { characterId: id, id, speed: { type: 'number', minimum: 0.05, maximum: 8 } }),
	mutation('motion.removeSegment', 'Remove motion segment', { characterId: id, id }),
	mutation('motion.fixCollisions', 'Fix body collisions', { characterId: id, scope: { type: 'string', enum: ['frame', 'clip'], default: 'frame' } }, ['characterId']),
];
const prepared = { ...mutation('motion.applyPrepared', 'Apply prepared motion edit', { characterId: id, token: id }), exposure: 'ui-only' };
const loads = [
	{ id: 'motion.replace', label: 'Replace take', input: input({ characterId: id, url: id, prompt: { type: 'string', default: '' },
		blocks: { type: 'array', maxItems: 120, items: input({ startFrame: frame, endFrame: { ...frame, minimum: 1 }, prompt: { type: 'string' } }) },
		drop,
	}, ['characterId', 'url']) },
	{ id: 'motion.loadVersion', label: 'Restore take version', input: input({ characterId: id, motionUrl: id }) },
].map(entry => ({ ...entry, description: entry.label, kind: 'job', domain: 'motion' }));
const tools = [
	mutation('motion.applyPhysics', 'Apply reviewed physics', { characterId: id }),
	mutation('motion.editTrail', 'Edit motion trail', { characterId: id, track: { type: 'string', enum: ['hips', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand', 'head'], default: 'hips' }, grabFrame: frame, radiusFrames: { ...frame, minimum: 1 }, delta: input({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }) }, ['characterId', 'grabFrame', 'radiusFrames', 'delta']),
	mutation('ik.applyPose', 'Key full-body pose', { characterId: id, frame, pose: { type: 'object', properties: { bones: { type: 'object', properties: {}, required: [], additionalProperties: true }, rootY: { type: 'number' } }, required: ['bones'], additionalProperties: true } }),
];
const physics = { id: 'motion.autoPhysics', label: 'Review motion physics', description: 'Analyse real rig motion and optionally apply one retained correction.', kind: 'job', domain: 'motion',
	input: input({ characterId: id, apply: { type: 'boolean', default: true }, strength: { type: 'number', minimum: 0, maximum: 1, default: 1 },
		protectedFrames: { type: 'array', items: frame, default: [] }, overrides: { type: 'array', default: [], items: input({
			site: { type: 'string', enum: ['leftFoot', 'rightFoot', 'leftHand', 'rightHand', 'leftKnee', 'rightKnee'] }, start: frame, end: frame,
			mode: { type: 'string', enum: ['plant', 'free'] },
		}) },
	}, ['characterId']) };
// These only queue the existing editor producers. Their eventual take
// publication is owned above; generation-pipeline unification remains #444.
const legacyIk = ['character.setIkKey', 'character.removeIkKey', 'character.clearIkKeys'].map(studioActionDeclaration);
const ik = legacyIk.map((entry, index) => ({ ...entry, id: ['ik.setKey', 'ik.removeKey', 'ik.clearKeys'][index] }));

const clear = { id: 'motion.clear', label: 'Clear motion', description: 'Clear the active take, its corrections, prompt blocks and take-owned cast fields.',
	kind: 'mutation', undoDomain: 'motion', input: { type: 'object', properties: { characterId: { type: 'string' } }, required: ['characterId'], additionalProperties: false } };
export const declarations = Object.freeze([prepared, ...loads, physics, ...tools, ...rangePins, ...platformFit, ...edits, ...legacyIk, ...ik, clear]);

export function register(registry, ports) {
	const owner = () => ports.storeDomain('motion');
	const mounted = () => Boolean(ports.storeDomain?.('motion')) || 'The motion owner is not mounted.';
	const take = characterId => { characterOf(ports, characterId); return owner().motionFor(characterId) ?? fail('TARGET_NOT_READY', 'Load a take for this character first.'); };
	registry.register({ ...prepared, available: mounted, run({ characterId, token }) {
		characterOf(ports, characterId); const result = owner().applyPrepared(token);
		return { affectedIds: result?.affectedIds ?? [characterId], summary: prepared.label };
	} });
	for (const declaration of loads) registry.register({ ...declaration, available: mounted, target: args => args.characterId, async run(args, context) {
		characterOf(ports, args.characterId); await owner().loadRemote(args, context);
		return { affectedIds: [args.characterId], summary: declaration.label };
	} });
	registry.register({ ...physics, available: mounted, target: args => args.characterId, async run(args, context) {
		characterOf(ports, args.characterId);
		return { affectedIds: [args.characterId], summary: physics.label, output: await owner().autoPhysics(args.characterId, args, context) };
	} });
	for (const declaration of tools) registry.register({ ...declaration, available: mounted, run(args) {
		characterOf(ports, args.characterId);
		if (declaration.id === 'motion.applyPhysics') owner().applyPhysics(args.characterId);
		else if (declaration.id === 'motion.editTrail') owner().editTrail(args.characterId, args);
		else {
			if (args.frame >= ports.state().frameCount) fail('INVALID_RANGE', 'IK frame is outside the timeline.');
			for (const angles of Object.values(args.pose.bones)) if (!Array.isArray(angles) || angles.length !== 3 || !angles.every(Number.isFinite)) fail('INVALID_ARGUMENT', 'Pose bones require three finite rotation angles.');
			owner().keyPose(args.characterId, args.frame, args.pose);
		}
		return { affectedIds: [args.characterId], summary: declaration.label };
	} });
	for (const declaration of rangePins) registry.register({ ...declaration, available: mounted, run(args) {
		characterOf(ports, args.characterId);
		const output = declaration.id === 'motion.rangePin.apply'
			? owner().bakeRangePin(args.characterId, args.pin, args.replaceExisting)
			: owner().removePin(args.characterId, args.pinId);
		return { affectedIds: [args.characterId], summary: declaration.label, ...(output ? { output } : {}) };
	} });
	registry.register({ ...platformFit[0], available: mounted, target: args => args.characterId, async run(args, context) {
		characterOf(ports, args.characterId);
		const output = await owner().platformFitRun(args.characterId, context, { preview: args.preview === true });
		return { affectedIds: [args.characterId], summary: platformFit[0].label, output };
	} });
	registry.register({ ...platformFit[1], available: mounted, target: args => args.characterId, run(args, context) {
		characterOf(ports, args.characterId);
		const output = owner().platformFitRemove(args.characterId, context, { apply: args.apply === true });
		return { affectedIds: [args.characterId], summary: platformFit[1].label, ...(output ? { output } : {}) };
	} });
	registerElementSet({ register(entry) { registry.register({ ...entry, available: mounted, run(args) {
		for (const op of args.ops ?? [args]) take(op.id);
		return entry.run(args);
	} }); } }, ports, edits[0]);
	for (const declaration of edits.slice(1)) registry.register({ ...declaration, available: mounted, run(args) {
		const { characterId } = args; characterOf(ports, characterId);
		if (declaration.id === 'motion.fixCollisions') owner().fix(characterId, args.scope);
		else {
			const current = take(characterId), full = owner().fullMotionFor(characterId);
			let segments = current.editSegments;
			if (declaration.id === 'motion.trim') {
				if (args.start > args.end || args.end >= current.frames) fail('INVALID_RANGE', 'Trim range is outside the take.');
				segments = trimMotionEdit(segments, args.start, args.end);
			} else if (declaration.id === 'motion.resetTrim') segments = createMotionEdit(full.frames);
			else if (declaration.id === 'motion.cut') segments = splitMotionEdit(segments, args.frame);
			else if (declaration.id === 'motion.setSegmentSpeed') segments = setMotionSegmentSpeed(segments, args.id, args.speed);
			else { if (segments.length <= 1) fail('INVALID_ARGUMENT', 'Use motion.clear to remove the final segment.'); segments = removeMotionSegment(segments, args.id); }
			if (segments !== current.editSegments) owner().editSegments(characterId, segments);
		}
		return { affectedIds: [characterId], summary: declaration.label };
	} });
	for (const [index, declaration] of [...legacyIk, ...ik].entries()) registry.register({ ...declaration,
		available: state => state.characters.length > 0 || 'There are no characters in this scene.', run(args) {
			const character = characterOf(ports, args.characterId), kind = index % 3;
			if (kind === 0) {
				const { frame, tracks } = args, names = Object.keys(tracks);
				if (frame >= ports.state().frameCount) fail('INVALID_RANGE', 'IK frame is outside the timeline.');
				if (!names.length) fail('INVALID_ARGUMENT', 'Name at least one track.');
				for (const track of names) {
					const key = tracks[track], chain = STUDIO_IK_CHAIN_TRACKS.includes(track), bones = chain ? 3 : 1;
					if (!key.q && !key.p) fail('INVALID_ARGUMENT', `tracks.${track} needs q or p.`);
					if (key.chainP && !chain) fail('INVALID_ARGUMENT', `tracks.${track}.chainP is for chain tracks only.`);
					for (const field of ['q', 'baseQ', 'chainP']) if (key[field] && key[field].length !== bones) fail('INVALID_ARGUMENT', `tracks.${track}.${field} needs ${bones} entries.`);
					if ([...(key.q ?? []), ...(key.baseQ ?? [])].some(q => Math.hypot(q.x, q.y, q.z, q.w) < 1e-6)) fail('INVALID_ARGUMENT', `tracks.${track} has a zero-length quaternion.`);
				}
				ports.setCharacterIkKey(args.characterId, frame, tracks);
			} else if (kind === 1) ports.removeCharacterIkKey(args.characterId, args.frame);
			else ports.clearCharacterIkKeys(args.characterId);
			return { affectedIds: [character.id], summary: declaration.label };
		} });
	registry.register({ ...clear, available: () => Boolean(ports.storeDomain?.('motion')) || typeof ports.clearMotionNative === 'function' || 'The motion owner is not mounted.',
		run({ characterId }) {
			if (ports.storeDomain?.('motion')) { characterOf(ports, characterId); owner().clear(characterId); }
			else {
				if (ports.state().activeCharacterId !== characterId) fail('TARGET_NOT_READY', 'Select this character before clearing its take.');
				ports.clearMotionNative();
			}
			return { affectedIds: [characterId], summary: 'Cleared motion and prompt blocks.' };
		} });
}
