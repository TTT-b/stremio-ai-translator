# TTT Sub: subtitle sources, timing and developer settings

Reference material moved out of the main README. For the short guide, see [README.md](../README.md).

## Anime and other ID types

Search order (each step runs only if the previous found nothing):

1. File hash (`videoHash` from Stremio) - best sync
2. IMDb or TMDB id (with season/episode)
3. Text search by title: the playing file's name, then the title from Kitsu (kitsu ids) or
   Cinemeta (IMDb ids)

### Subtitles that ship with the video (exact timing)

When a video plays through Stremio's own streaming server (torrents), the add-on first looks for a
subtitle that ships with that exact file: a **text track stored inside the video file**, or a **subtitle file in the same torrent** (for example `Subs/<video name>/2_English.srt`). Either matches
the release, so it has no timing drift and needs no OpenSubtitles download. How it works:

1. The add-on asks Stremio's local server (`http://127.0.0.1:11470`) which torrent file has the
   playing file's name (Stremio sends it with the request).
2. It reads the file's subtitle tracks with `ffprobe` and `ffmpeg`, which are installed with
   Stremio (`%LOCALAPPDATA%\Programs\Stremio`). Set `FFMPEG_PATH` in `.env` to use another copy.
3. A track in your target language is served as is; otherwise an English track is translated.
   Forced and commentary tracks are skipped, and full-dialogue tracks (the smaller file) are preferred over SDH ones. Subtitle files in the torrent need no ffmpeg.
   Picture-based tracks (PGS) are not supported.
4. If anything is missing (no local stream, no ffmpeg, no text track) the normal OpenSubtitles
   search below runs, so nothing breaks. The whole lookup has a 30-second limit and a slow or
   half-downloaded file is skipped, never waited for. A subtitle made this way is only a guess for
   the timing, so it is checked again the next time Stremio asks (for example once the video is
   on Stremio's local server) and replaced by the video's own subtitle when there is one.

Turn it off in **Settings → Use subtitles embedded in the video file** (or `EMBEDDED_SUBTITLES=false`
in `.env`). `STREMIO_SERVER_URL` can change the server address; only `127.0.0.1` / `localhost` is
accepted. Look for `embedded subtitle` in the log (stage `SOURCE`).

### Second subtitle source (SubDL)

Optional. Save a free API key from subdl.com in **Settings > SubDL API key**. The add-on then also
looks for subtitles on SubDL (free, up to 300 downloads a day per IP) and uses them when
OpenSubtitles has none, or when OpenSubtitles says today's downloads are used up. OpenSubtitles stays
first; a subtitle that already exists in the target language on SubDL is used directly. SubDL
subtitles are zip files; the first `.srt` inside is used. A whole-season zip is opened too and the
file of the right episode is taken out of it (by `S02E05`, `2x05` or `- 031` in the file names; a wrong
episode is never guessed, and a pack that does not hold the episode is skipped). Season packs can be
switched off under **Developer settings**. SubDL appends the caller's key to the link of some results; only the
path is kept, so the key is never stored or sent on. The key
is stored like the other keys (`.env`, never committed) and is never logged. Look for
`OpenSubtitles limit reached, using another source` in the log (stage `SOURCE`). The key can also be added in
the setup wizard (step 2), and **Test SubDL** in the connection checks (shown only when a key is saved)
checks it. SubDL has no call that reports usage, so unlike OpenSubtitles there is no meter for it.
For the anime tried so far (Black Clover, Sword Art Online, Dragon Ball) SubDL only had one English
dub-caption `.ass` file per "season pack", so it did not help there.

### Third subtitle source (Jimaku, anime)

Optional. Save a free API key from jimaku.cc (account settings) in **Settings > Accounts and keys**
(`JIMAKU_API_KEY` in `.env`). Jimaku has one file per episode for anime, almost all in **Japanese**,
so it is the last resort (translating from Japanese is worse than from English): English and
target-language subtitles from the other sources always win. The search uses the title from the
file name (or Kitsu/Cinemeta) and the episode number; a file of another episode or show is dropped,
and a bare number such as `- 052` is trusted only for the first season (Jimaku numbers long anime
straight through, so "season 2 episode 1" would be the wrong file) unless the file name carries the
season. Files come only from `jimaku.cc` and are limited to 2 MB. Jimaku allows 25 requests a minute;
when it says "too many", nothing is found for that search.

### Order of the sources

Under **Settings > About > Developer settings > Order of the sources** the sources are ticked and ordered. The
recommended order is SubDL, OpenSubtitles, then Jimaku (a source without a key is skipped). All
sources are searched at once (a search costs no download) and the earlier one wins among otherwise
equal subtitles. An exact file match (hash) on OpenSubtitles always wins, a subtitle in your language
wins over a translation, English wins over Japanese, and a single episode wins over a season pack.
**Back to the recommended order** resets it; choosing the first source in the older Translation
dropdown also resets it.

### Where a subtitle came from, and the sound check on the main screen

Every line of **My subtitles** shows its source: `SubDL`, `OpenSubtitles`, `Jimaku` or `From the video`,
and whether it was `ready-made` (already in your language) or `translated from EN`. Both requests Stremio
makes for one episode are one line (their cache files are all deleted together). While the sound check
listens in the background, a bar on the main screen shows how far it is, and when it ends it says
whether the subtitle was moved (and by how many seconds) or the timing was left as it was. A line also
says which subtitle Stremio took last. The **Sync to sound** button next to Continue listens to the video that is playing and lines the latest subtitle up with it on request (the episode must be open in Stremio; if the video is not found on the Stremio server of this computer, it says so). The notices after a sound check go away by themselves after a minute, and have an OK button that closes them sooner,
and the "Open Stremio" button asks before it opens the program.

When several subtitles are found, the one whose release name is closest to the playing file is preferred (so it is more likely to be in sync). Reading the video's own subtitle track is tried when it should take up to about 3 minutes (the estimate comes from Stremio's download speed). The OpenSubtitles and SubDL password/key fields have an eye button to show what you typed.

