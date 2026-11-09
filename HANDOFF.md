# HANDOFF - the shared desk (updated 2026-11-09, branch main)

Read `CLAUDE.md` and this file first. Update this file at the end of every task (short; delete what is done).
The user is not a developer: answer in Hebrew, give exact PowerShell steps.

## State

- ONE folder `D:\TTT Sub`, branch `main`. v2.0.1 is the last PUBLISHED release (tag v2.0.1). Never push or release without the user's OK.
- No open Dependabot alerts. `npm audit` leftovers are dev tools only (`tmp` via stremio-addon-sdk, needs a breaking upgrade): leave them.
- Never push or release without the user's OK. Commit by file names, no attribution lines.

## v2.1.0 (this release; version 2.1.0 in package.json; v2.0.2 was never published, its changes ship inside 2.1.0)

- Built (uncommitted until the commit step): floating notice + tray dot/tooltip (`trayDot.ts`), "try another subtitle" button (`src/jobs/tryAnother.ts`, `POST /api/try-another`; works only for results still in memory), names glossary, 90-day cleanup, English before Japanese, no pointless "better subtitle" notice after a 0.0 s fit (`isNoShift`).
- From the Stremio research (9 Nov 2026): Stremio sends two requests per video (name only, then with the file hash 3-22 s later) and plays only the first. The hash request now joins the first job (`JobManager.ensure`), `SUB_WAIT_MS` is 8 s (Stremio's own server gives up on /sub after exactly 10 s), and a request with another file name for the same episode stops the older jobs' in-video wait and sound check (`supersedeOthers`). 741 tests.
- NOT done: ending the older job's download itself when the source is switched; answering with a quick filler instead of a held answer (item 3, partly covered by the 8 s wait); the "two unreachable-server checks = left the video" rule.
- Last round (9 Nov): retries for the in-video subtitle now 40 s (was 2 min); stage label no longer flips local/search/local; removed the Continue-translation button and the floating better-subtitle card (the app resumes by itself); quota tag/pill/key-section UI polish.
- Next: user tests the built installer, then OK to push + tag v2.1.0 + publish release (installer, blockmap, latest.yml).

## Not now / later

- Fix 3 (real abort on Continue + raise `STALL_AFTER_MS`, 12 s): user did not understand it; explain simply before asking again. Fix 5 (compact output format, Gemini thinking tokens): not now.
- Whole-episode skipped-lines rule (~5% of all lines) instead of 25% per 80-line chunk: only if real failures show up.
- Chunk rejected with an unusual 4xx: only if seen in a real log.
- Code signing (SignPath): at the END of the project (needs a GitHub Actions build, README policy section, more stars/users).
- Anthropic/OpenAI providers were never tried live.
- Sound-check "no data" on anime; subtitle appears ~1 s early even with exact timing (not investigated); constant lead/lag setting; per-file remembered offset.
- No notice for users of the old name "AI Subtitle Translator" (decided: not needed).
- Do NOT build: subtitle signature, remember-per-episode, cue-only check.

## User tasks

- Rotate the Gemini key from the second Google account used in experiments; enter the new OpenSubtitles account in settings. Also delete `D:\TTT-design-mockups` (4 old mockup html files; the safety check blocked deleting it from here).

## Knowledge worth keeping

- Gemini translation: temperature 0.3 (0.6-1.0 made the model drop duplicate lines and shift later lines); prompt v7; local repair step for drifted/broken lines; rescue ladder for skipped lines (`rescueSkipped` in `pipeline.ts`: strongest model in groups of 8, then single lines, then original text, max 25% of a chunk).
- Embedded track first (exact timing, no download); the OpenSubtitles download waits for that check (`lateEmbedded` gate in `openSubtitlesSource`); Skip and Cancel end the wait.
- Windows Smart App Control blocks unsigned installers on the laptop (off on the desktop): the user installs by double-click. After every `npm run dist`, silent-install and start the app on the desktop.
- Dev server: `node tsx src/index.ts` from `%APPDATA%\stremio-ai-subtitle-translator`, port 7000 (no hot reload). `fit.test` / `videoFit.test` can time out when the PC is busy.
- Refactor of `manager.ts` / `html.ts` is mostly done (UI split into `src/web/ui/*`); M3 (sync/upgrade) and M4 (runJob) were left on purpose: high risk, optional.
