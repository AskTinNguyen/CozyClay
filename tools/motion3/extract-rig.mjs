// Dump a Mixamo FBX rig's bind skeleton plus measured face/body landmarks to
// src/motion3/rigs/<model>.json for the motion3 compiler.
// Run once per rig: node tools/motion3/extract-rig.mjs x-bot-tpose
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const model = process.argv[2] ?? "x-bot-tpose";
const buf = fs.readFileSync(path.resolve("public/models", `${model}.fbx`));
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
root.updateMatrixWorld(true);
let mesh = null;
root.traverse(o => { if (o.isSkinnedMesh && (!mesh || o.skeleton.bones.length > mesh.skeleton.bones.length)) mesh = o; });
// The whole bone hierarchy under the skinned Hips, end bones included (some rigs do not skin them).
const bones = [];
// Mixamo FBX nests an identity "skinned" copy of every bone under its control bone; the
// project rule (src/ardy/playback.js findBone) is first depth-first match wins, so keep
// the first bone of each name and never the nested copies.
const seen = new Set();
let top0 = mesh.skeleton.bones[0];
while (top0.parent?.isBone) top0 = top0.parent;   // skinned bones may be the nested copies
top0.traverse(o => { if (o.isBone && !seen.has(o.name)) { seen.add(o.name); bones.push(o); } });
const idx = new Map(bones.map((b, i) => [b, i]));
const name = b => b.name.replace(/^mixamorig:?/, "");
const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
const out = { model, units: "cm", mesh: mesh.name, bones: bones.map(b => {
	b.matrixWorld.decompose(v, q, s);
	return { name: name(b), parent: idx.has(b.parent) ? idx.get(b.parent) : -1, localPos: b.position.toArray(), localQuat: b.quaternion.toArray(),
		worldPos: v.toArray(), worldQuat: q.toArray() };
}) };
// Bind-pose vertices in world space (skinning at bind pose is the identity).
const pos = mesh.geometry.attributes.position, P = [];
for (let i = 0; i < pos.count; i++) P.push(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray());
const B = n => out.bones.find(b => b.name === n).worldPos;
const head = B("Head"), neck = B("Neck");
// HeadTop_End is not in every rig (Y Bot has none): fall back to the highest skin vertex.
const top = out.bones.find(b => b.name === "HeadTop_End")?.worldPos
	?? [head[0], Math.max(...P.filter(p => p[1] > head[1]).map(p => p[1])), head[2]];
// Head profile on the mid-sagittal strip |x| < 1.5 cm: the face is the front (+z) silhouette.
const strip = P.filter(p => Math.abs(p[0]) < 1.5 && p[1] > neck[1] && p[1] < top[1] + 2);
const rows = [];
for (let y = Math.floor(neck[1]); y < top[1]; y += 1) {
	const r = strip.filter(p => p[1] >= y && p[1] < y + 1);
	if (r.length) rows.push({ y: y + 0.5, front: Math.max(...r.map(p => p[2])), back: Math.min(...r.map(p => p[2])) });
}
// Head skin only: from 6 cm below the head joint up, inside |x| < 12 cm (keeps the shoulders out).
const headVerts = P.filter(p => p[1] > head[1] - 6 && Math.abs(p[0]) < 12);
const ext = k => [Math.min(...headVerts.map(p => p[k])), Math.max(...headVerts.map(p => p[k]))];
const hb = { x: ext(0), y: ext(1), z: ext(2) };
// The bot head has no modelled mouth: put it 16% of the head height above the chin, on
// the front silhouette (interpolated from the profile rows), 0.3 cm proud of the skin.
const mouthY = hb.y[0] + 0.16 * (hb.y[1] - hb.y[0]);
const near = rows.filter(r => r.front > 0).sort((a, b) => Math.abs(a.y - mouthY) - Math.abs(b.y - mouthY)).slice(0, 3);
const mouthZ = Math.max(...near.map(r => r.front)) + 0.3;
out.landmarks = {
	// all in bind-pose world cm; the compiler re-expresses them in the Head bone frame
	mouth: [0, mouthY, mouthZ],
	headEllipsoid: { centre: [(hb.x[0] + hb.x[1]) / 2, (hb.y[0] + hb.y[1]) / 2, (hb.z[0] + hb.z[1]) / 2],
		radii: [(hb.x[1] - hb.x[0]) / 2, (hb.y[1] - hb.y[0]) / 2, (hb.z[1] - hb.z[0]) / 2] },
	headJoint: head, headTop: top,
};
const file = path.resolve("src/motion3/rigs", `${model}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(JSON.stringify({ file, bones: out.bones.length, verts: P.length, landmarks: out.landmarks }));
