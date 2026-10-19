---
name: model-routing
description: Choose the cheapest model that does the job and keep token use low. Use at the start of any task, before planning, delegating to a subagent, or reading many files.
---

# Model routing and token saving

## Which model

- **Sonnet (default, ~90% of work):** edits, bug fixes, tests, refactors of known code, git, docs, README/TROUBLESHOOTING updates, running `npm run check`.
- **Opus (only when it pays off):** a new feature spanning several modules, architecture or data-flow changes, a bug whose cause is unknown after one Sonnet attempt, security review, large migrations. Use it to produce a short written plan (max ~30 lines), then execute the plan on Sonnet.
- **Haiku:** pure lookups, grep-and-report, summarizing logs, listing files. Delegate with a subagent and `model: haiku`.
- Do not escalate to Opus for style, naming, or one-file changes. If a Sonnet attempt fails twice, escalate once, then return to Sonnet.

## Saving tokens without losing quality

1. Read `PLAN.md` first. Then read only the files the task touches. Use Grep/Glob before opening files; read line ranges, not whole files.
2. Never read `node_modules`, `dist-electron`, `release`, `logs`, `data`, `package-lock.json`, or `.env`.
3. Run `npm run check` once at the end, not after every edit. Run a single test file (`npx vitest run tests/<file>`) while iterating.
4. Pipe long command output through `Select-Object -First 40` / `-Last 40`; do not dump full logs.
5. Do not re-read a file just edited. Do not restate facts already established in the conversation.
6. Keep replies short: what changed, what was verified, what the user must do next.
7. Offload broad searches or log reading to a subagent so only its conclusion enters the main context.
8. One task per session. Start a new session when the topic changes instead of carrying a long history.
9. Never skip the check, tests, or the reading of files that affect correctness to save tokens.
