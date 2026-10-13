import {
  handleCallback,
  readSession,
  startOAuth,
  clearSessionCookie,
} from "./auth.js";
import { mutationGuard, requireOrigin, withCors } from "./cors.js";
import { POLICY, utcDay } from "./policy.js";
import { DAILY_CAP as MOTION_DAILY_CAP, generateMotion, MODEL as MOTION_MODEL, validateInput } from "./motion.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function json(data, status = 200, headers = {}) {
  const result = new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...headers },
  });
  return result;
}

function errorResponse(error, status, request, env, extra = {}) {
  return withCors(json({ error, ...extra }, status), request, env);
}

async function accountFor(env, accountId) {
  if (!accountId) return null;
  return env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(accountId).first();
}

async function meHandler(request, env) {
  const session = await readSession(request, env);
  if (!session) return withCors(json({ signedIn: false }), request, env);
  const account = await accountFor(env, session.sub);
  if (!account) return withCors(json({ signedIn: false }), request, env);
  return withCors(json({
    signedIn: true,
    provider: (await env.DB.prepare("SELECT provider FROM identities WHERE account_id=? ORDER BY created_at LIMIT 1").bind(account.id).first())?.provider ?? null,
  }), request, env);
}

function motionEnabled(env) {
  return String(env.MOTION_GENERATION_ENABLED ?? "false").toLowerCase() === "true";
}

function publicMotionJob(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    duration: Number(row.duration),
    resolution: row.resolution,
    model: MOTION_MODEL,
    video: row.video_url ? { url: row.video_url } : null,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    fps: row.fps == null ? null : Number(row.fps),
    resultDuration: row.result_duration == null ? null : Number(row.result_duration),
    cost: row.cost_usd == null ? null : Number(row.cost_usd),
    requestId: row.request_id ?? null,
    error: row.error ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  };
}

async function motionUsageFor(env, accountId, now = Date.now()) {
  const row = await env.DB.prepare("SELECT used FROM motion_usage WHERE account_id=? AND day=?").bind(accountId, utcDay(now)).first();
  return Math.max(0, MOTION_DAILY_CAP - Number(row?.used ?? 0));
}

