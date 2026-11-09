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

## Splitting work across subagents (professional, token-cheap)

Split only when it saves tokens or time. Otherwise do the task inline.

1. **Split when** the parts touch different files/modules, need no result from each other, and each can be described in a short prompt. Research and read-only searches are the best candidates. **Do not split** when the task needs a read of most of the project, when parts edit the same file, or when it is small (a few edits): then do it yourself.
2. **No worktree copies by default.** Subagents work in the same folder on separate files and each is told which files are theirs. Use a worktree only when two writers must touch the same files, and say why. Copies cost setup tokens (junction to `node_modules`, a branch to merge).
3. **Do not teach the project to every agent.** Each prompt is short: the goal, the folders/files to start from, the rules that matter (`CLAUDE.md` is read by the agent itself), what "done" means, and the report format (max ~30 lines, file names + result, no code dumps). The agent explores and experiments on its own.
4. **Model per job:** Haiku for lookups and log reading, Sonnet for code and tests, Opus only for a hard design. Say `model:` explicitly.
5. **Every writer agent must** write tests first, run only its own test file while working, run `npm run check` once at the end, and commit by file name. It must not push, tag or touch `HANDOFF.md`.
6. **Before merging, verify** each report yourself in one pass: `git diff --stat`, read the changed lines, run `npm run check` on the combined result. A report is a claim, not proof (an agent once said a test was missing when it was there: grep before trusting).
7. **Collect everything before replying.** Do not end your turn while agents are still running. Update `HANDOFF.md` yourself at the end.
8. **UI work is never delegated to code before the user has seen a mockup and said OK.** Agents may research or draw the mockup; they do not build the screen.
