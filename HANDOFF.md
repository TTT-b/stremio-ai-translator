# HANDOFF - where the work stands (2026-11-08, branch refactor/split-manager-html)

## Folders and branches (tidied 2026-11-08)

- `D:TTT Sub 1.9.1` = the real 2.0 work, branch `refactor/split-manager-html` (a linked worktree of the same repo). Work here.
- `D:TTT Sub` = the main checkout of the same repo, parked on `feat/model-picker` (the OLD 1.8-era model picker, kept only as a backup: 2.0 already has a newer picker in src/web/ui/modelPicker.ts, so do NOT merge it).
- Other branches are old backups (`feat/mp4-save`, `work/main-1.7.0`, `backup/old-local-main`, `fix/save-opensubtitles-quota`); local `main` is stale, `origin/main` is 1.8.0. After the 2.0 release: merge the refactor branch into main, then remove the 1.9.1 worktree and move on in `D:TTT Sub`.
- The user-facing "Copy diagnostics" button STAYS (users send it as feedback). The creator-only titles button was already removed (commit a248082).

## v2.0.0 status (2026-11-08)

Version bumped to 2.0.0 and committed on this branch. Done since the notes below: 429 daily/per-minute classification, pacing, auto-retry (src/jobs/autoRetry.ts), one "ready" toast that waits for the sound check (max 10 min), sound-check bar uses createSyncProgress, library layout wraps. NOT done: merge to main, release (needs the user's OK), user must enter the new OpenSubtitles account and rotate the second Gemini key. The installer is blocked by Windows Application Control when run silently: the user installs by double-click.

## START HERE TOMORROW (2026-11-08)

State: v1.9.1 released; everything below is UNCOMMITTED in `D:\TTT Sub 1.9.1` (do not touch `D:\TTT Sub`).
`npm run check` is green (43 files, 610 tests, ~50 s). It all ships later as v2.0 (version NOT bumped yet).
The user runs the app from source in the browser (Windows blocks unsigned exes): server is restarted on
http://127.0.0.1:7000/ (kill node whose command line matches `*TTT Sub 1.9.1*src*index.ts*`, then
`node "D:\TTT Sub 1.9.1\node_modules\tsx\dist\cli.mjs" "D:\TTT Sub 1.9.1\src\index.ts"` from
`%APPDATA%\stremio-ai-subtitle-translator`). No hot reload.

### Translation quality research (2026-11-07, done; scratch files deleted)

- Overlord S1E4 vs English: good overall. ONE real 8-line shift (cues 265-272: a repeated line pushed
  the next lines down by one). Karaoke/song lines (one syllable per cue) are handled inconsistently.
- No reproducible regression from prompt v6 / temp 1.0 / context 8: ~20 controlled requests on the
  failing chunk with v5 and v6 variants were all nearly clean. The shift is rare; its cause is unproven.
- Prompt v6 follows Google's guidance (instructions ordered by importance, JSON schema output, temp 1.0
  for Gemini 3). Weak spots: no thinking level set, no anchoring of the output to the source, validation
  only checks ids (not alignment), gender rule is heavy.
- Fixes done: removed dead fallback `gemini-2.5-flash-lite` (404 for new accounts); new cheap local
  `findDriftedLines` (length-ratio vs the chunk median, 3+ lines off by 2x, widened by 3) feeds the
  existing one-request-per-chunk repair step (`repairSuspiciousLines`, now up to 16 lines).
- NOT done: not tried on a real episode yet; gender fix (prompt v7), character memory, song handling.
- The user used a key from a second Google account for experiments: tell them to delete/rotate it.

### Round 2 (2026-11-07 night): real episode (Avatar Seven Havens S01E09, gemini-3.5-flash-lite)

- Found from the user's screenshots + 12 test runs of one 80-line chunk (scratch files deleted):
  at temp 1.0 the model sometimes (2 of 4 runs) DROPPED the last of two identical lines, which slid
  lines 9-21 and 46-61 by one; it also put an ARABIC letter inside Hebrew words ("נתחבר", "טיפש").
  Our old silent cut of that letter left a word short of a letter (the likely source of "בשביל שנו").
  At temp 0.3: 0 of 4 runs slid; at 0.6: 0 of 4 (one empty line). Samples are small; 0.4 also slid once.