async function runMotionJob(env, jobId, kind, input, accountId) {
  const now = Date.now();
  await env.DB.prepare("UPDATE motion_jobs SET status='running', updated_at=? WHERE id=? AND status='queued'").bind(now, jobId).run();
  try {
    const result = await generateMotion({ kind, input, env });
    const metadata = result.metadata ?? {};
    const video = result.video ?? {};
    const width = Number.isFinite(metadata.width) ? metadata.width : null;
    const height = Number.isFinite(metadata.height) ? metadata.height : null;
    const fps = Number.isFinite(metadata.fps) ? metadata.fps : null;
    const resultDuration = Number.isFinite(metadata.duration) ? metadata.duration : null;
    const finished = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE motion_jobs SET status='done', video_url=?, width=?, height=?, fps=?, result_duration=?, cost_usd=?, request_id=?, updated_at=?, finished_at=? WHERE id=?`)
        .bind(video.url, width, height, fps, resultDuration, Number(env.FAL_CLIP_COST_USD ?? 0.0625), result.requestId ?? null, finished, finished, jobId),
      env.DB.prepare(`INSERT INTO motion_usage(account_id, day, used) VALUES (?, ?, 1)
        ON CONFLICT(account_id, day) DO UPDATE SET used=motion_usage.used+1`).bind(accountId, utcDay(finished)),
    ]);
  } catch (error) {
    await env.DB.prepare("UPDATE motion_jobs SET status='failed', error=?, updated_at=?, finished_at=? WHERE id=?")
      .bind(String(error?.message ?? error).slice(0, 500), Date.now(), Date.now(), jobId).run();
  }
}

async function submitMotion(request, env, ctx, kind) {
  const guarded = mutationGuard(request, env);
  if (guarded) return guarded;
  if (!motionEnabled(env)) return errorResponse("submissions_disabled", 503, request, env, { detail: "Motion generation is disabled while launch QA is in progress." });
  const session = await readSession(request, env);
  if (!session) return errorResponse("signed_in_required", 401, request, env);
  let body;
  try { body = await request.json(); } catch { return errorResponse("invalid_json", 400, request, env); }
  let input;
  try { input = validateInput(body, kind); } catch (error) {
    return errorResponse(error.code ?? "invalid_motion_request", error.status ?? 400, request, env, { detail: error.message });
  }
  const account = await accountFor(env, session.sub);
  if (!account) return errorResponse("signed_in_required", 401, request, env);
  const usage = await motionUsageFor(env, account.id);
  if (usage <= 0) return errorResponse("daily_cap", 429, request, env, { dailyRemaining: 0 });
  const active = await env.DB.prepare("SELECT id FROM motion_jobs WHERE account_id=? AND status IN ('queued','running') LIMIT 1").bind(account.id).first();
  if (active) return errorResponse("active_job_exists", 409, request, env, { jobId: active.id });
  const id = crypto.randomUUID();
  const created = Date.now();
  await env.DB.prepare(`INSERT INTO motion_jobs(id, account_id, kind, status, prompt, duration, resolution, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', ?, ?, '480P', ?, ?)`).bind(id, account.id, kind, input.prompt, input.duration, created, created).run();
  const task = () => runMotionJob(env, id, kind, input, account.id);
  if (ctx?.waitUntil) ctx.waitUntil(task()); else void task();
  return withCors(json({ job: { id, kind, status: "queued", duration: input.duration, resolution: "480P", model: MOTION_MODEL }, dailyRemaining: usage }, 202), request, env);
}

async function getMotionJob(request, env, id) {
  const session = await readSession(request, env);
  if (!session) return errorResponse("signed_in_required", 401, request, env);
  const row = await env.DB.prepare("SELECT * FROM motion_jobs WHERE id=? AND account_id=?").bind(id, session.sub).first();
  if (!row) return errorResponse("not_found", 404, request, env);
  return withCors(json({ job: publicMotionJob(row), dailyRemaining: await motionUsageFor(env, session.sub) }), request, env);
}

async function motionMeHandler(request, env) {
  const session = await readSession(request, env);
  if (!session) return withCors(json({ signedIn: false, dailyRemaining: MOTION_DAILY_CAP }), request, env);
  const active = await env.DB.prepare("SELECT id FROM motion_jobs WHERE account_id=? AND status IN ('queued','running') LIMIT 1").bind(session.sub).first();
  return withCors(json({ signedIn: true, enabled: motionEnabled(env), dailyRemaining: await motionUsageFor(env, session.sub), activeJobId: active?.id ?? null }), request, env);
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Max-Age": "600",
      },
    }), request, env);
  }
  if (pathname.startsWith("/auth/") && request.method === "GET") {
    const match = pathname.match(/^\/auth\/google\/(start|callback)$/u);
    if (!match) return errorResponse("not_found", 404, request, env);
    const response = match[1] === "start"
      ? await startOAuth(request, "google", env, { nextPath: url.searchParams.get("next") ?? "/demo/" })
      : await handleCallback(request, "google", env);
    return withCors(response, request, env);
  }
  if (pathname === "/me" && request.method === "GET") return meHandler(request, env);
  if (pathname === "/v1/motion/me" && request.method === "GET") return motionMeHandler(request, env);
  const motionSubmitMatch = pathname.match(/^\/v1\/motion\/(interpolate|act)$/u);
  if (motionSubmitMatch && request.method === "POST") return submitMotion(request, env, ctx, motionSubmitMatch[1]);
  const motionJobMatch = pathname.match(/^\/v1\/motion\/jobs\/([A-Za-z0-9_-]+)$/u);
  if (motionJobMatch && request.method === "GET") return getMotionJob(request, env, motionJobMatch[1]);
  return errorResponse("not_found", 404, request, env);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error("cozyclay api error", error?.message ?? error);
      return errorResponse("internal_error", 500, request, env);
    }
  },
  async scheduled(_event, env, ctx) {
    const work = (async () => {
      await env.DB.prepare("DELETE FROM oauth_state WHERE created_at <= ?").bind(Date.now() - POLICY.OAUTH_STATE_TTL_MS).run();
    })();
    if (ctx?.waitUntil) ctx.waitUntil(work);
    // Await as well as registering waitUntil so local adapters and operational
    // smoke tests observe completed cleanup before the handler resolves.
    await work;
  },
};

export {
  route,
  json,
  withCors,
  requireOrigin,
  mutationGuard,
  clearSessionCookie,
  motionEnabled,
  motionUsageFor,
  publicMotionJob,
  runMotionJob,
  submitMotion,
};
