# BombGuard (hub) — Claude Code Context

Part of the BombGuard ecosystem. **Read the root guidance first** — it governs
this app too:
- `../CLAUDE.md` — stack, conventions, design system, **Security Conventions**
- `../SECURITY.md` — security playbook with copy-paste patterns
- `../app-security-self-audit.md` — the audit checklist

## Most relevant security rules here
BombGuard is the Vercel-hosted PWA hub that hosts sub-apps and serves the
leaderboard (`api/scores.js`, Upstash Redis):
- **Strip secrets from API responses** — the leaderboard must never return `pin`.
  Use the `publicView()` allowlist projection (SECURITY.md §4).
- **Validate leaderboard input server-side**; rate-limit the write path (§5, §6).
- **`vercel.json` keeps the 6 security headers** (§8); it's headers-only — do not
  add a SPA rewrite that swallows real 404s. The hub's CSP is the one app that
  needs `script-src 'self' 'unsafe-inline'` (hand-written inline scripts) and
  `frame-src` for the iframed sub-apps — don't tighten those without testing.
- Leaderboard store creds read under either `KV_*` or `UPSTASH_*` env vars; none
  are `VITE_`-prefixed.
- **Analytics (`app_events`, Supabase `mgalwgarvsjgalaqyeok`, shared with holgry)
  are write-only for anon** — `supabase/migrations/001_lock_down_app_events.sql`
  grants anon a column-limited INSERT pinned by `WITH CHECK`, and no SELECT. Never
  add a SELECT policy or read `app_events` from the browser. `/stats` reads
  aggregates only via `api/stats.js` (Bearer `STATS_ADMIN_SECRET` → per-IP rate
  limit in Redis → `get_app_event_stats()` RPC with `SUPABASE_SERVICE_ROLE_KEY`,
  executable by `service_role` only). Not linked from the hub; owner bookmarks it.
  `supabase/` is excluded from both deploys (`.vercelignore`, `wrangler.jsonc`).

This app hosts sub-apps — keep iframe sandboxing/routing tight. After web changes,
bump the SW cache version and `npx cap sync` for BombGuardApp.