### Developer settings (Settings > About)

Hidden for everyone by default. The author shows them by starting the app with the environment
variable `SHOW_DEV_SETTINGS=1` (for example in `.env`).

Everything here is saved at once and is meant for trying things:

- **Sound check:** _translate at once, check in the background_ (recommended and the default: the
  translation starts without waiting, and the subtitle is moved when the check finishes), _wait up
  to 30 s for the check before translating_, or _no sound check at all_.
  The check first compares the subtitle with the subtitle track inside the video, when it has one:
  it reads only two short pieces of that track (more where the two disagree), matches the lines by
  their start times and words, and moves the subtitle by what it finds (one shift, or a shift that
  changes along the video). Only when the video has no usable track does it listen to the sound.
  The diagnostics table marks this as `cue-match`.
- **Seconds to wait for the subtitle inside the video** (default 15).
- **Skip the subtitle inside the video if reading it would take more than N seconds** (default 60,
  0 = never). Reading a track means reading the whole video file (about as long as downloading
  it), so the app estimates it from the file size and the download speed Stremio's server reports
  (`downloaded`, `downloadSpeed` in `/stats.json`) and skips at once instead of waiting and competing
  with the playback for the connection. Subtitle files shipped beside the video are still read. When
  the speed is not reported nothing is skipped. Look for `reading the tracks inside the video would
take too long` in the log.
- **Season packs from SubDL** and **Translate the next episode ahead** (packs on by default; the next episode ahead is off, switch it on if you read many episodes).
- **Always translate from English with the AI** (off by default). Normally a ready subtitle in your
  language from any source is used as it is, with no AI work; this makes the app prefer an English
  subtitle and translate it, so the translation itself can be tried and compared.
- **Order of the sources** (see above).
- **Request the subtitles again, from scratch:** pick a saved subtitle and one source; it is made
  again from that source only (no look inside the video, saved copy ignored) and replaces the old
  one. The translation of identical text is reused, so it costs nothing again.
