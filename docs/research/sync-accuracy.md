# Subtitle accuracy research: missing ids and timing (2026-11-10)

Nothing here claims 100%. What is measured is below, with numbers.

## STATE / NEXT STEPS (updated 2026-11-11)

- Branch `claude/research-sync-d9e0a8`, not merged, not pushed. `npm run check` passes.
- Done and committed: the timing fix of the in-video subtitle check (`src/sync/cueFit.ts`,
  `src/sync/cueAlign.ts`), its tests, the benches in `scripts/research/`, this report.
- Running now: the missing-id A/B (`scripts/research/id-ab.ts`, 48 requests, one at a time, 5 s
  apart, stops after two rate-limit answers in a row). Raw results go to
  `data/research/results/ab-bb.json` (gitignored); the numbers are copied into this report.
- Next: (1) put the A/B numbers here and decide on the schema change in `gemini.ts`;
  (2) the weak timing cases listed under "What remains"; (3) one real check in Stremio by the
  owner before any merge.
- To resume from a fresh session: the sample files are not in git. Fetch them again with the
  `gh api` lines in "How it was measured", then run
  `npx tsx scripts/research/sync-bench.ts --path=cue` (fast) and compare with the tables here.
- `node_modules` in this worktree is a junction to `D:\TTT Sub\node_modules` (no install was run).

## How it was measured

- Real subtitle files, 587 to 1738 lines, taken from public GitHub repositories into
  `data/research/` (gitignored, never committed): Breaking Bad S01E01 (3 releases), Inception
  (3 releases), The Matrix (4 releases). OpenSubtitles downloads were not possible: the login in
  the development `.env` was rejected (the keys were not touched). Each file was fetched with
  `gh api -H "Accept: application/vnd.github.raw" repos/<owner>/<repo>/contents/<path>`:
  - `bb-reward.srt`: teinvdlugt/PWS, `data/subscene/breaking bad seizoen 1-5/Breaking.Bad.S01E01.720p.BluRay.x264-REWARD.srt`
  - `bb-yawnix.srt`, `bb-troll.srt`: flixadmin/Subtitle-API, `cache/Breaking.Bad.S01E01.1080p.Bluray.x265-YAWNiX.srt` and `cache/Breaking.Bad.S01E01.2160p.WEBRip.DTS-HD.MA5.1.x264-TrollUHD.srt`
  - `bb-mhd.srt`: kidp2h/sub, `Breaking.Bad.S01E01.mHD.BluRay.DD5.1.srt`
  - `inc-dvdrip.srt`, `inc-brrip.srt`, `inc-chd.srt`: kousyoukun/subtitle-collection, `movie/40794/` (`Inception.2010.DvDRip.H264-CRYS.srt`, `Inception.2010.BRRip.720p.H264.Feel-Free.srt`, `Inception.2010.BluRay.720p.DTS.2Audio.x264-CHD.eng.srt`)
  - `mx-silu.srt`: kousyoukun/subtitle-collection, `movie/35145/` (the `...SiLUHD.eng.srt` file)
  - `mx-yts.srt`: alfredlu1986/movie-english-sub, `1999/The.Matrix.1999.1080p.720p.BluRay.x264. [YTS.MX]-English.srt`
  - `mx-tlf.srt`: Enceladus-Ensoul/mov; `mx-hddvd.srt`: DaviFB27/film-subtitles (other languages, not used in the tables)
- `scripts/research/sync-bench.ts`: timing. 67 cases, 75,235 lines. 57 cases are a real file with a
  known change (shift, frame rate, jumps, missing lines, other language, noise), so every line's
  right time is known. 10 cases are two real releases of the same film; lines with the same unique
  text are the anchors, and "floor" is the best any fit could reach (the two authors do not start
  lines at the same instant).
- `scripts/research/id-bench.ts`: missing ids. A whole file through the app's own pipeline and the
  real Gemini API; every request is counted (ids asked, returned, missing, duplicate, unknown).
- Metrics: share of lines within 0.1 / 0.25 / 0.5 s of the right time, median and worst error;
  share of requests and of ids that came back; lines left untranslated at the end.

## Timing: the check against the subtitle track inside the video (`cueFit.ts`)

| All 67 cases                                   | Before | After |
| ---------------------------------------------- | ------ | ----- |
| Lines within 0.1 s                             | 80.1%  | 93.8% |
| Lines within 0.25 s                            | 83.7%  | 97.8% |
| Lines within 0.5 s                             | 85.1%  | 98.1% |
| Cases with at least 99% of lines within 0.25 s | 41     | 59    |

Root causes found and fixed:

