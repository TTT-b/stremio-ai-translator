# HANDOFF - the shared desk (updated 2026-11-12, branch main)

Read `CLAUDE.md` and this file first. Update this file at the end of every task (short; delete what is done).
The user is not a developer: answer in Hebrew, give exact PowerShell steps.

## State

- 2026-11-19 UNCOMMITTED, NOT released (user wants more updates first, e.g. the translation prompt, then one release 2.1.3): mux.ts now writes the video to a temp sibling and renames it over the target only on success (a failed save no longer deletes an existing file; tests added); HANDOFF/PLAN/DECISIONS moved to `docs/internal/`; CI Node 24 fix (`.github/workflows/check.yml`) not pushed; local commit `9d54239` (CLAUDE.md rule) not pushed. Push the CI fix soon so GitHub shows green.

- ONE folder `D:\TTT Sub`, branch `main`. v2.1.1 is the last PUBLISHED release (tag v2.1.1, published 2026-11-13 with installer, blockmap and latest.yml; installed on the desktop). v2.1.0 was 2026-11-12. When the user asks for a release, publish it without asking again.
- Security check 2026-11-12: 0 open Dependabot alerts, 0 secret-scanning alerts, `npm audit --omit=dev` = 0 vulnerabilities (dev-only leftovers: `tmp` via stremio-addon-sdk, needs a breaking upgrade: leave them). No tracked `.env`/settings/data/logs; the only key-like strings in history are fake test keys. Secret scanning + push protection and Dependabot security updates are on; `main` has no force-push or deletion.
- GitHub releases: keep at most about the last 10 (delete older ones, never the latest); commits and pushes in any number are fine.
- Never push without the user's OK (a release request counts as OK). Commit by file names, no attribution lines.
- Helper (sub) sessions may be archived once their task is done and verified; the main chat is never archived. Use /clear after updating this file.

## TO CHECK after the user's next PC restart

- A one-time Windows RunOnce entry (HKCU, `TTTCleanOldBuilds`) deletes `release-old`, `release-old2`, `release-old3` in `D:\TTT Sub` (they were locked by an unknown process: `app.asar` in use). Check they are gone. If they remain, find the locking process; the folders are untracked and harmless. Nothing else is pending for 2.1.2 (published, downgrade guard verified).

## 2026-11-19: v2.1.2 committed + published (user asked; check 792 tests, 0 alerts, installed OK). Old notes below.

## 2026-11-18 (v2.1.2, built locally)

- Added (not rebuilt into an installer, not committed): "הראה לי מה חדש" tour in the news bell (`src/web/ui/script/news.ts`, `src/web/newsTargets.ts`, `show` key in `whatsNew.ts`); 2.1.2 notes trimmed to 4 cards. Fixed a page-script crash on `d-src` (needs 2+ keyed sources) that killed the bell. Checked in a browser on a dev server (port 7100).- Added: local self-test row "תוסף TTT Sub" (`POST /api/test/selftest`), neutral Stremio wait state, per-problem banner lines with X. Tests green; checked in a browser. NOT yet rebuilt into an installer, not committed.

- NEXT TASK (user asked 2026-11-18): continue the translation-quality research (second-episode gender/cast problems). Open proposals, nothing in the repo yet and nothing may enter code before it passes a Gemini test: `buildCast` fix in `src/subtitles/cast.ts`; bad glossary entries in `data/glossary.json` (`Ainz`, `Ooal`, `Effulgent`/`Beryl`). Needs the user's OK per item.

## 2026-11-13 (PUBLISHED as v2.1.1)

- Installed name is now "TTT Sub" (`TTT Sub.exe`, shortcut, installer `TTT-Sub-Setup-<version>.exe`); data folder pinned to the old `%APPDATA%\stremio-ai-subtitle-translator`. Version in Settings > About is written by the server; "Check for updates" reacts at once; if `window.desktop` is missing it says so; `preload-error` is logged.
- Tester report (laptop): window max/close dead, no version, update button silent = all need `window.desktop` (preload). Works on the desktop PC; cause on the laptop unknown (FortiClient is visible in his screenshot). Ask him to send the log if it repeats (look for "preload failed").
- Tester hit a request quota: that is his own Gemini key's limit (free keys have a low daily/per-minute cap), not the app.

