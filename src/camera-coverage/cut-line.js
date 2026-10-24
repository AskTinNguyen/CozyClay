// The line of action a cut is judged against (group-coverage D1): the line
// between the pair the two shots are about. That pair is the line authored
// on the shots (camera.setLine, or the pair a group pattern laid the shot
// for), else the two shots' subjects when they differ, else the one subject
// and the person they look at. With three or more people in range there is
// no guessing the nearest one: when the pair cannot be told the answer says
// why, and when the shots are about two different pairs the cut changes
// line (a line change, judged by camera.checkCoverage, not a crossing).
// Pure: the cut rules, camera.checkCoverage and the sequence brief read it.

const DEG = Math.PI / 180, LOOK_COS = 0.5, TIE_DEG = 10;
const nameOf = (row) => String(row?.name ?? row?.subject ?? row?.id ?? "").split(",")[0].trim();
const facing = (row) => ({ x: Math.sin((row.rot ?? 0) * DEG), z: Math.cos((row.rot ?? 0) * DEG) });
/** The cosine between where `a` faces and the direction to `b`. */
const gazeCos = (a, b) => { const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, f = facing(a); return (f.x * (b.x - a.x) + f.z * (b.z - a.z)) / d; };

/** Does `a` face roughly toward `b` (within 60 degrees)? Side-by-side people facing the same way are not in a reverse. */
export const looksAt = (a, b) => gazeCos(a, b) > LOOK_COS;

/** The line authored on a shot ([idA, idB]), or null. */
export const authoredLine = (shot) => (Array.isArray(shot?.line?.between) && shot.line.between.length === 2 ? shot.line.between : null);

/** A pair's label: "Mara–Joon". */
export const pairLabel = (pair) => pair.map(nameOf).join("–");
/** Do two id pairs name the same two people (in either order)? */
export const samePair = (p, q) => p && q && [...p].sort().join("|") === [...q].sort().join("|");

/**
 * Whom a person looks at: the cast member nearest the middle of their gaze (within 60 degrees).
 * { row } when one stands out, { tie: [rows] } when two sit within 10 degrees of each other, {} when nobody.
 */
function gazeTarget(row, people) {
	const seen = people.filter((other) => other.id !== row.id && looksAt(row, other))
		.map((other) => ({ other, deg: Math.acos(Math.max(-1, Math.min(1, gazeCos(row, other)))) / DEG })).sort((p, q) => p.deg - q.deg);
	if (!seen.length) return {};
	if (seen[1] && seen[1].deg - seen[0].deg < TIE_DEG) return { tie: [seen[0].other, seen[1].other] };
	return { row: seen[0].other };
}

/**
 * The pair a cut is about.
 * @param {object} from  outgoing shot   @param {object} to  incoming shot
 * @param {object|null} a  the outgoing shot's subject   @param {object|null} b  the incoming shot's subject
 * @param {Array} people  the cast where it stands at the cut ({ id, name, x, z, rot })
 * @returns {{ pair?: [object, object], source?: "authored"|"subjects"|"gaze", label?: string, change?: [string, string], unclear?: string }}
 */
export function cutPair(from, to, a, b, people) {
	const rows = (ids) => ids.map((id) => people.find((row) => row.id === id));
	const answer = (ids, source) => {
		const pair = rows(ids);
		if (pair.some((row) => !row)) return { unclear: `the line ${ids.join("–")} names someone who is not in the scene` };
		return { pair, source, label: pairLabel(pair) };
	};
	const la = authoredLine(from), lb = authoredLine(to), subjects = a && b && a.id !== b.id ? [a.id, b.id] : null;
	if (la && lb) {
		if (samePair(la, lb)) return answer(la, "authored");
		const [pa, pb] = [la, lb].map((ids) => rows(ids));
		return { change: [pa, pb].map((pair, i) => (pair.every(Boolean) ? pairLabel(pair) : [la, lb][i].join("–"))) };
	}
	if (la || lb) return answer(la ?? lb, "authored");
	if (subjects) return answer(subjects, "subjects");
	const one = a ?? b;
	if (!one) return { unclear: "neither shot is about a character" };
	const gaze = gazeTarget(people.find((row) => row.id === one.id) ?? one, people);
	if (gaze.row) return answer([one.id, gaze.row.id], "gaze");
	return { unclear: gaze.tie ? `${nameOf(one)} looks between ${gaze.tie.map(nameOf).join(" and ")}; name the line with camera.setLine` : `${nameOf(one)} looks at nobody; name the line with camera.setLine` };
}
