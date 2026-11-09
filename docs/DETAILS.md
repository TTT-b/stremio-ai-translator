# TTT Sub: details and settings

Reference material moved out of the main README. For the short guide, see [README.md](../README.md).

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
4. If it says **"TTT Sub: Translating... when it is done, select the subtitle again"**, wait and select
   it again. A full episode usually takes 1-5 minutes the first time. If it fails the player says
   "TTT Sub: No subtitle found for this episode" or "TTT Sub: Something went wrong. Open the app for
   details" (the reason is in the app). The desktop app shows a Windows notification once when a translation fails
   and one when the final subtitle is ready and you need to select it again (only if it actually changed;
   nothing when the timing was already right, and nothing while it is translating). The status card says
   whether the timing was moved, was already in sync, could not be verified, or the video was not found.

The subtitle list answers immediately with a local link. Opening it waits up to `SUB_WAIT_MS`
(15 s) for the job and otherwise shows the placeholder. A translation that fails part-way resumes
from the finished parts on the next attempt.

## Config page

The page uses a focused, warm-dark design: one centered card at a time. The interface is in
**Hebrew (right to left) or English (left to right)**: Hebrew by default, switch in **Settings →
Interface language** (or the small language button above the wizard). Everything the page shows
follows the choice: buttons, error and test messages, the What's new notes and the tray menu. The
server and its logs stay in English; the Stremio placeholder subtitles follow the interface language. Button names below are
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
  so no OpenSubtitles download quota is lost. A saved subtitle is deleted automatically 90 days
  after it was made (checked at start and once a day). Names of characters and places are
  remembered per series (`glossary.json` in the data folder, small and capped) so they are spelled
  the same way from the second episode on. Each row says whether its timing is **exact** (taken
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

The page makes no third-party requests: Tailwind CSS is built locally into
`src/web/tailwind.generated.css` and inlined (`npm start` rebuilds it automatically; run
`npm run build:css` after editing `src/web/html.ts`). The server only listens on `127.0.0.1`, so the
manifest URL works on this computer only.

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

**Cancel and Skip after the subtitle was delivered.** The two buttons stay on the main screen as long as
anything still runs in the background. **Skip** ends only the search inside the video (the sound check goes
on); **Cancel** ends everything, the search and the sound check. The **Sync to sound** button shows only
when the automatic check did not already confirm the timing of the latest subtitle.

**Main screen.** The top card names what is translating now (series, season and episode) with the
progress, lines and time left, and shows "Next in line" when another episode waits. One **Test all**
button checks every configured provider (AI, OpenSubtitles, SubDL, Jimaku) and "Details per provider"
shows which one passed or failed. The install box is collapsed to one line.

**First subtitle source.** Under Translation you can choose which source is preferred first:
SubDL (the default) or OpenSubtitles. SubDL needs a SubDL key (Accounts and keys); without a key
OpenSubtitles is used. SubDL has no file-hash match, so its timing is less exact, but it does not use
up the OpenSubtitles daily downloads. The full order (with Jimaku) is under Developer settings.

**Settings.** The panel opens from the start side of the window (the right in Hebrew, the left in
English) as one column of categories: Accounts and keys, Translation, Maintenance and
About. All are closed at first; tap one to open it (opening one closes the others). The version and the
update check are in About, and so is **Developer settings** (a box inside About).

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

### Fully automatic: limits, retries and one notice (v2.0)

- A per-minute Gemini limit only slows the work down (the app paces itself and keeps the same model).
  A daily limit is recognised too: the app waits by itself until the quota resets (midnight Pacific
  time, plus a short margin) and continues, with no Continue button. Overloaded or timed-out requests
  are retried after 1, 5 and 15 minutes. The main screen shows the time left.
- Windows shows one notice when the subtitle is finished. When a timing check from the video's sound is
  still running, the notice waits for it (at most 10 minutes), so you get one notice, not two.
- The bar of the sound check counts the planned two pieces, so it no longer stops at a third and jumps to
  the end when the answer comes early.
- My subtitles: rows and buttons wrap on narrow windows instead of running off the screen.

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

## Save a video with the subtitle inside

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

### Choosing the translation model

Settings, Translation, has a "Translation model" section. Its title names the AI
provider detected from your key (Google Gemini, Anthropic Claude or OpenAI); the icon is a generic AI sparkle. The list of models
is read from the provider with your own key (button **Refresh list**) and is cut down to a short
list of stable text models (no previews, "-latest" aliases or image/audio variants; newest
first); for OpenAI the filter is a best guess by name. The pick is saved per provider
and used for new translations. It is part of the cache identity, so a subtitle already translated
with another model is translated again. For Gemini there is also **Switch model automatically
when it is busy** (on by default): if the chosen model is overloaded, rate limited, out of quota
or does not exist for your key, the app moves to the next model of a short built-in list for the
rest of that translation and tells you on the main screen. If every model fails it waits and
starts again from the chosen one. Anthropic and OpenAI keep the model you picked.

While the provider is overloaded (5xx, 429), parallel requests shrink to one at a time and grow
back after successful requests.
