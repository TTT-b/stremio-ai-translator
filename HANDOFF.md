# HANDOFF - the shared desk (updated 2026-11-09, branch main)

Read `CLAUDE.md` and this file first. Update this file at the end of every task (short; delete what is done).
The user is not a developer: answer in Hebrew, give exact PowerShell steps.

## State

- ONE folder `D:\TTT Sub`, branch `main`. v2.0.1 is the last PUBLISHED release (tag v2.0.1, installer + blockmap + latest.yml) and pushed. In-app update 2.0.0 -> 2.0.1 confirmed working on a second PC (2026-11-09). Real episodes (Dragon Ball) translate fine; the skipped-lines rescue ladder worked in real use.
- No open Dependabot alerts. `npm audit` leftovers are dev tools only (`tmp` via stremio-addon-sdk, needs a breaking upgrade): leave them.
- Never push or release without the user's OK. Commit by file names, no attribution lines.

## v2.0.2 (built locally, NOT published yet)

- Committed on main: left-video stop of the embedded wait (`embedded.ts`), chunk cache for kept-original chunks (`pipeline.ts`), README shortened (details moved to `docs/`, one screenshot), quota card: the low-quota warning shows once per app start with a small check button; an "i" icon next to the count explains it is only this computer's count (not synced). The status poll already refreshes the number every 1.5 s, so no refresh button.
- NOT verified on real Stremio: whether `stats.json` drops the torrent right when the user leaves; if the wait stays long, shorten `embeddedCapMs` (140 s, `src/jobs/manager.ts`).
- Next: user tries the installed build, then OK to push + tag v2.0.2 + publish release (installer, blockmap, latest.yml).

## Waiting for the user's OK (show a mockup first, then code)

1. "Try another subtitle" button: only when the failure is on the subtitle-source side (not AI/key errors); try it and check it works.

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