- Changed: temperature 0.3 for every model (`TRANSLATION_TEMPERATURE` in gemini.ts; no extra requests);
  prompt v7 (sound notes short and idiomatic); a line where a foreign letter was cut out, a line with a
  lone Hebrew letter (`findBrokenWords`), and drifted lines all feed the same single repair request per
  chunk (cap 40 lines). The old test "no retry after a stray Arabic letter" now expects 1 extra call.
- Still unfixed (model weaknesses seen): "שבעה המקלטים" (should be שבעת), "שולט" without ב, "זאת העבר",
  wrong gender guesses. Candidates: prompt v8 grammar hints, a stronger model for the repair pass.
- The 2nd research key the user pasted lived only in the (deleted) research folder; tell them to rotate it.
- fit.test / videoFit.test can time out when the PC is busy (flaky under load, untouched by this work).

### Done today (uncommitted, tested by unit tests only, NOT yet tried on a real episode)

1. Translation reliability: `translateOneChunkNow` keeps the good lines of a bad answer and re-asks only the
   missing/empty ones (test in tests/translation.test.ts). `ModelFallbackProvider` reports the busy error
   (not "model unavailable") when the last model is missing (tests/fallback.test.ts). Duplicate guard: a
   per-JobManager `chunksInFlight` map (via `ChunkStore.inFlight`) so two jobs for the same chunk ask the AI
   once. A module-level map broke 21 flow tests, so it lives in the manager now.
2. Prompt v6, niqqud stripping (`stripHebrewPoints`), signs/songs cleanup, Stremio placeholder tweaks.
3. Home screen redesign (src/web/ui/dashboard.ts): original look, two columns at lg, fits one screen at
   1280x720, even small buttons, SubDL link as a bordered button that never overflows, "ספק AI" tile with the
   model name below, built-in sample row removed.

### Tomorrow, in order

1. Real test: translate one real episode; check no `TRANSLATION_VALIDATION_FAILED` / `PROVIDER_MODEL_UNAVAILABLE`
   and no second job paying for the same episode. User must first enter the NEW OpenSubtitles account in settings.
2. Ask the user: is the home screen final? What did they mean by "תחליף את הצבעים של הכפתורים ואת השם"
   (colors of "דלג על השלב"/"ביטול" and which name)? Not answered yet.
3. Apply the same style to settings, "הכתוביות שלי" (library) and the wizard, one screen at a time.
4. NOT approved yet (ask first): gender fix (cast hints, prompt v7), character memory between chunks,
   why the sound check gets "no data" on anime, optional ECC reinstall.
5. Then: bump to 2.0 with he+en release notes, update README/TROUBLESHOOTING, commit by file names
   (no attribution lines), push/release ONLY on explicit user OK
   before merging to main.

---

## (older) 2026-11-06 notes

