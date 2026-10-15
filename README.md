# AI Subtitle Translator for Stremio

A real-time AI subtitle translator for [Stremio](https://www.stremio.com/). When you play a movie
or episode it offers a subtitle in your language (Hebrew by default). If OpenSubtitles already has
one it is used directly; otherwise a source subtitle is downloaded, translated by Google Gemini,
validated, cached and served to the player.

> **Version 1 is a local, single-user app.** It runs on your own computer at `127.0.0.1` and is
> designed for Stremio desktop.

## Key features

- **Real-time translation** - subtitles are translated on demand while you watch; later plays are
  instant from the cache.
- **Smart source lookup** - search by file hash, then IMDb/TMDB id, then title text; anime
  (`kitsu:` / `tmdb:` ids) is supported and results are filtered to the right season and episode.
- **RTL punctuation fix for Hebrew** (and Arabic/Persian) - per-line Unicode marks keep `. , ? !`
  on the correct side of the line, including two-line subtitles and `<i>` tags.
- **Natural punctuation** - the prompt mirrors the source, so translations do not get a period on
  every fragment.
- **Responsive local GUI** - a dark, mobile-friendly config page for keys, language, model,
  connection tests, and install (button, copyable URL, QR code).
- **Caching and resilience** - file cache, background jobs with an "in progress" placeholder, and
  chunked translation that resumes after failures.
- **Validation** - deterministic code owns parsing, timestamps and IDs; the AI only translates text.

## Requirements

- Node.js 22 or newer (`node -v`)
- A [Gemini API key](https://aistudio.google.com/apikey)
- A free [OpenSubtitles.com](https://www.opensubtitles.com) account and an API consumer key
  (create one at https://www.opensubtitles.com/en/consumers)
- Stremio desktop

## Setup

```powershell
npm install
Copy-Item .env.example .env     # macOS/Linux: cp .env.example .env
notepad .env                    # fill in the keys, save, close
npm start
```

In `.env` set `GEMINI_API_KEY`, `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME` and
`OPENSUBTITLES_PASSWORD` (the account login is required for downloads). Every option is explained
in [`.env.example`](.env.example). You can also paste the keys on the config page instead.
Set `RTL_FIX=true` for Hebrew/Arabic if punctuation looks wrong in your player.

Then open http://127.0.0.1:7000/ . Success looks like
`Open http://127.0.0.1:7000/ in your browser` in the terminal. Stop with Ctrl+C.

> ## Security: never share your keys
>
> **Never upload, commit or share your `.env` file or your API keys.** `.env`, `settings.json`,
> `data/` and `logs/` are listed in `.gitignore` - keep it that way. If a key ever leaks, revoke
> it at the provider and create a new one. Keys are never shown on the config page, written to
> logs, or put in URLs.

## Install in Stremio

1. Keep `npm start` running.
2. Open http://127.0.0.1:7000/ and click **Install in Stremio** (manual alternative: Stremio ->
   Add-ons -> paste `http://127.0.0.1:7000/manifest.json`).
3. Play a movie or episode, open the subtitles menu and pick the entry labelled by this add-on.
4. If it says **"Translation in progress - reselect this subtitle in a minute"**, wait and select
   it again. A full episode usually takes 1-5 minutes the first time.

The subtitle list answers immediately with a local link. Opening it waits up to `SUB_WAIT_MS`
(15 s) for the job and otherwise shows the placeholder. A translation that fails part-way resumes
from the finished parts on the next attempt.

## Config page

- **API keys** show configured/missing (never the values); **Save keys** writes them to `.env`.
- **Settings**: target language and Gemini model (saved to `settings.json`). Recommended and
  default model: `gemini-3.5-flash-lite`; alternative: `gemini-3.8-flash`. A green "Settings saved"
  message confirms the save.
- **Test Gemini / Test OpenSubtitles** and **Translate built-in sample** verify your setup.
- **Install** shows the install button, manifest URL and a QR code.

**QR code limitation:** the server only listens on `127.0.0.1`, which means "this device", so a
phone or TV that scans the QR code cannot reach the add-on. Version 1 is deliberately local
because the page has no login and holds your API keys. The yellow warning on the page says the same.

## Anime and other ID types

Search order (each step runs only if the previous found nothing):

1. File hash (`videoHash` from Stremio) - best sync
2. IMDb or TMDB id (with season/episode)
3. Text search by title: the playing file's name, then the title from Kitsu (kitsu ids) or
   Cinemeta (IMDb ids)

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

Subtitle dialogue is sent to Google Gemini for translation. Provider quotas, billing and free-tier
data-use terms are controlled by Google and OpenSubtitles, not by this add-on. Logs never contain
keys or (by default) dialogue.

## Security notes

- Binds to `127.0.0.1` only; rejects foreign `Host`/`Origin` headers; strict CSP; no CORS.
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
