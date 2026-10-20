# Troubleshooting

Logs are in the `logs` folder (`app-YYYY-MM-DD.log`). When asking for help, send the newest
log file - it never contains your keys.

## "Test Connection" fails

1. Read the message next to the button; it names the cause.
2. `Missing` / `not set` -> desktop app: paste the key in the **API keys** card and press Save.
   Command line: fill the variable in `.env`, then restart (Ctrl+C, `npm start`).
3. `API key was rejected` -> re-copy the key (no spaces or quotes). AI key: create a new one at the provider
   (Gemini: https://aistudio.google.com/apikey, Claude: console.anthropic.com, OpenAI: platform.openai.com). OpenSubtitles: check the consumer API key at
   https://www.opensubtitles.com/en/consumers.
4. `OpenSubtitles login failed` -> username/password are your opensubtitles.com account (not the
   API key). Try logging in on the website.
5. `model is unavailable` / `not available to this key` -> Google retired that model for new
   users. The app uses one fixed model, so install the latest version of the app (updates arrive automatically).
   5a. `quota or billing limit` with `prepaid credits depleted` -> the Google project behind your key
   has no credits. Open https://ai.studio/projects, check billing/credits for the project, or
   create a key in a different project. Newer (3.x) models need credits; 2.5 models are closed
   to new users.
6. `timed out` / `rate limiting` -> wait a minute and retry.

## No translation happens

1. Is the AI provider green on the config page ("Test AI provider")?
2. Click "Translate built-in sample". If that works, translation is fine and the problem is on the
   subtitle-source side.
3. Look at the main screen: while a subtitle is being made it says where it is (waiting in line,
   checking the video, searching OpenSubtitles, translating), and after a failure it says why.
   If it stays on one step for minutes, that step is the problem. Every step has a time limit
   (the lookup inside the video 30 s, the OpenSubtitles search 2 min, the whole subtitle 15 min),
   so a stuck step ends with an error instead of blocking everything.
4. Look in the log for `SOURCE_SUBTITLE_NOT_FOUND`, `SOURCE_QUOTA_EXCEEDED` or
   `TRANSLATION_VALIDATION_FAILED` (model kept returning bad output; lower `CHUNK_SIZE` in `.env`,
   e.g. 40; the default is 80). `SOURCE_QUOTA_EXCEEDED` means OpenSubtitles refused a download:
   either the daily limit is used up (a free account has 20 a day; the dashboard meter shows it, and
   the log line `subtitle downloaded` shows `remaining`), or, rarely, it refused because of too many
   requests at once, which the add-on spaces out and retries by itself. To keep going when the daily
   limit is used up, save a free SubDL key in Settings: the add-on then switches to SubDL.
5. Still stuck? In **Settings** press **Copy diagnostics** and send the text to the author. It lists
   the setup as yes/no (never a key), whether Stremio's server and ffmpeg are found, and the latest
   log lines (numbers and short codes only, no subtitle text).

## Stremio shows no subtitle

1. Is the add-on running (terminal open, config page loads)?
2. Is it installed? (Stremio -> Add-ons -> look for "AI Subtitle Translator".) Use the install
   button on the config page (it opens Stremio Web in the browser; sign in to the same account).
   "Failed to get addon manifest from https://127.0.0.1/manifest.json" means a `stremio://`
   link was used: use the button above or paste `http://127.0.0.1:7000/manifest.json` in
   Stremio -> Add-ons instead.
3. Stremio desktop sees the add-on after it syncs with your account; reopen it if it is missing.
4. Reselect the subtitle after a minute: the first request starts the translation.

## Subtitle out of sync

The translated file keeps the source file's timestamps exactly, so sync equals the source
subtitle's sync. In order of effect:

1. **Torrents through Stremio:** the add-on uses the subtitle stored inside the video file, or a
   subtitle file in the same torrent, when there is one (exact timing). Check the log for
   `embedded subtitle`; if it says `embedded subtitles skipped`, the reason is next to it
   (`not-local`: the file is not on Stremio's local server; `no-source`: the file has no text
   subtitle track and the torrent has no subtitle file for it; `ffmpeg: false` there means tracks
   inside the file could not be read because ffmpeg was not found, set `FFMPEG_PATH`). `retry` lines mean
   the video's tracks were found but the video is still loading: the add-on tries again every 10
   seconds for up to 2 minutes before it gives up and uses the next source.
2. For a torrent without its own subtitle, the add-on listens to a few short pieces of the video's sound and
   moves the downloaded subtitle onto the speech. The main screen shows "Syncing to the speech... N%".
   Log lines: `subtitle moved onto the speech` (done), `timing left as it was` (not sure, the subtitle is
   untouched), `not waiting longer for the video` (the video's own subtitle took more than 15 seconds).
   It needs the video to be on Stremio's local server and ffmpeg (see above).
3. Otherwise, when OpenSubtitles reports plenty of downloads left today (30 or more), the add-on
   compares 3 downloaded subtitles and uses the one most agree with (`timing consensus` in the
   log). With a small daily quota it downloads a single file to save the quota.

## Hebrew punctuation looks wrong

Symptoms: periods or question marks at the wrong end of a line. Since v1.4.2 the fix is always on
for Hebrew/Arabic/Persian. If you set `RTL_FIX=false` in `.env`, remove that line, restart, and
reselect the subtitle (old cached translations use a different key, so they are re-made).

## Odd letters in a translated word, or wrong male/female forms

- **Stray letters from another alphabet** (e.g. an Arabic, Georgian or Ethiopic letter inside a Hebrew word): since
  v1.4.4 (every alphabet since v1.5, also for subtitles saved earlier, no AI request needed) such letters are removed automatically from the translated line, with no retry (the log shows
  `removed stray foreign-script letters`). The word may then be missing one letter; reselect after
  **Clear Translation Cache** to redo it. If a line becomes completely empty, that part is translated again.
- **Wrong gender** (a woman spoken about as a man): the AI now also sees the next few lines and is told
  to infer gender and stay consistent, but it can still guess wrong, especially from Japanese
  sources, which have no gender in the grammar. An English source gives better results. Use
  **Clear Translation Cache** and reselect the subtitle to redo it.

## Slow or timed-out translations

Large models can take 30-90 s per chunk. The add-on retries, and finished chunks are kept, so
selecting the subtitle again continues where it stopped. Since v1.4.4 each request carries 80
lines (`CHUNK_SIZE`) and 4 requests run at once (`CHUNK_CONCURRENCY`, up to 6). If one request keeps
being slow or malformed, lower `CHUNK_SIZE` (for example 40) in `.env`, then restart.

## "Rate limited, waiting to retry..." / 503 overloaded / free-tier limits

Since v1.4.4 there is no fixed pause between requests (`CHUNK_DELAY_MS` defaults to 0), so a
translation runs at full speed. The app only slows down when the provider pushes back: on a 429
(rate limit / quota) or a 5xx such as 503 (overloaded) it pauses **all** parallel requests together
(5s, 10s, ... up to 60s, or the provider's own retry-after), spaces the following requests out
slightly, retries the same part instead of failing, and speeds up again after successful requests.
The live status card shows "Rate limited, waiting to retry...". It gives up after about 20 minutes
of waiting on 429s, or after 8 waits (about 5 minutes) on 503/timeouts; a truly exhausted daily
quota needs a new day or a billing-enabled key. Finished parts are cached, so reselecting the
subtitle continues where it stopped. If your free key is limited very tightly you can still set a
fixed pause with `CHUNK_DELAY_MS=4000` in `.env`.

## "No suitable source subtitle" for anime

1. Open `http://127.0.0.1:7000/dev/source-search?type=series&id=kitsu:<id>:<episode>` (use the id
   from the log line `subtitles requested`). `found=0` means OpenSubtitles has nothing matching.
2. Check the log lines `strategy=text title=...` to see which titles were tried.
3. A later season whose Kitsu title has no "Season N" is treated as season 1; if its subtitles are
   filed under another season number they are skipped on purpose (to avoid a wrong episode).