- **Test mode** (moved here from Advanced).

**The next episode ahead.** When a series episode is done, the next one (`S1E3` to `S1E4`) is searched
and translated in the background from a downloaded subtitle (SubDL / OpenSubtitles / Jimaku; there is
no video file yet, so nothing is read from it). It costs one download and one translation more, shows
in the queue and the library, never chains on to the one after, is skipped in ask mode, for movies and in
test mode, and a failure (for example the last episode of a season) is silent. When you open that
episode the downloaded subtitle and the translation are already saved, so only the search is repeated
and the wait for the video's own subtitle is cut to 3 seconds. Look for `translating the next
episode in the background` in the log.

**Test mode (About > Developer settings).** Turn it on to try the queue, the buttons and the
diagnostics without playing a video. "Run a test request" adds a made-up episode to the real queue. No
OpenSubtitles and no AI are used (no quota is spent): a random subtitle is picked and every line gets the
prefix `HE:`. Besides the built-in samples, it picks from any `.srt` files you put in the `test-subtitles`
folder inside the app's data folder (`data\test-subtitles` when run from the project). Test subtitles are
not added to the library. While test mode is on, real translations are paused, so turn it off when done.

### The video's own subtitle is not waited for long

The add-on looks for a subtitle inside the playing video first (exact timing). It waits for it for
about 15 seconds at most. After that it goes on with the best downloaded subtitle and checks its
timing against the sound of the video (below); if the video's own subtitle still arrives before the
translation starts, that one is used instead. The **Skip** button ends the wait at once.

If the video's own subtitle arrives only after the job has finished (the video was still loading), it
is translated in the background and replaces the subtitle Stremio shows, with no "translating" message
in between. Look for `subtitle upgraded to the exact timing` in the log. Reselect the subtitle in
Stremio once to load the better one. The main screen shows a notice (and the desktop app a notification) when that happens.

### Timing from the sound of the video (automatic, no download)

When a subtitle has only a guessed timing (no own subtitle in the video, no hash match), the add-on
listens to three short pieces of the playing video (about 12 minutes of a 24-minute episode, less
for a long film) with the ffmpeg that comes with Stremio. It marks when someone is talking and
compares that with when the subtitle is shown, in any language, with no speech model and no
download. If it is sure, it moves the whole subtitle by the missing seconds (and fixes a
frame-rate stretch such as 25 vs 23.976 fps). If it is not sure, the subtitle stays exactly as it
was. The **Skip** button on the main screen skips this step. Look for `subtitle moved onto the
speech` or `timing left as it was` in the log (stage `SOURCE`). On real episodes the result was
within about 0.1 second.

By default the translation does not wait for this check: it starts at once and the check goes on in
the background (**Settings > About > Developer settings > Sound check** can make it wait up to 30 seconds, or turn the
check off). When the check finishes and is sure, the finished subtitle is moved by the same amount
(no new translation), swapped in, and a notice tells you to select the subtitle again in Stremio.
If the video sends no sound for 45 seconds, the check gives up.

### Timing consensus (fewer out-of-sync subtitles)

When there is no hash match, the subtitle timing may belong to another release of the video.
The add-on can then download 3 subtitles in the same language, compare only their timing
(not their text), and use the one whose timing most of the others share. A hash match skips
this. Each uncached file counts against the OpenSubtitles daily download quota, which is small on
a free account, so the comparison runs only once OpenSubtitles has reported at least 30 downloads
left today; the first subtitle after a start downloads a single file. Look for `timing consensus`
in the log (stage `SOURCE`) to see the scores. This only runs when there is no subtitle inside the video file.
Offsets that change during an episode are not corrected for downloaded subtitles.

Preview what would be chosen (no download quota used):
`http://127.0.0.1:7000/dev/source-search?type=series&id=kitsu:49294:3` (optional `&filename=...`).