- State (2026-11-06 night): v1.9.1 is COMMITTED, pushed and RELEASED (tag v1.9.1, GitHub release with exe + blockmap + latest.yml). The in-app update from 1.9.0 to 1.9.1 works (user confirmed). npm run check green (587 tests). `main` is still 1.8.0.
- NEXT TASKS (from a user's 1.9.1 diagnostics, not started): (1) Two jobs for the same episode BOTH download from OpenSubtitles and BOTH translate (jobs 6de80711 and 1417e3c0 for tt4869896 S1E2, both "translating now" + "job done"). This doubles AI calls and OpenSubtitles quota (14/20 left). Find out why the second job does not reuse the first one's translation, fix with a test. (2) Chunks fail validation (duplicate/missing/unknown id) right after "AI model overloaded: switched to another model" (gemini-3.5-flash-lite -> gemini-3.1-flash-lite); one user's three attempts all failed (TRANSLATION_VALIDATION_FAILED at 913/993). Idea: re-translate only the missing lines, or split the chunk. The diagnostics now show `problems=` (kind + line number only).
- (old) Included in 1.9.1: Stremio wait/failure messages, direct status-card buttons, source chips, cached-line counter. Toasts: ONE "subtitle is ready, select it again" toast only when the final subtitle actually changed (deduped per episode for 60 s; no-shift sound result = "in sync", no toast; manual "Sync to sound" always tells) + the failure toast. Status card wording: moved / already in sync / not sure / video not found (no seconds shown).
- Included in 1.9.1: Stremio wait/failure messages, direct status-card buttons, source chips, cached-line counter. Toasts: ONE "subtitle is ready, select it again" toast only when the final subtitle actually changed (deduped per episode for 60 s; no-shift sound result = "in sync", no toast; manual "Sync to sound" always tells) + the failure toast. Status card wording: moved / already in sync / not sure / video not found (no seconds shown).
- Open/optional: Stop/abort bug (aborted signal still starts ffmpeg in src/sync/speech.ts, cueFit.ts, videoFit.ts); refactor M3/M4/Stage 5.
- Do NOT build: subtitle signature, remember per episode, cue-only check.

Read `CLAUDE.md` and `PLAN.md` first. The user is not a developer: give exact PowerShell steps, answer in Hebrew.
`main` is 1.8.0 and is already merged INTO this branch. Never push to `main` or make a release without the
user's OK. First: `git pull`, `npm install`, `npm run check` (560 tests green).
Electron was updated to 44.10.2 (npm audit fix); the app was started with `npx electron .` and the server
answered (not tested with a real translation yet).

## Stremio messages and Windows toasts (2026-11-06, v1.9.1, uncommitted)

- Placeholder texts (src/stremio/placeholder.ts): one waiting text for every stage, failure text (not found vs generic), both he/en by the UI language. No percentages or reasons in Stremio; reasons stay in the app.
- Toasts: JobManager hook onFailed (once per episode per minute). A "subtitle ready" toast was built and then removed at the user's request (too noisy); only the exact-sync upgrade toast and the failure toast remain. Prefetch jobs never notify. Wired server.ts -> startup.ts -> electron/main.ts (notifyFailed).
- Version bumped to 1.9.1 with he+en release notes. Next: npm run dist, user installs from release/ and tests, only then publish (check latest.yml + exe on the release).
- Not built by decision: subtitle signature, remember per episode.

## Lighter status-card buttons (2026-11-06, uncommitted, `npm run check` green, 581 tests)

- "Stop sync" button removed from the UI (the `/api/sync-stop` endpoint stays, a test uses it).
- Header row, no menu: Cancel (only with a job), Skip (only when `skippable`), Continue (only when
  `resumable`, highlighted), Sync to sound (only once Stremio took a subtitle: `lastDelivered`).
- Chips under the progress bar (from `lastDelivered`): real source (`source`: opensubtitles/subdl/jimaku/video)
  plus "From cache" (amber) / "Translated now" (green) / "Ready subtitle" (`via`). Inline SVG icons (CSP).
  `/api/status` `lastDelivered.source` is new (`noteDelivered` in manager.ts). Chips show the delivered
  subtitle only, not the one still being translated.
- Session line counter now also counts cached subtitles, once per episode+language (`countLines`).
- Not checked by eye yet: `npm run build:css`, `npm run build:desktop`, stop the installed app, `npx electron .`.
- KNOWN BUG, not fixed: an already-aborted signal still lets ffmpeg run (`detectSpeech`, `readPieceWithFfmpeg`,
  `fitSubtitleToVideo` never check `signal.aborted` at the start), so Skip/Cancel keep working in the background.
- Approved, NOT built: Stremio placeholder messages (translating / no subtitle / failure) and Windows toasts
  when a subtitle is ready or fails. Do NOT build "remember per episode".

## v1.9.0 (2026-11-05): model choice + adaptive lanes (built on the refactor branch)

- Cause: an end-user got PROVIDER_TIMEOUT because free Gemini (`gemini-3.5-flash-lite`) was overloaded.
- Adaptive parallelism: lanes shrink to 1 while the provider pushes back (commit 13960cd).
- Model choice: `src/translation/models.ts` (list per provider, `POST /api/models`),
  `src/translation/fallback.ts` (`ModelFallbackProvider`, Gemini only, switches on timeout, rate limit,
  quota, model unavailable; cache identity stays the chosen model), settings `aiModels` (per provider,
  merged one level deep) and `autoSwitchModel`, UI `src/web/ui/modelPicker.ts`.
- Model lists are curated (short stable list per provider, generic AI sparkle icon in the picker);
  deprecated/retired Claude models are hidden. `GEMINI_FALLBACKS` was checked against Google's docs
  (2026-11-06). Newer Claude (4.7+) and OpenAI o-series/gpt-5 reject `temperature`, so it is no longer
  sent to them (`httpProviders.ts`).
- Tested live by the user (2026-11-06): Gemini translation works (Dragon Ball S1E3, auto model switch seen).
  NOT tested live: Anthropic and OpenAI (no keys), the OpenAI list filter (name heuristic), and whether
  Anthropic still accepts `anthropic-version: 2023-06-01`. Known, not fixed: with no internet one chunk
  walks the whole fallback chain; the UI says "provider rejected the key" even when OpenSubtitles gave
  the 403 (same error code).
- Stremio asks twice per play (without and with the video hash): two jobs, but the second shares the
  first translation (no double AI cost).
- `tailwind.config.js` content glob is now `./src/web/**/*.ts` (new files were being purged).
- To ask the end-user: press "Copy diagnostics" after the update if it still fails.
- Release is built with `npm run dist` and tested by the user before publishing (see repo-git-workflow).

## REFACTOR IN PROGRESS (branch refactor/split-manager-html, cut from feat/mp4-save)

Pure move-code split of src/jobs/manager.ts (was 2173 lines) and src/web/html.ts (was 1414), no behavior change.
Pushed to origin. Commits so far: dead-code cleanup, H1, M1, merge of main 1.8.0, M2 (see below).

- **Done**: H1 shared UI pieces -> src/web/ui/components.ts (html.ts 1390 lines);
  M1 types/constants/helpers -> src/jobs/jobTypes.ts (manager.ts 1898 lines). Each: worker moved verbatim,
  independent QA = PASS, `npm run check` green (512 tests), HTML render byte-identical to baseline.
- **M2 done**: read-only status views -> src/jobs/jobStatus.ts (pure functions; stats() still assembles).
- **H2 done**: server-side markup per screen -> src/web/ui/{context,titleBar,wizard,dashboard,library,
  drawer,modals,provider}.ts (html.ts 1414 -> about 1230 lines: head, inline script, assembly). Shared
  helpers live in `createUiCtx(d)` (context.ts); each screen is `renderX(c: UiCtx)`. HTML render
  byte-identical on all 8 variants, 560 tests green.
- **H3 done**: the inline browser script -> src/web/ui/script/{core,wizard,drawer,status,library,news}.ts,
  joined by `renderScript(c)` (index.ts), same single `<script>` with the same nonce (html.ts about 110 lines).
  Render byte-identical to the baseline, 560 tests green.
- **Next, Stage 3 rest**: M3 (sync/upgrade, shared state, HIGH risk). Stage 4: M4 runJob
  pipeline (HIGHEST risk, last). Stage 5: final QA + manual Stremio checklist. Lines in the original plan
  shifted by about -275 in manager.ts: re-find the areas by name.
- **Process per area**: Sonnet worker moves code verbatim; independent code-reviewer (plus
  silent-failure-hunter for M3/M4) checks with `git diff --color-moved`; `npm run check`; one commit.
- **html.ts render check**: baseline is in the session scratchpad (render.ts + baseline.html, covers he/en x desktop x ai).
  If it is gone, recreate it from commit 97a7c92 (render renderStatusPage for a fixed input, fixed nonce,
  8 variants) before touching html.ts, then compare after each area.
- **Resume**: `git checkout refactor/split-manager-html`, `npm install`, `npm run check`, start with M3.

## What is built on the branch

- **Sound-sync button, notices, stop button**: "Sync to sound" (`POST /api/sync-now`), "Stop sync"
  (`POST /api/sync-stop`). A sound check is no longer stopped when another episode starts; the user
  stops it. Bar with a big percent and a rough time left (`etaSec`, shown after 20 s and 5%).
- **Sound check waits for the video**: Stremio asks for subtitles before the episode plays, so the
  automatic check looks for the video every 3 s for up to 90 s (`syncFindWaitMs`), with a waiting line.
- **Timing from the video's own subtitle track (new, preferred)**: `src/sync/cueAlign.ts` (match line
  start times and words, piecewise-linear shift = `knots` in `TimingFit`, `applyFit` supports it) and
  `src/sync/cueFit.ts` (ffprobe the tracks, read 2 pieces of 60 s with
  `ffmpeg -ss S -copyts -i url -map 0:N -to S+60 -f srt -`, more pieces where neighbours disagree,
  rescue places when fewer than two pieces matched). Logged as `cue check` lines and `method=cues`.
  Only when the video has no usable track does it fall back to listening to the sound.
