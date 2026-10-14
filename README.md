# AI Subtitle Translator for Stremio

A local add-on for Stremio desktop. When you play a movie or episode it offers a subtitle in your
chosen language (Hebrew by default). If OpenSubtitles already has one, it is used directly;
otherwise an English subtitle is translated by Google Gemini, validated, cached and served.

> **Status: Phases 1-4 complete** (foundation, translation core, config page, OpenSubtitles).
> Not built yet: cache, background jobs, Stremio manifest/handler.
> The config page (dark theme, key form, Test buttons) works today. Save API keys on the page; they
> are written to the local `.env` file and never shown again.
> Search without downloading: `http://127.0.0.1:7000/dev/source-search?type=movie&id=tt0111161`
> (series: `type=series&id=tt0944947:1:2`).

## Requirements

- Windows 11 (macOS/Linux work the same), Node.js 22 or newer (`node -v`).
- A Gemini API key and an OpenSubtitles.com account with an API consumer key.

## Get the keys

1. **Gemini**: https://aistudio.google.com/apikey -> "Create API key". Copy it.
2. **OpenSubtitles**: create a free account at https://www.opensubtitles.com, then create an API
   consumer at https://www.opensubtitles.com/en/consumers and copy the key. The add-on also logs in
   with your account username and password (required for downloads).

## Setup (PowerShell, in `E:\stremio-addon`)

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Fill in `GEMINI_API_KEY`, `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME`,
`OPENSUBTITLES_PASSWORD`; save and close. Keys stay in this file only.

## Start / stop

```powershell
npm start        # or: npm run dev (auto-restarts on code changes)
```

Open http://127.0.0.1:7000/ . Stop with Ctrl+C. Success looks like:
`Open http://127.0.0.1:7000/ in your browser`.

## Using the config page

- **Keys** show configured/missing (never the values).
- **Settings**: target language and Gemini model (saved to `settings.json`).
- **Test Gemini / Test OpenSubtitles**: green check = works.
- **Translate built-in sample**: runs the full translation pipeline on a 3-cue sample.

## Test with your own file

```powershell
curl.exe -X POST --data-binary "@my.srt" "http://127.0.0.1:7000/dev/translate?lang=he" -o out.srt
```

## Commands

| Command             | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `npm run check`     | format check + lint + type-check + tests            |
| `npm test`          | tests (free; all external APIs mocked)              |
| `npm run test:live` | one tiny real request per provider (uses your keys) |

## Configuration (`.env`)

See `.env.example` for every option. Missing or invalid values stop startup with a message that
names the variable (never its value). API keys may be empty so the config page can still open.

## Privacy

Subtitle dialogue is sent to Google Gemini for translation. Provider quotas, billing and free-tier
data-use terms are controlled by Google and OpenSubtitles. Logs never contain keys or (by default)
dialogue.

## Notes

- Stremio desktop works with `http://127.0.0.1`. Stremio Web / other devices would need HTTPS (future).
- The server only listens on `127.0.0.1` and rejects foreign Host/Origin headers.

## Adding another translation provider

Implement `TranslationProvider` (`src/translation/provider.ts`): `testConnection`,
`translateChunk`, `getProviderName`, `getModelInformation`, `normalizeError` (map errors to
`AppError` codes; mark transient ones retryable). Then return it from `createProvider` in
`src/web/server.ts` / `src/index.ts`. The pipeline, validation and cache do not change.

## Documentation used

- Stremio add-on SDK, subtitles handler: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini JS SDK (`@google/genai`): https://github.com/googleapis/js-genai
- OpenSubtitles REST API: https://opensubtitles.stoplight.io/docs/opensubtitles-api
  (the docs site could not be fetched automatically; endpoints used - `POST /login`,
  `GET /subtitles`, `POST /download` with `Api-Key` + `User-Agent` headers - follow the public API
  and community wrappers, and are verified by `npm run test:live` in phase 4)

## Future: public deployment (not implemented)

HTTPS hosting; per-user bring-your-own-key with keys encrypted at rest (AES-GCM, master secret
from env); opaque config ID in the manifest URL; config deletion; rate limiting; SSRF hardening
for downloads; abuse controls and quotas.