## v2.1.0 (PUBLISHED 2026-11-12; version 2.1.0 in package.json; v2.0.2 was never published, its changes ship inside 2.1.0)

- Shipped in 2.1.0: floating notice + tray dot/tooltip (`trayDot.ts`), "try another subtitle" button (`src/jobs/tryAnother.ts`, `POST /api/try-another`; works only for results still in memory), names glossary, 90-day cleanup, English before Japanese, no pointless "better subtitle" notice after a 0.0 s fit (`isNoShift`).
- From the Stremio research (9 Nov 2026): Stremio sends two requests per video (name only, then with the file hash 3-22 s later) and plays only the first. The hash request now joins the first job (`JobManager.ensure`), `SUB_WAIT_MS` is 8 s (Stremio's own server gives up on /sub after exactly 10 s), and a request with another file name for the same episode stops the older jobs' in-video wait and sound check (`supersedeOthers`). 741 tests.
- NOT done: ending the older job's download itself when the source is switched; answering with a quick filler instead of a held answer (item 3, partly covered by the 8 s wait); the "two unreachable-server checks = left the video" rule.
- Last round (9 Nov): retries for the in-video subtitle now 40 s (was 2 min); stage label no longer flips local/search/local; removed the Continue-translation button and the floating better-subtitle card (the app resumes by itself); quota tag/pill/key-section UI polish.
- Still to check: press "Check for updates" in an older installed version and confirm it offers 2.1.0.

## Not now / later

- Fix 3 (real abort on Continue + raise `STALL_AFTER_MS`, 12 s): user did not understand it; explain simply before asking again. Fix 5 (compact output format, Gemini thinking tokens): not now.
- Whole-episode skipped-lines rule (~5% of all lines) instead of 25% per 80-line chunk: only if real failures show up.
- Chunk rejected with an unusual 4xx: only if seen in a real log.
- Code signing (SignPath): at the END of the project (needs a GitHub Actions build, README policy section, more stars/users).
- Anthropic/OpenAI providers were never tried live.
- Sound-check "no data" on anime; subtitle appears ~1 s early even with exact timing (not investigated); constant lead/lag setting; per-file remembered offset.
- No notice for users of the old name "AI Subtitle Translator" (decided: not needed).
- Do NOT build: subtitle signature, remember-per-episode, cue-only check.

## v2.1.2 IN PROGRESS (working tree, NOT committed, NOT built, NOT released)

- Done in code: installer icon with download-arrow badge (build/installer-icon.ico, chosen option A, set as nsis.installerIcon), downgrade guard (build/installer.nsh), version 2.1.2 + RELEASE_NOTES 2.1.2; npm run check passes (782).
- Blocked: npm run dist fails with spawn UNKNOWN. Diagnosed 2026-11-17 from the Code Integrity event log (events 3077/3033): Smart App Control (state=1) blocks node.exe from running the freshly built unsigned `release\TTT-Sub-Setup-2.1.2.exe` (the NSIS step that makes the uninstaller). Tested: the same failure happens WITHOUT `build/installer.nsh`, so our code and the downgrade guard are not the cause; no code change fixes it. The same block hit earlier builds on 11-09 and 11-13; some builds pass (2.1.0, 2.1.1), so it is the file's reputation, not a setting. Options: retry (2 or 3 more tries at most), build on a machine without Smart App Control, code signing (planned for the end), or turn Smart App Control off (IRREVERSIBLE without reinstalling Windows; only with the user's explicit OK).
- To do after it builds: silent-install 2.1.2, then run release-keep/TTT-Sub-Setup-2.1.1.exe (older, has the guard) and confirm it refuses; then release 2.1.2 (GH_TOKEN from gh auth token; watch for double drafts); delete release-keep.

## Next update (older notes)

