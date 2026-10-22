# HANDOFF - where the work stands (2026-10-22, branch feat/mp4-save)

Read `CLAUDE.md` and `PLAN.md` first. The user is not a developer: give exact PowerShell steps.

## Done in this session (all pass `npm run check`, 476 tests; NOT yet tried in real Stremio)

- **"Sync to sound" button** (main screen, next to Continue): `POST /api/sync-now`, `JobManager.syncNow()`.
  Listens to the video of the latest finished subtitle and moves it onto the speech. Outcomes:
  `moved`, `inSync`, `kept` (not sure), `unavailable` (video not on this PC's Stremio server).
  Review fixes applied: no stale cache write when the job was cleared/replaced/upgraded, no second
  sync while one runs, errors are logged and shown as "kept".
- **Sound check stops when another episode starts** (`syncStopped` flag in `src/jobs/manager.ts`).
- **One notice, not two**: the "exact subtitle ready" notice wins over the finished sound-check
  notice; both disappear by themselves after 60 s (`NOTICE_MS` in `src/web/html.ts`) or with OK.
- **Plain Hebrew/English texts** for the sync messages (`src/web/i18n.ts`); bidi isolates around titles.
- **No percentage in the in-player placeholder** (Stremio loads it once, so it froze):
  `progressMessage(lang, stage)` in `src/stremio/placeholder.ts`.
- **Sample translation card** shows "Translating..." instead of the old result while running.
- **Better sound check** (`src/sync/videoFit.ts`): skips the first 120 s (opening song), picks the
  pieces with the most dialogue (`pickWindows`), and if the first round is "not sure" listens to a
  second round and decides on everything heard.

## Still to do

1. **Test in real Stremio** (`npm start`, close any old copy first): Black Clover S1E31 and Avatar S2E4
   used to end "timing left as it was" (`fit-unsure`). Check whether the new windows now give a result.
   Also try the "Sync to sound" button and switching episodes mid-check. Send back the status message
   and the `timing left as it was` log line if still unsure.
2. Known leftovers from review: `unavailable` message is also shown when ffmpeg is missing; no
   test for double click / cache cleared mid-sync.
3. More timing ideas (see chat): align to the embedded English track's cue times; remember a found
   offset per file; per-part offsets; manual +/-0.5 s buttons; show confidence.
4. Memory note: SubDL key was once printed in a tool output - rotate it.
5. Ideas for later: Home server mode (see `PLAN.md`), Skip-embedded-when-too-big is already built.