- **Sound check (fallback)** is now 2 pieces of 100 s first, up to 6, early answer only with score >= 0.3
  and agreeing pieces, late answer only with score >= 0.2 (a wrong move is worse than none). It logs
  `parts` (what is still off in each piece) and `score`.
- **One measurement per episode** when Stremio asks twice (`measuring` map in `JobManager`).
- **"Exact subtitle coming"** (`exactComing` in `/api/status`): while the video's own subtitle is still
  being read, the main screen says so instead of "not sure".
- **UI**: Cancel/Skip buttons next to the top buttons, only while there is a job; queue list from 2
  jobs; "Last subtitle Stremio took" line; Continue keeps its width when clicked; status refresh 1.5 s.
- **Library**: "Save as MKV (computer)" and "Save as MP4 (phone)" (MP4 for iPad/iPhone/phones, see README);
  clearer dialog title when the video must be picked.
- **Diagnostics**: "Copy diagnostics" = table of the last 5 videos (codes and numbers only, no titles) +
  latest video's log lines; `?scope=all` shows all.
- (The creator-only titles button was removed in commit a248082; nothing to remove.)

## Real results so far (real Stremio, laptop)

- Dragon Ball S1E1: cue-match worked (offset 0, 15/15 lines matched); took about 100 s, much of it
  because two requests read the video at once (fixed) and one piece hit the 40 s limit.