- Installer icon with a download-arrow badge (mockup in Chrome + OK first) and an NSIS downgrade guard (must not block auto-update). Ask the tester to install TTT-Sub-Setup-2.1.1.exe by hand and send the log if the window buttons still fail (look for "preload failed"); native titleBarOverlay is the fallback (needs UI OK).
- Release gotcha: `npm run publish` needs GH_TOKEN (use `gh auth token`, never print it) and can create TWO draft releases; fix by keeping one, uploading all 3 files, publishing. If you rebuild after publishing, re-upload exe+blockmap+latest.yml together (checksums).

## Next update AFTER 2.1.2 is closed: page-script structure (consultation only, do NOT start before 2.1.2 ships)

- Problem: the page script (`src/web/ui/script/index.ts`) is ONE inline script made of 6 parts run in order (core, wizard, drawer, status, library, news). One throw in the middle stops everything after it. Tester (2026-11-17, after reinstall): Settings opens, but the bell and "My subtitles" do nothing and an open episode shows no activity = fits an early throw in the script. Cause not found by reading the code; needs his log (`%APPDATA%\stremio-ai-subtitle-translator\logs\app-<date>.log`, look for "preload failed") or the F12 Console at `http://127.0.0.1:7000` in Chrome. If it works in Chrome but not in the app, the cause is Electron-specific.
- Plan (keep ONE script, the CSP allows only the nonce inline script): small protected core (`$`, `post`, `T`, `toast`) outside isolation; each part (wizard, drawer, status, library, news) an init function run by `runModule(name, fn)` that catches the error, logs which module failed (new renderer-error log line in `src/electron/main.ts`, e.g. `console-message` / `render-process-gone`) and shows a small notice; the rest keeps working. Do not wrap every line, do not hide errors silently.
- Trap: a `const` inside `try` is not visible outside it. Today drawer calls `refreshStatus` (defined in status) and status uses `subdlOn`/`paintRow` (core), so each module must publish what others need before wrapping. Add a test where one module throws on purpose and the others still wire up.
- Order: commit the finished 2.1.2 items alone first; then this as one small task; then build and release.

## User tasks

- Done 2026-11-17: `D:\TTT-design-mockups` deleted.
- None. (User dropped the Gemini key and OpenSubtitles account tasks 2026-11-19: everything works.)

## Knowledge worth keeping

- Gemini translation: temperature 0.3 (0.6-1.0 made the model drop duplicate lines and shift later lines); prompt v7; local repair step for drifted/broken lines; rescue ladder for skipped lines (`rescueSkipped` in `pipeline.ts`: strongest model in groups of 8, then single lines, then original text, max 25% of a chunk).
- Embedded track first (exact timing, no download); the OpenSubtitles download waits for that check (`lateEmbedded` gate in `openSubtitlesSource`); Skip and Cancel end the wait.
- Windows Smart App Control can block unsigned installers (laptop always; on the desktop once, 2026-11-12: a rebuild with `npm run dist` then install worked): the user installs by double-click. After every `npm run dist`, silent-install and start the app on the desktop.
- Dev server: `node tsx src/index.ts` from `%APPDATA%\stremio-ai-subtitle-translator`, port 7000 (no hot reload). `fit.test` / `videoFit.test` can time out when the PC is busy.
- Refactor of `manager.ts` / `html.ts` is mostly done (UI split into `src/web/ui/*`); M3 (sync/upgrade) and M4 (runJob) were left on purpose: high risk, optional.

## 2026-11-12 (done, merged to main and released)

- Library screen work and settings drawer polish all shipped in 2.1.0: fixed service colours (AI gold, OpenSubtitles sky, SubDL green from 2.1.2, Jimaku pink), a "links" row with Gemini/Claude/OpenAI under the key input, drawer widened to 470 px.
- The temporary ASS overlap experiment was removed (the add-on returns one subtitle again). Stremio said "Unsupported file" to a dragged local .ass; overlapping cues as ASS `\an8` stays an unverified idea.
- Why the main panel shows a job when Stremio only opens an episode: Stremio asks the add-on for subtitles on every episode open and `jobs.ensure` starts translating in the background. By design. A setting "translate only after choosing the TTT subtitle" was offered, not decided.
- Prettier/ESLint now ignore `.claude/worktrees/` (helper worktrees inside the repo broke `npm run check`).
