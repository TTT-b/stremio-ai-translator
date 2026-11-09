# TTT Sub: for developers

Reference material moved out of the main README. For the short guide, see [README.md](../README.md).

## Run from source (developers)

```powershell
npm install
Copy-Item .env.example .env     # macOS/Linux: cp .env.example .env
notepad .env                    # fill in the keys, save, close
npm start
```

In `.env` set `AI_API_KEY`, `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME` and
`OPENSUBTITLES_PASSWORD` (the account login is required for downloads). Every option is explained
in [`.env.example`](../.env.example). You can also paste the keys on the config page instead.
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

### Requirements (from source)

- Node.js 22 or newer (`node -v`)
- An AI API key: [Google Gemini](https://aistudio.google.com/apikey), Anthropic Claude or OpenAI
  (the app finds out which one by asking the providers when you save the key)
- A free [OpenSubtitles.com](https://www.opensubtitles.com) account and an API consumer key
  (create one at https://www.opensubtitles.com/en/consumers)
- Stremio desktop

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

## Posting a message to every user (for the author)

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

See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) if something does not work.

## Adding another translation provider

Implement `TranslationProvider` (`src/translation/provider.ts`): `testConnection`,
`translateChunk`, `getProviderName`, `getModelInformation`, `normalizeError` (map errors to
`AppError` codes; mark transient ones retryable), then return it from `createProvider`. The
pipeline, validation and cache do not change.

## Roadmap (not implemented)

Public deployment: HTTPS hosting, per-user bring-your-own-key with keys encrypted at rest, opaque
config ID in the manifest URL, authentication, rate limiting, SSRF hardening and quotas.

## Documentation used

- [Stremio subtitles handler](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models) and
  [structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [`@google/genai`](https://github.com/googleapis/js-genai)
- [OpenSubtitles REST API](https://opensubtitles.stoplight.io/docs/opensubtitles-api)

## Feature details (technical notes)

These feature notes were in the original "Key features" list.

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

> Version 1 is a local, single-user app. It runs on your own computer at `127.0.0.1` and is
> designed for Stremio desktop.
