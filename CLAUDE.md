# CLAUDE.md - permanent rules for this repo

- Read the repo (and `PLAN.md`) before editing. Never rewrite from scratch; continue existing work.
- Make the smallest safe change. Do not touch unrelated files.
- Never expose or commit secrets. Secrets live only in `.env` (gitignored). Never print them,
  log them, put them in URLs, caches, HTML or error responses.
- Run `npm run check` (format, lint, type-check, tests) after changes. Fix root causes; never
  weaken, skip or delete a test to make it pass.
- Update `README.md` / `TROUBLESHOOTING.md` when behavior changes.
- The user is not a developer: give exact manual steps (what, where, command, success looks
  like, what to send back) and PowerShell-first commands.
- Never claim something works without running the relevant check.

## Conventions

- TypeScript strict, ESM, Zod for external input, Vitest. No new dependencies without need.
- Deterministic code owns parsing, timestamps, IDs, cache and validation; the AI only translates text.
- All failures are `AppError` with a code from `src/errors.ts`.
- Logs use stage tags (`CONFIG`, `STREMIO`, `SOURCE`, `DOWNLOAD`, `PARSER`, `CACHE`, `CHUNK`,
  `API`, `VALIDATION`, `ASSEMBLY`, `DELIVERY`) and never contain dialogue by default.
