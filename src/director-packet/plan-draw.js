// Paint a director packet's plan (plan.js) on any 2D canvas context of the
// plan's page size: a metre grid, the lines of action, the cast's paths and
// marks, each camera's frustum and number with its path and arrow, and the
// legend in its own column. Light paper colours, so it prints. No DOM beyond
// the context it is handed.
import { toPage } from "./plan.js";

const INK = { paper: "#fbfaf6", grid: "#e6e2d8", axis: "#a39e92", text: "#26231e", soft: "#6d685d", line: "#2f7a3a", mark: "#2f6aa8", markFill: "#9cc3ea", walk: "#4f8fd0",
	camera: "#c0392b", cameraFill: "rgba(192, 57, 43, 0.14)", path: "#c0392b", legendFill: "#ffffff", legendEdge: "#cfc9bc" };

/** Shot numbers as runs: [1, 2, 3, 5] -> "1-3, 5". */
const runs = (numbers) => numbers.reduce((out, n) => {
	const last = out.at(-1);
	if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
	return out;
}, []).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");

function label(ctx, words, x, y, colour = INK.text, align = "left", right = Infinity) {
	// Keep the words on the page: a label that would run off an edge is pulled back inside it.
	const width = ctx.measureText(words).width, left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
	x += Math.max(0, 4 - left) - Math.max(0, left + width - (right - 4));
	ctx.textAlign = align; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(251, 250, 246, 0.92)"; ctx.fillStyle = colour;
	ctx.strokeText(words, x, y); ctx.fillText(words, x, y);
}

function arrowHead(ctx, [fx, fy], [tx, ty], size, colour) {
	const angle = Math.atan2(ty - fy, tx - fx);
	ctx.beginPath(); ctx.moveTo(tx, ty);
	ctx.lineTo(tx - size * Math.cos(angle - 0.45), ty - size * Math.sin(angle - 0.45));
	ctx.lineTo(tx - size * Math.cos(angle + 0.45), ty - size * Math.sin(angle + 0.45));
	ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
}

