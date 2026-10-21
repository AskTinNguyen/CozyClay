#!/usr/bin/env node
// The stop rule (repair-watch.js): output.stuck says when more compiles stopped paying. The same
// failing groups for 3 compiles in a row -> a stuck note naming them and the best take so far; failures
// that improve -> no note; a whole spec after a note starts the streak again; 10 repair compiles -> the
// cap note; a compile after a passing one -> the polish note. Through the real registry the note fits
// the output budget and never changes what is compiled or installed.
import { createStudioAppActions } from "../../src/commands/index.js";
import { createRepairWatch } from "../../src/motion3/repair-watch.js";
import { MOTION_OUTPUT_BUDGET } from "../../src/motion3/report.js";
import { SCENE_OBJECTS, CHARACTER, CUP } from "./fixtures/cup-scene.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

// ---- the rule on its own ----------------------------------------------------------------------
const g = (kind, subject, severity) => ({ kind, subject, severity });
const fail2 = (sev = 4) => ({ ok: false, groups: [g("REACH", "hand_l misses cupHandle by 3 cm", sev), g("COLLIDE", "hand_l x table", 2)] });
let w = createRepairWatch(), n = 0;
const next = (qa, base, turnId = "t1", characterId = "c") => w.note({ characterId, turnId, specId: `spec-${String(++n).padStart(12, "0")}`, base, qa });
const notes = [next(fail2(3)), next(fail2(), "b"), next(fail2(), "b"), next(fail2(), "b")];
expect("no note for the first two compiles of a failure", notes[0] === undefined && notes[1] === undefined, JSON.stringify(notes));
expect("the third compile with the same failures says stuck, names them and the best take", /^REACH hand_l misses cupHandle by # cm, COLLIDE hand_l x table unchanged over 3 compiles; best so far spec-0+1 \(2 problems\)\. Stop patching it \(or re-applying its hint\): start afresh/.test(notes[2] ?? ""), notes[2]);
expect("and keeps saying it while nothing moves", /unchanged over 4 compiles/.test(notes[3] ?? ""), notes[3]);
expect("a whole spec after the note is the fresh start: no note", next(fail2()) === undefined);
expect("the note is short", notes[2].length <= 280, `${notes[2].length}`);

w = createRepairWatch();
const better = [next(fail2(6)), next(fail2(5), "b"), next(fail2(4), "b"), next({ ok: false, groups: [g("REACH", "hand_l misses cupHandle by 2 cm", 4)] }, "b")];
expect("severity dropping 5 % or more, or fewer groups: no note", better.every(x => x === undefined), JSON.stringify(better));
const superset = [next({ ok: false, groups: [g("BODY", "hand_l into thigh_l", 2)] }), next({ ok: false, groups: [g("BODY", "hand_l into thigh_l", 2), g("POP", "a", 1)] }, "b"),
	next({ ok: false, groups: [g("BODY", "hand_l into thigh_l", 2), g("POP", "a", 1)] }, "b")];
expect("a superset that does not improve counts as the same failure", superset[2] !== undefined && /BODY hand_l into thigh_l unchanged over 3/.test(superset[2]), JSON.stringify(superset));

w = createRepairWatch();
const sev = k => ({ ok: false, groups: [g("GOAL", `goal ${k}`, 10 - k * 0.6)] });
const capped = Array.from({ length: 12 }, (_, k) => next(sev(k), k ? "b" : undefined, "t2"));
expect("no note before the cap while failures change", capped.slice(0, 10).every(x => x === undefined), JSON.stringify(capped));
expect("the 11th compile of a turn (10 repairs) says stop and report", /^10 repair compiles: stop and report what still fails, unless the user asked for more\.$/.test(capped[10] ?? ""), capped[10]);
expect("another turn of the same character starts again", next(sev(1), "b", "t3") === undefined);
w = createRepairWatch();
const chain = Array.from({ length: 11 }, (_, k) => next(sev(k), k ? `spec-${String(n).padStart(12, "0")}` : undefined, null));
expect("without a turn the cap counts along the base chain", /^10 repair compiles/.test(chain[10] ?? "") && next(sev(0), undefined, null) === undefined, chain[10]);

w = createRepairWatch();
const pass = { ok: true, groups: [] };
const polish = [next(fail2()), next(pass, "b"), next(fail2(), "b"), next(pass, "b")];
const passed = `spec-${String(n - 2).padStart(12, "0")}`;
expect("the first pass gets no note", polish[1] === undefined);
expect("a compile after a pass says QA passed: stop unless asked", polish[2] === `${passed} already passed QA: stop unless the user asked for a specific change.` && polish[3] === polish[2], JSON.stringify(polish));
expect("other characters keep their own history", next(fail2(), "b", "t1", "other") === undefined);

// ---- through the registry: the cup scene, base alone three times --------------------------
const takes = new Map();
const owner = { replace: (id, take) => takes.set(id, take), motionFor: id => takes.get(id) ?? null };
const registry = createStudioAppActions({ state: () => ({ characters: [CHARACTER], objects: SCENE_OBJECTS, frameCount: 300 }), storeDomain: name => (name === "motion" ? owner : null) });
const run = args => { const r = registry.run("motion.compile", { characterId: CHARACTER.id, install: false, ...args }); return r?.output ?? r?.receipt?.output ?? r; };
const cupSpec = {
	schema: "cozyclay.motion-spec.v1", fps: 24, frames: 100,
	use: [{ skill: "standIdle", args: { at: [0.15, 0.3], heading: 0 }, f0: 0 }],
	props: { grip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } } },
	anchors: { cupHandle: { kind: "object", object: "cube-6", local: [0, 0.03, 0] } },
	fits: [{ side: "l", anchor: "cupHandle", effector: { prop: "grip", point: "fingers" } }],
	keys: [{ f: 10, set: { pitch: 0, armw_l: 0, w_cupHandle_l: 0 } }, { f: 30, set: { pitch: 25, armw_l: 1, w_cupHandle_l: 1, hand_l: [0.3, 1, 0.7] } },
		{ f: 36, set: { w_cupHandle_l: 1, pitch: 25, hand_l: [0.3, 1, 0.7] } }, { f: 60, set: { w_cupHandle_l: 0, pitch: 10, hand_l: [0.3, 1.2, 0.6] } }, { f: 99, set: {} }],
	objects: { [CUP.group]: { prop: "grip", grab: 34, release: 80 } },
	goals: [{ name: "cup lifted", moved: `object:${CUP.group}`, by: 0.1, at: [65, 75] }],
};
const first = run({ spec: cupSpec });
expect("the cup take fails QA (the fixture's REACH/COLLIDE groups)", first.qa?.ok === false && first.stuck === undefined, JSON.stringify(first.qa?.groups?.map(x => x.kind)));
const second = run({ base: first.specId, patch: [{ op: "replace", path: "/keys/@f=99/set", value: {} }] });
const third = run({ base: second.specId });
expect("the third unchanged compile answers output.stuck", second.stuck === undefined && /unchanged over 3 compiles/.test(third.stuck ?? ""), JSON.stringify([second.stuck, third.stuck]));
const bytes = JSON.stringify(third).length;
expect("an answer with the note still fits the receipt budget", bytes <= MOTION_OUTPUT_BUDGET, `${bytes} B`);
expect("the note changes nothing else: same specId, nothing installed", third.specId === first.specId && !takes.has(CHARACTER.id));
const moved = run({ base: first.specId, patch: [{ op: "move", from: "/keys/@f=60", path: "/keys/@f=64" }, { op: "add", path: "/keys/@f=20/set/pitch", value: 5 }] });
expect("a base + patch by frame compiles: the keys moved and added", moved.specId !== first.specId && moved.delta?.base === first.specId, JSON.stringify(moved.delta));

if (failures) { console.error(`${failures} motion3 stuck check(s) failed`); process.exit(1); }
console.log("motion3 stuck: all checks passed");
