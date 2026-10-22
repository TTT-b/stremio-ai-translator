# HANDOFF - where the work stands (2026-10-22 night, branch feat/mp4-save)

Read `CLAUDE.md` and `PLAN.md` first. The user is not a developer: give exact PowerShell steps, answer in Hebrew.
`main` is still 1.7.0 and untouched. All work is on `feat/mp4-save` (version 1.8.0). Never push to `main`
or make a release without the user's OK. First: `git pull`, `npm install`, `npm run check`
(on a slow machine: `npx vitest run --testTimeout=90000`). 504 tests were green on the laptop.

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
- **Creator-only titles button** ("Copy diagnostics + titles", only with `CREATOR_DIAGNOSTICS=1`).
  **REMOVE BEFORE MERGING TO MAIN**: `src/web/creatorDiagnostics.ts`, `tests/creatorDiagnostics.test.ts`,
  and the lines marked `creator only` in `src/web/server.ts` and `src/web/html.ts` (commit 2c2401a).

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
7. **Before merging to `main`**: remove the creator-only button (see above), `npm run check`, update
   README / TROUBLESHOOTING / release notes, compare with `main`, ask the user.
8. Old items: Dependabot PR #1; rotate the SubDL key that was once printed; a Jimaku key (anime
   source, set in settings); `unavailable` message also shows when ffmpeg is missing; no test for double
   click / cache cleared mid-sync; ideas: per-file remembered offset, manual +/-0.5 s buttons, Home server mode.
