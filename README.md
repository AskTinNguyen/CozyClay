# CozyClay metrics ledger

Written daily by `.github/workflows/metrics.yml` on `main` (`tools/metrics-snapshot.mjs`).
GitHub traffic only lives 14 days, so this branch is the permanent copy.

- `data/traffic-daily.jsonl` views / clones per UTC day (from 2026-07-31; rows before 2026-08-10 came from the old `.metrics/daily.csv` on main)
- `data/stars-daily.jsonl` new stars per UTC day, rebuilt from `starred_at` each run
- `data/referrers.jsonl` 14-day top referrers and paths per run date
- `data/repo-stats.jsonl` stars, forks, watchers, issues, npm weekly downloads per run date
