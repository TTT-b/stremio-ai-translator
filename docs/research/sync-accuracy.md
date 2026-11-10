# Subtitle accuracy research: missing ids and timing (2026-11-10)

Nothing here claims 100%. What is measured is below, with numbers.

## STATE / NEXT STEPS (updated 2026-11-11)

- Branch `claude/research-sync-d9e0a8`, not merged, not pushed. `npm run check` passes (769 tests).
- Done and committed: the timing fix of the in-video subtitle check (`src/sync/cueFit.ts`,
  `src/sync/cueAlign.ts`), the Gemini line-count fix (`src/translation/gemini.ts`), their tests,
  the benches in `scripts/research/`, `docs/SPEC.md`, `DECISIONS.md`, this report.
- Numbers now (cue check, lines within 0.25 s): 99.7% on all 85 cases, 99.6% on the first 67
  (83.7% before any change), 94.9% on the 10 real pairs (floor 95.3%). 0 of 85 fits are worse
  than leaving the subtitle untouched.
- Nothing is running. Raw results are in `data/research/results/` (gitignored); the numbers are
  copied into this report.
- **Not done: no check on a real video.** Everything above was measured on subtitle files, with
  the video's own track played by a second subtitle file. Whether ffmpeg really returns the track
  pieces fast enough from a playing torrent, and how long 4 pieces take, was not measured.
- Next, in this order: (1) one real video in Stremio (a video with its own subtitle track, and
  one normal translation) before any merge; (2) optional: a bigger A/B of the line count (a few
  hundred requests) to make the 0-of-26 result firm; (3) the sound check on real video sound,
  which was only simulated here and was not touched.
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
- `scripts/research/sync-bench.ts`: timing. At first 67 cases, 75,235 lines (85 cases since
  2026-11-11, see below). 57 cases are a real file with a
  known change (shift, frame rate, jumps, missing lines, other language, noise), so every line's
  right time is known. 10 cases are two real releases of the same film; lines with the same unique
  text are the anchors, and "floor" is the best any fit could reach (the two authors do not start
  lines at the same instant).
- `scripts/research/id-bench.ts`: missing ids. A whole file through the app's own pipeline and the
  real Gemini API; every request is counted (ids asked, returned, missing, duplicate, unknown).
- Metrics: share of lines within 0.1 / 0.25 / 0.5 s of the right time, median and worst error;
  share of requests and of ids that came back; lines left untranslated at the end.

## Timing: the check against the subtitle track inside the video (`cueFit.ts`)

| The first 67 cases                             | Before | After |
| ---------------------------------------------- | ------ | ----- |
| Lines within 0.1 s                             | 80.1%  | 94.7% |
| Lines within 0.25 s                            | 83.7%  | 99.6% |
| Lines within 0.5 s                             | 85.1%  | 99.9% |
| Cases with at least 99% of lines within 0.25 s | 41     | 60    |

On 2026-11-11 the bench got 18 more cases (85 in all, 98,059 lines): a single jump at 8%, 15% and
90% of the length, a steady speed that no frame rate explains (x1.02), and "wrong film" (the track
of another film, where any move at all is wrong). On all 85: 95.7% / 99.7% / 99.9% of lines within
0.1 / 0.25 / 0.5 s, and 77 of 85 cases with at least 99% within 0.25 s. There is no "before" for
the new cases as a set; the edge-jump cases alone were at 85% to 97% before the last change.

**Never worse than untouched:** the bench now compares every fit with the subtitle left as it is
and prints any case where the fit is worse. Result: 0 of 85. In all 6 "wrong film" cases the check
gives no answer, so the subtitle stays untouched.

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
   outside the pieces. Result: 17 of the 18 made-up jump cases at 99.7% to 100% (12 exactly 100%).
3. **Small differences (0.1 to 0.4 s) between pieces** were replaced by one shift, which made a real
   pair worse than untouched. Now each part follows the pieces around it.
4. **A single jump near the start or the end** (a recap, another opening) was invisible: the two
   pieces in the middle agreed, and the first or last minutes stayed wrong (85% to 97% of lines
   right). Now one piece at the start and one at the end are **always** read: the minute nearest
   to the edge that has at least 14 lines, and a second place only when the first gave nothing.
   Result: 8 of the 9 edge cases at 99.7% to 100%.
5. **A steady drift that is no known frame rate** was searched for jumps (20 pieces read, 80.8% in
   one case). Now points that lie on one line end the search. Result: 100% within 0.25 s with 4 to
   5 pieces.
6. A found jump was read again and again until the pieces ran out (a bug of the first fix); fixed.

Real pairs (share of anchor lines within 0.25 s):

