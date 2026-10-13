# CozyClay API Worker

The Cloudflare Worker behind `api.cozyclay.org`: Google sign-in and the hosted
video-model route (`/v1/motion/*`). It lives in this repository under
`AGPL-3.0-or-later` like everything else.

CozyClay 3 removed the hosted Kimodo motion queue (`/jobs`, `/r/:token.npz`,
`/worker/*`), its composer and ticket pages (`demo/`, `d/`) and the GPU-box
poller (`tools/demo-worker/`). Motion is compiled in the Studio now. The D1
tables and the R2 results bucket the queue used are still declared in
`migrations/` and `wrangler.toml`; retire them on the deployed Worker when it
is convenient.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /auth/google/start`, `GET /auth/google/callback` | Google OAuth; sets the `__Host-cc_sess` session cookie |
| `GET /me` | `{ signedIn, provider }` for the current session |
| `GET /v1/motion/me` | the signed-in account's video-model quota and active job |
| `POST /v1/motion/interpolate`, `POST /v1/motion/act` | submit a video-model job (disabled until `MOTION_GENERATION_ENABLED = "true"`) |
| `GET /v1/motion/jobs/:id` | poll one video-model job |

The scheduled handler (every five minutes) removes expired OAuth state.

## Local setup

```sh
cd workers/api
cp .dev.vars.example .dev.vars
npm ci
npm run migrate:local
wrangler dev --config wrangler.toml --env development
```

The same steps through the root package scripts:

```bash
npm run demo:api:install   # npm --prefix workers/api ci
npm --prefix workers/api exec -- wrangler d1 migrations apply cozyclay-demo --local
npm run demo:api           # wrangler dev on 127.0.0.1:8787
```

Create a signed development session without OAuth:

```sh
DEV_SESSION=$(node scripts/dev-session.mjs --account dev-account-1)
# The command prints seed SQL on stderr; apply it to local D1:
node scripts/dev-session.mjs --account dev-account-1 --sql \
  | tail -n 1 \
  | npx wrangler d1 execute cozyclay-demo --local --command
```

## Configuration and secrets

Only non-secret identifiers and origins belong in `wrangler.toml`. Set these with
`wrangler secret put` against `wrangler.toml` (never commit values):

- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret.
- `SESSION_SIGNING_KEY` — HMAC key for `__Host-cc_sess` session tokens.
- `FAL_KEY` — the video-model provider key used by `/v1/motion/*`.

Public variables are `SITE_ORIGIN`, `API_ORIGIN`, `ENVIRONMENT`, `GOOGLE_CLIENT_ID`,
`MOTION_GENERATION_ENABLED` and `FAL_CLIP_COST_USD`. The redirect URI is fixed by
environment and is not assembled from the request host:

- production: `https://api.cozyclay.org/auth/google/callback`
- development: `http://127.0.0.1:8787/auth/google/callback`

All mutation requests require an exact `Origin` match. Every response carries
exact ACAO, `Vary: Origin`, and credential CORS headers.