1. **Another frame rate** (25 against 23.976, and the like). The drift reaches minutes in a film,
   so pieces either did not match at all, or matched a wrong shift and the subtitle was moved
   wrongly (one case: 36% of lines right, errors up to 5 s). Now the subtitle is stretched by each
   known ratio and compared again with the pieces already read; a third piece must agree. Result:
   100% of lines within 0.1 s in all 9 pure frame-rate cases, with 3 to 4 pieces instead of 5 to 8.
2. **Jumps** (the video has a scene or a break the subtitle does not). The shift was drawn as a
   slope between two pieces and continued as a slope before the first and after the last piece
   (cases with 26% to 45% of lines right, worst error 90 s). Now the gap is halved until the piece
   that holds the jump is read, the jump is placed on the exact line, and the shift stays level
   outside the pieces. Once a jump is known, one piece near the start and one near the end are read
   too. Result: all 9 made-up jump cases at 99.4% to 100% (7 of them exactly 100%).
3. **Small differences (0.1 to 0.4 s) between pieces** were replaced by one shift, which made a real
   pair worse than untouched. Now each part follows the pieces around it.

Real pairs (share of anchor lines within 0.25 s):

| Pair                             | Untouched | Before | After | Floor |
| -------------------------------- | --------- | ------ | ----- | ----- |
| Inception DVDRip on BluRay video | 0%        | 89.1%  | 99.1% | 99.3% |
| Inception BluRay on DVDRip video | 0%        | 84.5%  | 99.1% | 99.3% |
| Matrix YTS on SiLU video         | 87.4%     | 80.2%  | 93.9% | 94.5% |
| Matrix SiLU on YTS video         | 87.4%     | 64.3%  | 94.3% | 94.5% |
| Breaking Bad WEBRip on BluRay    | 0%        | 89.8%  | 89.8% | 90.3% |

The Inception pair really has three jumps (-0.3 s, -0.55 s, +1.5 s, +1.43 s along the film).

What remains, and why:

- Frame rate + 25% missing lines + other language + noise on a 2.5 h film: no answer from this
  check (unchanged); the sound check then takes over.
- A single jump before the first piece (25% of the length) or after the last (75%) is not seen:
  the edges are read only once another jump is known. Reading them always would cost every user
  two more pieces; left as a decision for the owner.
- The 8 cases still under 99% within 0.25 s: 6 real pairs that sit at their floor (89.8% to 94.3%
  against a floor of 90.3% to 94.5%: the two authors timed the lines differently), 1 case with a
  random 0.2 s noise on every line (94.6%; no single fit can remove it), and the case in the next
  point.
- Cost: a jump now reads up to 2 + 16 more one-minute pieces (was 3), and no new piece after 2.5
  minutes. Measured: 6 to 12 pieces for one jump, 13 to 17 for two, 20 for the real Inception pair. Cases without a jump read the same or fewer pieces.

## Timing: the sound check (`videoFit.ts`), not changed

Measured only with a **made-up soundtrack** (no video was downloaded), so these numbers test the
logic, not real sound: 77.3% of lines within 0.25 s; 38 of 67 cases at 99%+. It finds one shift and
one frame-rate stretch well. It cannot follow jumps (27% to 68% in those cases), finds nothing
beyond about 40 s, and for a 45 s shift it twice gave a wrong answer (3 to 7 s off). Not fixed:
proof needs real video sound.

## Missing ids (Gemini)

Before any change, 5 whole files (5,725 lines) and 8 single chunks, chunk size 80:

- Every file finished; 0 lines lost. 1 line of 5,725 had no Hebrew letter at the end (not checked
  whether that is a real miss or a name).
- `gemini-3.5-flash-lite`: 2 of 25 full requests came back without all ids (61 of 1,960 ids, 3.1%):
  once only the first 20 of 80 lines, once all but the last line. Both times the model reported a
  normal finish (`STOP`), not a cut-off.
- `gemini-3.1-flash-lite`: 0 of 58 full requests (0 of 4,484 ids). `gemini-3.6-flash`: 0 of 2.
- In both failures the existing retry (ask again only for the missing lines) got them at once.
- Much more common than missing ids: the chosen model answered 5xx / 429 (14 of 46 requests) and
  the job moved to the fallback model.

Root cause: the model sometimes ends the list early and says it is done. The pipeline already
repairs this at the price of one more request.

**Not finished:** a structural fix was tried (the answer schema states the exact number of lines,
`minItems` / `maxItems`). Gemini accepts it, but in the first small test the model then returned
one wrong id instead of a missing one, so it is **not proven** and was **not committed**. The
comparison script is `scripts/research/id-ab.ts`; it needs that schema change in `gemini.ts` to be
put back locally before it measures anything. A real A/B of about 50 requests is the next step.

## Recommendation

- Timing changes: tests pass and the numbers are clearly better, but they were measured without a
  real video. Merge after one real check in Stremio on a video with an inside subtitle track.
- Missing ids: no code change; the current protection held in every run.
