# TTT Sub: AI Subtitle Translator for Stremio

A real-time AI subtitle translator for [Stremio](https://www.stremio.com/). When you play a movie
or episode it offers a subtitle in your language (Hebrew by default). If OpenSubtitles already has
one it is used directly; otherwise a source subtitle is downloaded, translated by AI (Gemini, Claude or OpenAI),
validated, cached and served to the player.

> **Version 1 is a local, single-user app.** It runs on your own computer at `127.0.0.1` and is
> designed for Stremio desktop.

> Not affiliated with Stremio. License, third-party code and the Windows "blue window" warning:
> see [LEGAL.md](LEGAL.md).

## Key features

- **Real-time translation** - subtitles are translated on demand while you watch; later plays are
  instant from the cache.
- **Smart source lookup** - search by file hash, then IMDb/TMDB id, then title text; anime
  (`kitsu:` / `tmdb:` ids) is supported and results are filtered to the right season and episode.
- **RTL punctuation fix for Hebrew** (and Arabic/Persian) - per-line Unicode marks keep `. , ? !`
  on the correct side of the line, including two-line subtitles and `<i>` tags.
- **Natural punctuation** - the prompt mirrors the source, so translations do not get a period on
  every fragment.
- **Responsive local GUI** - a five-step setup wizard plus a dashboard with a settings drawer
  (Tailwind CSS) for keys, language, connection tests, and install (button and copyable URL).
- **Caching and resilience** - file cache, background jobs with an "in progress" placeholder, and
  chunked translation that resumes after failures.
- **Validation** - deterministic code owns parsing, timestamps and IDs; the AI only translates text.
  Since v1.4.4 it also silently removes stray letters from a foreign alphabet (for example an
  Arabic letter inside a Hebrew word) unless the source line had them; no retry is needed. Latin
  names and brands are always kept. Since v1.5 this covers every alphabet (Georgian, Ethiopic, Bengali and
  so on), and subtitles that were saved earlier are cleaned the next time they are requested.
- **Fast and adaptive** (v1.4.4) - 80 lines per request and 4 requests at once, with no fixed
  delay. Only a 429 / 503 from the provider makes the app pause all requests together and slow
  down briefly; it speeds up again once the provider recovers.
- **Better gender accuracy** (v1.4.4) - each request also carries the next few source lines, and the
  prompt tells the model to infer gender from pronouns and names, stay consistent, and use
  gender-neutral wording when it is truly unknown. Translations made with older versions are
  re-made (the prompt version is part of the cache key).

## Requirements

- Node.js 22 or newer (`node -v`)
- An AI API key: [Google Gemini](https://aistudio.google.com/apikey), Anthropic Claude or OpenAI
  (the app finds out which one by asking the providers when you save the key)
- A free [OpenSubtitles.com](https://www.opensubtitles.com) account and an API consumer key
  (create one at https://www.opensubtitles.com/en/consumers)
- Stremio desktop

## Run from source (developers)

```powershell
npm install
Copy-Item .env.example .env     # macOS/Linux: cp .env.example .env
notepad .env                    # fill in the keys, save, close
npm start
```

In `.env` set `AI_API_KEY`, `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME` and
`OPENSUBTITLES_PASSWORD` (the account login is required for downloads). Every option is explained
in [`.env.example`](.env.example). You can also paste the keys on the config page instead.
The RTL punctuation fix for Hebrew/Arabic is always on (`RTL_FIX=false` turns it off). The live status
card shows "Translated X out of Y lines (Z%)" with a progress bar for the current subtitle.

Then open http://127.0.0.1:7000/ . Success looks like
`Open http://127.0.0.1:7000/ in your browser` in the terminal. Stop with Ctrl+C.

> ## Security: never share your keys
>
> **Never upload, commit or share your `.env` file or your API keys.** `.env`, `settings.json`,
> `data/` and `logs/` are listed in `.gitignore` - keep it that way. If a key ever leaks, revoke
> it at the provider and create a new one. Keys are never shown on the config page, written to
> logs, or put in URLs.

## Desktop app (Windows installer, no console window)

1. Run `Stremio-AI-Subtitle-Translator-Setup-<version>.exe` and wait; the app opens by itself.
2. Paste your keys into the **API keys** card in the window and press Save. Success looks like
   a "Saved" message; the keys are never shown again.
3. The window has its own title bar. The **X** asks "Close the Translator?": **Minimize to System
   Tray** hides the app (bottom-right, near the clock) and translations keep running; **Quit
   Program** stops the add-on. Right-click the tray icon for **Open the translator**, **Pause
   translation** / **Resume translation**, the **time until fully translated** (sound sync
   included), **Start with Windows**, and **Quit**.
4. Continue with **Install in Stremio** below, using http://127.0.0.1:7000/manifest.json.

Keys, `settings.json`, `data/` and `logs/` live in your user profile folder
(`%APPDATA%\stremio-ai-subtitle-translator`), not next to the app and not in the installer.
Windows SmartScreen may warn about an unsigned app: choose **More info -> Run anyway**.
Uninstalling keeps that folder; delete it to remove your saved keys.

Updates: the installed app checks GitHub Releases for a newer version at start and every 6 hours,
downloads it quietly and installs it when you quit. When a download finishes, a blue **Update**
button appears in the top bar: click it to restart and install right away. **Settings &rarr;
Check for updates** checks on demand. The first launch after an update shows a one-time
**What's new** popup (notes live in `src/electron/whatsNew.ts`; add an entry per release). To publish one, raise `version` in
`package.json`, run `npm run dist`, and upload the installer plus `latest.yml` (both in `release/`)
to a new GitHub release tagged `v<version>`. Or let `npm run publish` do it: it builds and uploads
the release to GitHub using `GH_TOKEN` from `.env` (a token with repo access; never commit it).

Build it yourself (Node.js 22+): `npm run dist` writes the installer to `release/`.
`npm run desktop` opens the app without packaging.

## Install in Stremio

1. Keep the desktop app (or `npm start`) running.
2. Open http://127.0.0.1:7000/ and click **Install in Stremio**. It opens Stremio Web in your
   browser: sign in to the same Stremio account, allow the browser's one-time "access this
   computer" prompt (Chrome), and click Install. The add-on then shows up in the Stremio app
   (reopen it if it does not appear after a minute). Tested in Chrome only. Manual alternative:
   Stremio -> Add-ons -> paste `http://127.0.0.1:7000/manifest.json`. (A `stremio://` link cannot
   work here: Stremio turns it into https and drops the port.) The same **Install in Stremio**
   button and the add-on address with a **Copy** button are also at the bottom of the main
   screen, so you do not need to reopen the setup wizard.
3. Play a movie or episode, open the subtitles menu and pick the entry labelled by this add-on.
4. If it says **"Translation in progress - reselect this subtitle in a minute"**, wait and select
   it again. A full episode usually takes 1-5 minutes the first time.

The subtitle list answers immediately with a local link. Opening it waits up to `SUB_WAIT_MS`
(15 s) for the job and otherwise shows the placeholder. A translation that fails part-way resumes
from the finished parts on the next attempt.

## Config page

The page uses a focused, warm-dark design: one centered card at a time. The interface is in
**Hebrew (right to left) or English (left to right)**: Hebrew by default, switch in **Settings →
Interface language** (or the small language button above the wizard). Everything the page shows
follows the choice: buttons, error and test messages, the What's new notes and the tray menu. The
server, its logs and the Stremio placeholder subtitles stay in English. Button names below are
the English meaning. Every release adds its What's new notes in both languages
(`src/electron/whatsNew.ts`), and every screen text lives in `src/web/i18n.ts` with both languages.

- **Setup wizard** (shown on first run, or while a key is missing). Five steps with a progress bar
  at the top; **Back** / **Continue** move between them:
  1. **AI key** - paste any Gemini, Anthropic or OpenAI key. **Continue** checks it with a free
     "list models" request to the providers (the one that looks most likely first; a wrong guess
     means the key is also sent to the other providers, which refuse it). The first provider that
     accepts it is saved to `.env` and used from then on with a fixed model
     (`gemini-3.5-flash-lite`, `claude-haiku-5-5`, `gpt-4o-mini`). If all refuse it, nothing is
     saved and an error is shown. Buttons open the pages where each key is created (Gemini and
     OpenSubtitles are marked Free) in your normal browser.
  2. **OpenSubtitles** - API key, username and password (saved to `.env`, never shown again).
  3. **Language** - target language and **Dual Subtitles** (original line on top, translation
     below it; saved to `settings.json`).
  4. **Test** - **Test AI provider**, **Test OpenSubtitles** and **Translate built-in sample**.
  5. **Install** - the install button and the copyable manifest URL. **Finish** opens the dashboard.
     If you open the wizard again from Settings, **Cancel - back to the main screen** on step 1 leaves
     it without changing anything.
- **Dashboard** ("All set"): live state, progress of the current subtitle file, lines translated
  this session, target language and dual-subtitles setting, and the **Connection checks**
  (Test AI provider, Test OpenSubtitles, Translate built-in sample). A meter shows how many of
  the account's OpenSubtitles downloads were used today (for example 10 / 20; a free account has
  20 per day). It is read from OpenSubtitles at most every 10 minutes and after each download,
  and is hidden when it cannot be read.
- **My subtitles** (button on the dashboard): every subtitle translated so far, grouped by title -
  series by season and episode, movies together. Tick what to delete (a whole series, a season or
  single episodes), or use **Select all** / **Delete all**; a confirmation always comes first. A
  deleted subtitle is translated again the next time you play it. Downloaded source files are kept,
  so no OpenSubtitles download quota is lost. Each row says whether its timing is **exact** (taken
  from the video itself, or a file-hash match) or **estimated** (an OpenSubtitles subtitle that may
  belong to another version of the video: if it is off, try another stream or shift it in Stremio's
  player). The list stores titles and numbers only
  (`data/library.json`), never subtitle text.
- **Settings** (button on the dashboard) opens a side drawer: key status (configured/missing, never
  the values), fields to replace keys, language, dual subtitles, **Clear Translation Cache**
  (deletes saved translations; downloaded sources are kept), **Run setup again**, and (desktop app)
  the version and **Check for updates**. **Save** stores everything and shows a toast.
- **News bell** (top of the wizard and the dashboard): messages from the author to everyone who has
  the app, plus the release notes of every version. A dot with a number marks what is new; opening
  the bell marks it as read, and everything stays listed. The release notes are always in your
  interface language. When there are no messages from the author, only the release notes are shown.

### Posting a message to every user (for the author)

The messages live in `news.json` in this repository. The app downloads that one small file from
GitHub (`raw.githubusercontent.com`) at most every 30 minutes and keeps the last copy for offline
use; nothing about the user is sent. Text only (no HTML), links must be `https`. To post one:

```powershell
npm run news -- --he-title "כותרת" --en-title "Title" --he "ההודעה בעברית" --en "The message in English"
git add news.json
git commit -m "news: <short title>"
git push
```

Optional: `--link https://...` adds an Open button. Users see it within about half an hour after the
push. Newest first; at most 50 messages are kept. To turn the feature off on one computer, set
`NEWS_ENABLED=false` in `.env` (the bell then shows only the saved copy and the release notes).

The page makes no third-party requests: Tailwind CSS is built locally into
`src/web/tailwind.generated.css` and inlined (`npm start` rebuilds it automatically; run
`npm run build:css` after editing `src/web/html.ts`). The server only listens on `127.0.0.1`, so the
manifest URL works on this computer only.

## Anime and other ID types

Search order (each step runs only if the previous found nothing):

1. File hash (`videoHash` from Stremio) - best sync
2. IMDb or TMDB id (with season/episode)
3. Text search by title: the playing file's name, then the title from Kitsu (kitsu ids) or
   Cinemeta (IMDb ids)

### Subtitles that ship with the video (exact timing)

When a video plays through Stremio's own streaming server (torrents), the add-on first looks for a
subtitle that ships with that exact file: a **text track stored inside the video file**, or a **subtitle file in the same torrent** (for example Subs/<video name>/2_English.srt). Either matches
the release, so it has no timing drift and needs no OpenSubtitles download. How it works:

1. The add-on asks Stremio's local server (`http://127.0.0.1:11470`) which torrent file has the
   playing file's name (Stremio sends it with the request).
2. It reads the file's subtitle tracks with `ffprobe` and `ffmpeg`, which are installed with
   Stremio (`%LOCALAPPDATA%\Programs\Stremio`). Set `FFMPEG_PATH` in `.env` to use another copy.
3. A track in your target language is served as is; otherwise an English track is translated.
   Forced and commentary tracks are skipped, and full-dialogue tracks (the smaller file) are\n preferred over SDH ones. Subtitle files in the torrent need no ffmpeg.
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

### Ask before translating (optional)

**Settings > Translation > Ask me before translating** (or `TRANSLATION_MODE=ask` in `.env`). The default,
`auto`, translates as soon as Stremio asks. In `ask` mode a new request is only noted: the player shows
"Received...", the desktop app shows a notification, and the main screen lists it in the **translation
queue** with **Translate** and **Cancel**. After you press Translate, reselect the subtitle in Stremio.
Choosing another episode replaces a request that is still waiting. A subtitle that was translated before
is served at once without asking. Cancel also stops a translation that is already running (it stops
before its next request to the AI). After a cancel, reselecting the subtitle in Stremio starts the
translation again once 20 seconds have passed (Stremio's own immediate re-ask is ignored). Up to 4 translations run at once (`MAX_CONCURRENT_JOBS`).

**Skip a slow step.** While the app looks for a subtitle inside the video, or listens to the video
(precise sync), the queue line on the main screen shows a **Skip** button. It gives up that step and goes
on to the next one: the video's own subtitle, then listening, then the download from OpenSubtitles. Which
steps run at all is set in Settings (embedded subtitles).

**First subtitle source.** Under Translation you can choose which source is preferred first:
SubDL (the default) or OpenSubtitles. SubDL needs a SubDL key (Accounts and keys); without a key
OpenSubtitles is used. SubDL has no file-hash match, so its timing is less exact, but it does not use
up the OpenSubtitles daily downloads. The full order (with Jimaku) is under Developer settings.

**Settings.** The panel opens from the start side of the window (the right in Hebrew, the left in
English) as one column of categories: Accounts and keys, Translation, Maintenance and
About. All are closed at first; tap one to open it (opening one closes the others). The version and the
update check are in About, and so is **Developer settings** (a box inside About).

**Test mode (About > Developer settings).** Turn it on to try the queue, the buttons and the
diagnostics without playing a video. "Run a test request" adds a made-up episode to the real queue. No
OpenSubtitles and no AI are used (no quota is spent): a random subtitle is picked and every line gets the
prefix `HE:`. Besides the built-in samples, it picks from any `.srt` files you put in the `test-subtitles`
folder inside the app's data folder (`data\test-subtitles` when run from the project). Test subtitles are
not added to the library. While test mode is on, real translations are paused, so turn it off when done.

### Start with Windows, and pausing

Desktop app only. **Settings &rarr; General** has two switches: **Start the app with Windows** and
**Start minimized** (only the tray icon, no window). The second is greyed out until the first is on.
The last step of the first-run wizard asks the same two questions, and the tray menu has the first
switch too. The choice is kept in the Windows login item plus `startup.json` in the app data folder.
It does nothing when the app is run from source (`npm run desktop`); only the installed app can
start with Windows.

The tray menu's **Pause translation** stops sending new parts to the AI until you press **Resume
translation**. Parts already sent finish; the sound check is not paused. The main screen shows the
time left for the translation and a total that includes the sound check, as estimates from the
speed so far.

The SubDL and Jimaku checks (wizard and main screen) appear only once a key for them is saved.

### The Continue button

The main screen has a **Continue translation** button. It can always be pressed (it says so when there is nothing to continue).
It is highlighted when a request was cancelled or failed, or when a translation has had no news from the
AI for 12 seconds (for example a request that is not answered). Pressing it cuts the stuck request
and asks again, or starts the cancelled request again from what was saved: parts that were already
translated are not translated twice.

While the subtitle is not ready, the player shows what is happening (for example `Translating the
subtitles… 45%`) in the interface language instead of one fixed sentence.

### Speaker names and sound notes are removed

Subtitles made for the hard of hearing contain more than speech: who is talking (`KATARA: Water.`)
and sounds (`(groans)`, `[door slams]`). Before translating, the add-on removes a capital-letter
speaker label at the start of a line and a short note in brackets at the start or end of a line, and
deletes a line that was only a sound. Words inside a sentence are never touched. Credit lines such
as "Translated by ..." or a site's advert (`www.opensubtitles.org`) are deleted too. Turn it off in
**Settings → Remove speaker names and sound notes from subtitles** (or `CLEAN_SUBTITLES=false`).

### Long films: the first part is shown while the rest is translated

For a file of 1000 lines or more, the add-on does not make you wait for the whole translation.
When the first quarter of the lines (counted from the start) is translated, that part is given to
Stremio at once. A last line runs from the end of the part to the end of the film and says
"the translation continues in the background, reselect the subtitles in a few minutes". The
translation goes on, and when it is done the main screen shows the usual "better subtitle is
ready" notice. Select the subtitle again and Stremio gets the whole film from the saved copy. The
part is never saved or listed in **My subtitles**: only the finished subtitle is. If the translation
stops half way (no quota, for example), the part stays and the note says it stopped. If the sound
check finishes late, the same timing move is applied to the part and to the whole subtitle. Turn it
off with `PARTIAL_SUBTITLES=false` in `.env` or `"partialSubtitles": false` in `settings.json`.

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

## Commands

| Command                 | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `npm start`             | run the add-on (`npm run dev` restarts on code changes) |
| `npm run check`         | format check + lint + type-check + tests                |
| `npm test`              | tests (free; all external APIs mocked)                  |
| `npm run test:live`     | one tiny real request per provider (uses your keys)     |
| `npm run cache:cleanup` | remove expired/corrupt cache entries                    |

To force fresh translations (for example after changing prompts) delete the cache:
`Remove-Item data\cache\*.json`.

Translate a file of your own:

```powershell
curl.exe -X POST --data-binary "@my.srt" "http://127.0.0.1:7000/dev/translate?lang=he" -o out.srt
```

## Privacy

Subtitle dialogue is sent to the AI provider that matches your key (Google Gemini, Anthropic or OpenAI). Provider quotas, billing and free-tier
data-use terms are controlled by Google and OpenSubtitles, not by this add-on. Logs never contain
keys or (by default) dialogue.

## Security notes

- Binds to `127.0.0.1` only; rejects foreign `Host`/`Origin` headers; strict CSP (`default-src 'none'`, nonce-only
  scripts and styles, no external sources); no CORS.
- Secrets live only in `.env`; a scan of tracked files, git history, logs and cache found none.
- `path-to-regexp` is pinned to the patched 0.1.13 via `overrides`. Remaining `npm audit` findings
  (`tmp` via the Stremio SDK's interactive CLI scaffolding) are code this add-on never loads; the
  suggested `npm audit fix --force` would downgrade the SDK, so it is not applied.
- No Dockerfile on purpose: the server is hard-wired to localhost, and exposing an unauthenticated
  page that holds API keys is unsafe.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if something does not work.

## Adding another translation provider

Implement `TranslationProvider` (`src/translation/provider.ts`): `testConnection`,
`translateChunk`, `getProviderName`, `getModelInformation`, `normalizeError` (map errors to
`AppError` codes; mark transient ones retryable), then return it from `createProvider`. The
pipeline, validation and cache do not change.

## Roadmap (not implemented)

Public deployment: HTTPS hosting, per-user bring-your-own-key with keys encrypted at rest, opaque
config ID in the manifest URL, authentication, rate limiting, SSRF hardening and quotas.

## License

[MIT](LICENSE)

## Documentation used

- [Stremio subtitles handler](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models) and
  [structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [`@google/genai`](https://github.com/googleapis/js-genai)
- [OpenSubtitles REST API](https://opensubtitles.stoplight.io/docs/opensubtitles-api)

### Save a video with the subtitle inside

In **My subtitles**, each subtitle has two buttons: **Subtitles** (downloads the SRT file) and, in the desktop app, **Video** with a small menu. **MKV** (computer and TV) saves the video with the subtitle inside. When
the video is not available in Stremio right now it asks you to choose the
video file you have on this computer (the window says so), then saves a copy next to it (`Name.heb.mkv`) with the
translated subtitle as an extra, switchable track. Picture and sound are copied as they are (no
re-encoding, so it takes seconds and loses no quality) and the original file is never changed or
overwritten. It uses the ffmpeg that comes with Stremio. The subtitle is the first track and is set
as the default one.

The **MP4** choice in the same menu makes the same copy as an MP4
(`Name.heb.mp4`). iPad, iPhone and many phones play MKV only in an app such as VLC, but they open an
MP4 in the built-in player, where the subtitle shows under the subtitles button (choose Hebrew; it is
not switched on by itself). The MP4 keeps only the translated subtitle (not the other subtitle
tracks), copies the picture (HEVC is tagged `hvc1`, which Apple players need), and copies the sound
when it is AAC, AC3, E-AC3, MP3 or ALAC, otherwise it converts the sound to AAC. Videos in other
picture formats (such as VP9 or AV1) may not play on an iPad even as MP4. Not every player shows
Hebrew punctuation in the right place; VLC is the fallback.

While a video is being saved, a thin bar under the episode row shows the progress, the time left
(an estimate), and how much has been written. **Cancel** stops it and removes the half-written file.
When it is done the row shows "The video is ready" with the file size, a **Show in folder** button
and a close button. The video menu shows the approximate size next to MKV and MP4 when Stremio's
server knows the file size.

### Timing labels in My subtitles

Each saved subtitle can carry a timing label: **Exact timing** (green, a check mark: the video's own
subtitle or an exact match), **Timing by speech** (blue, a sound wave: fitted to the voices) and
**Estimated timing** (orange, a wave: a guess, worth checking).

### Removing a key

In Settings, Accounts and keys, every set key (AI, OpenSubtitles key, OpenSubtitles login, SubDL,
Jimaku) has a small x inside its "Set" label. It asks "Remove the key?" before clearing it from the
local `.env` file. Password fields show the eye button only after you type something.

### Trying changes without installing the app

For quick tests, run the add-on straight from the project folder instead of building and installing
the desktop app. Close the installed app first (both use port 7000), then in PowerShell:

```powershell
cd "D:\TTT Sub"
npm run dev
```

Open http://127.0.0.1:7000/ in your browser. `npm run dev` restarts by itself when a file changes
(`npm start` runs once). It reads the keys from `.env` and keeps its data in the project folder, so
the installed app's settings are not touched. Stremio uses the same add-on address
(`http://127.0.0.1:7000/manifest.json`), so nothing needs reinstalling in Stremio. Buttons that only
exist in the desktop app (such as saving a video file) are not shown in the browser.

**Copy diagnostics** (Settings, Advanced) copies a short report: setup as yes/no, whether Stremio's
server and ffmpeg are found, a table of the last 5 videos (where each subtitle came from, how sure
its timing is, what the sound check did, time, lines) and the log lines of the latest video only
(sources, timing numbers, warnings). No keys, no subtitle text, no titles (only IMDb ids and
season/episode). Open `/api/diagnostics?scope=all` to see every recent line instead.