function polyline(ctx, plan, points) {
	ctx.beginPath();
	points.forEach((point, i) => { const [x, y] = toPage(plan, point); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
	ctx.stroke();
}

function grid(ctx, plan, p) {
	const { height } = plan.page, right = plan.page.legend.x;
	ctx.lineWidth = 1;
	for (let x = Math.floor((-plan.offset.x) / plan.scale); x <= Math.ceil((right - plan.offset.x) / plan.scale); x += p.stepM) {
		const [px] = toPage(plan, { x, z: 0 });
		ctx.strokeStyle = x === 0 ? INK.axis : INK.grid; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
		if (x % 2 === 0) label(ctx, `x ${x}`, px + 3, height - 12, INK.soft);
	}
	for (let z = Math.floor((-plan.offset.y) / plan.scale); z <= Math.ceil((height - plan.offset.y) / plan.scale); z += p.stepM) {
		const [, py] = toPage(plan, { x: 0, z });
		ctx.strokeStyle = z === 0 ? INK.axis : INK.grid; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(right, py); ctx.stroke();
		if (z % 2 === 0) label(ctx, `z ${z}`, 6, py - 9, INK.soft);
	}
	label(ctx, "1 m grid · +x right · +z down", 12, 22, INK.soft);
}

const DRAW = {
	grid,
	line(ctx, plan, p) {
		const a = toPage(plan, p.a), b = toPage(plan, p.b), dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, reach = 1.5 * plan.scale;
		ctx.strokeStyle = INK.line; ctx.lineWidth = 2.5; ctx.setLineDash([12, 8]);
		ctx.beginPath(); ctx.moveTo(a[0] - (dx / n) * reach, a[1] - (dy / n) * reach); ctx.lineTo(b[0] + (dx / n) * reach, b[1] + (dy / n) * reach); ctx.stroke(); ctx.setLineDash([]);
		label(ctx, `${p.label} line`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 14, INK.line, "center");
	},
	walk(ctx, plan, p) {
		ctx.strokeStyle = INK.walk; ctx.lineWidth = 2; ctx.setLineDash([3, 5]); polyline(ctx, plan, p.points); ctx.setLineDash([]);
		arrowHead(ctx, toPage(plan, p.points.at(-2) ?? p.points[0]), toPage(plan, p.points.at(-1)), 12, INK.walk);
	},
	mark(ctx, plan, p) {
		const [x, y] = toPage(plan, p), r = Math.max(9, 0.28 * plan.scale), [fx, fy] = toPage(plan, { x: p.x + p.facing.x * 0.6, z: p.z + p.facing.z * 0.6 });
		ctx.fillStyle = INK.markFill; ctx.strokeStyle = INK.mark; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(fx, fy); ctx.stroke(); arrowHead(ctx, [x, y], [fx, fy], 10, INK.mark);
		ctx.font = "600 15px system-ui, sans-serif"; label(ctx, p.letter, x, y + 1, INK.mark, "center");
		ctx.font = "500 14px system-ui, sans-serif";
		const behind = p.facing.x >= 0 ? -1 : 1;
		label(ctx, `${p.label} (shot${p.shots.length > 1 ? "s" : ""} ${runs(p.shots)})`, x + behind * (r + 6), y + r + 14, INK.mark, behind < 0 ? "right" : "left", plan.page.legend.x);
	},
	camera(ctx, plan, p) {
		if (p.unmeasured) return;
		const [cx, cy] = toPage(plan, p.position);
		ctx.fillStyle = INK.cameraFill; ctx.strokeStyle = INK.camera; ctx.lineWidth = 1.5;
		ctx.beginPath(); ctx.moveTo(cx, cy); for (const point of p.frustum) ctx.lineTo(...toPage(plan, point)); ctx.closePath(); ctx.fill(); ctx.stroke();
		if (p.path) {
			ctx.strokeStyle = INK.path; ctx.lineWidth = 3; polyline(ctx, plan, p.path);
			arrowHead(ctx, toPage(plan, p.arrow.from), toPage(plan, p.arrow.to), 16, INK.path);
		}
		ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fillStyle = INK.camera; ctx.fill();
		ctx.font = "700 14px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#ffffff"; ctx.fillText(p.label, cx, cy + 1);
		ctx.font = "500 14px system-ui, sans-serif";
		label(ctx, `${Math.round(p.focalMm)} mm${p.path ? `, moves ${p.travelM.toFixed(2)} m` : ""}`, cx + 18, cy + 18, INK.camera, "left", plan.page.legend.x);
	},
	legend(ctx, plan, p) {
		const { x, width } = plan.page.legend, top = 24, rowH = 30, h = 56 + p.rows.length * rowH;
		ctx.fillStyle = INK.legendFill; ctx.strokeStyle = INK.legendEdge; ctx.lineWidth = 1;
		ctx.fillRect(x + 8, top, width - 24, h); ctx.strokeRect(x + 8, top, width - 24, h);
		ctx.font = "700 16px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = INK.text; ctx.fillText("Legend", x + 22, top + 26);
		ctx.font = "500 13px system-ui, sans-serif";
		const swatch = { camera: INK.camera, cameraPath: INK.path, line: INK.line, mark: INK.mark, walk: INK.walk };
		p.rows.forEach((row, i) => {
			const y = top + 56 + i * rowH;
			ctx.strokeStyle = swatch[row.kind]; ctx.fillStyle = swatch[row.kind]; ctx.lineWidth = 3; ctx.setLineDash(row.kind === "line" ? [8, 5] : row.kind === "walk" ? [3, 4] : []);
			if (row.kind === "mark" || row.kind === "camera") { ctx.beginPath(); ctx.arc(x + 32, y - 4, 7, 0, Math.PI * 2); ctx.fill(); }
			else { ctx.beginPath(); ctx.moveTo(x + 22, y - 4); ctx.lineTo(x + 44, y - 4); ctx.stroke(); }
			ctx.setLineDash([]); ctx.fillStyle = INK.text; ctx.fillText(row.label, x + 54, y, width - 80);
		});
	},
};

/** Paint the plan; the context's canvas should be plan.page.width x plan.page.height. */
export function drawPacketPlan(ctx, plan, { title = null } = {}) {
	ctx.fillStyle = INK.paper; ctx.fillRect(0, 0, plan.page.width, plan.page.height);
	ctx.textBaseline = "middle"; ctx.font = "500 14px system-ui, sans-serif";
	for (const primitive of plan.primitives) DRAW[primitive.kind]?.(ctx, plan, primitive);
	if (title) { ctx.font = "700 18px system-ui, sans-serif"; label(ctx, title, plan.page.legend.x + 16, plan.page.height - 28, INK.text); }
	return plan;
}