- Black Clover S1E20: the whole embedded track (389 cues) was read in about 70 s and gave exact timing,
  but the "too-big" gate had estimated 447 s against the 60 s limit.
- S1E19: sound check moved +37.1 s but about 3 s was still off. S1E24/25: "no data" / "unsure" (anime).
- The user sees the subtitle about 1 s before the speech even when the timing is exact (the embedded
  track itself leads?). Not investigated.

## Still to do (in this order)

1. **Test on real episodes** (movie, series, anime) and have the user report deviations by the row numbers
   of the diagnostics table. Compare `cue-match` vs sound.
2. **Speed of the cue check**: pieces take 20-40 s over the torrent and are cut at 40 s. Try reading two
   pieces in parallel, a shorter window, or a longer timeout for the first piece only.
3. **ETA of reading an embedded track** (`embedded=too-big`, limit 60 s) is pessimistic (447 s estimated,
   about 70 s real): fix the estimate or the default.
4. Optional constant lead/lag setting if exact timing still looks early.
5. **Slow Gemini** (`PROVIDER_TIMEOUT`); the partial-subtitle idea for long files (more than 1000 cues,
   serve the first part early) is planned in `PLAN.md`, not built.
6. **Code signing before a public release.** Windows Smart App Control blocks unsigned builds on the
   laptop (it is off on the desktop). Plan: SignPath Foundation (free for open source, the repo is MIT
   and public). They need a "Code signing policy" section in the README and release pages with the line
   "Free code signing provided by SignPath.io, certificate by SignPath Foundation", team roles, a privacy
   policy paragraph, a GitHub Actions workflow that builds the installer (only `check.yml` exists), and
   proof of reputation (1 star now: wait for a stable release and some users before applying).
   https://signpath.org/terms lists every condition.
7. **Before merging to `main`**: `npm run check`, update
   README / TROUBLESHOOTING / release notes, compare with `main`, ask the user.
8. Old items: Dependabot PR #1; rotate the SubDL key that was once printed; a Jimaku key (anime
   source, set in settings); `unavailable` message also shows when ffmpeg is missing; no test for double
   click / cache cleared mid-sync; ideas: per-file remembered offset, manual +/-0.5 s buttons, Home server mode.