| Pair                             | Untouched | Before | After | Floor |
| -------------------------------- | --------- | ------ | ----- | ----- |
| Inception DVDRip on BluRay video | 0%        | 89.1%  | 99.1% | 99.3% |
| Inception BluRay on DVDRip video | 0%        | 84.5%  | 99.1% | 99.3% |
| Matrix YTS on SiLU video         | 87.4%     | 80.2%  | 94.0% | 94.5% |
| Matrix SiLU on YTS video         | 87.4%     | 64.3%  | 94.5% | 94.5% |
| Breaking Bad WEBRip on BluRay    | 0%        | 89.8%  | 89.2% | 90.3% |

All 10 real cases together (5,082 anchor lines): 94.9% within 0.25 s, against a floor of 95.3%.
The Inception pair really has three jumps (-0.3 s, -0.55 s, +1.5 s, +1.43 s along the film).

**One small step back, stated plainly:** the Breaking Bad pairs were at 89.8% / 90.6% after the
first fix and are at 89.2% now. Reading the start and the end gives four pieces instead of two,
their shifts differ by 0.1 to 0.4 s (the two authors timed lines differently), and following those
small differences added a little noise there, while it helped the Matrix pairs. Both numbers are
within about a point of the floor, and far from untouched (0%). Not tuned further, on purpose: a
threshold fitted to these three films would not prove anything.

What remains, and why:

- A jump in the last minutes of an episode whose ending has too few lines in any one minute to be
  compared (1 case of 9: 97%, the body of the film is right, the last 3% of lines keep the body's
  shift). Still far better than untouched (0%).
- Frame rate + 25% missing lines + other language + noise on a 2.5 h film: no answer from this
  check on one of three films (unchanged); the subtitle is left as it is and the sound check
  takes over. On another film the same change now reaches 97.4%.
- The 8 cases still under 99% within 0.25 s: the 6 real pairs that sit at their floor (89.2% to
  94.5% against a floor of 90.3% to 94.5%), and the two cases above.
- Cost, measured in pieces of one minute read from the video: a plain shift reads **4 now, 2
  before** (the start and the end are always read); a frame-rate stretch 3 to 4 (5 to 8 before);
  a jump 4 to 17 (4 to 5 before, with a wrong result); the real Inception pair 20. At most
  2 + 3 + 4 + 16 pieces, and no new piece for narrowing a jump after 2.5 minutes.

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

### The fix, and its A/B (2026-11-11)

The answer schema now states the exact number of lines (`minItems` / `maxItems`), so the model
cannot close the list early. `scripts/research/id-ab.ts` sent the same 8 parts (80 lines each) of
Breaking Bad S01E01 three times each way, in turn, one request every 5 s, to
`gemini-3.5-flash-lite`:

|                                     | Without the count       | With the count     |
| ----------------------------------- | ----------------------- | ------------------ |
| Answers                             | 23 (1 more failed: 503) | 24                 |
| Answers that ended early            | 2 (40 of 80 lines each) | 0                  |
| Lines missing                       | 80 of 1,840 (4.3%)      | 1 of 1,920 (0.05%) |
| Answers with extra (repeated) lines | 2                       | 0                  |
| Answers with a mistyped id          | 0                       | 1 (`>53` for `53`) |
| Answers right in every id           | 19 of 23 (83%)          | 23 of 24 (96%)     |

Together with the earlier runs: early endings in 4 of 48 answers without the count, 0 of 26 with
it. The sample is small, so a chance result is not excluded (roughly 1 in 6), but the cause is
mechanical: with the count the model is not allowed to end the list. One more observation backs
it: `gemini-3.1-flash-lite` ended one of two plain answers early (20 of 80 lines) and none of two
counted ones.

Limits found while testing:

- Gemini **refuses** a count that is too high: 120 was accepted; 128, 129, 130, 140, 160 and 200
  gave HTTP 400 "invalid argument". The count is therefore sent only for parts of up to 100 lines
  (100 was accepted by all three models of the fallback list); the default part is 80 lines. A
  bigger part (`CHUNK_SIZE` above 100) works as before, without the count.
- Safety net: if a model answers HTTP 400 to a counted request, the same request is sent once
  more without the count (never when the 400 is about the key).
- A mistyped id (1 of 1,920 lines) is not prevented; the pipeline asks for that one line again.
- After the change, a whole file through the app's pipeline: 672 lines, 9 of 9 full answers
  complete, 0 lines untranslated.
- Not measured: whether translation quality changes with the count (no reason to expect it; the
  texts were not compared).

## Recommendation

- Both fixes pass all tests and are clearly better in the measurements, but nothing was checked
  on a real video in Stremio. Merge after one real check: a video that has its own subtitle track
  (timing) and one normal translation (line count).
- The risk of the line-count fix is low: a refused request falls back to the old request.
- The risk of the timing fix: in a video with jumps the check reads more pieces than before
  (up to 20 one-minute pieces were measured), so it takes longer in exactly those cases.
