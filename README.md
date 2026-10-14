# AI Subtitle Translator for Stremio

A local add-on for Stremio desktop. When you play a movie or episode it offers a subtitle in your
chosen language (Hebrew by default). If OpenSubtitles already has one, it is used directly;
otherwise an English subtitle is translated by Google Gemini, validated, cached and served.

> **Status: Phases 1-6 complete.** The add-on is installable in Stremio desktop. Phase 7
> (hardening, final security review, optional Docker) is still open. The final check in the real
> Stremio player has to be done by you (see "Install in Stremio").

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

## Install in Stremio (desktop)

1. Start the add-on (`npm start`) and keep the terminal open.
2. Open http://127.0.0.1:7000/ and click **Install in Stremio**. Stremio asks to install the
   add-on; confirm. (Manual alternative: Stremio -> Add-ons -> paste
   `http://127.0.0.1:7000/manifest.json`.)
3. Play any movie or episode, open the subtitles menu and choose the entry with your language
   labelled by this add-on.
4. If it says **"Translation in progress - reselect this subtitle in a minute"**, wait a minute and
   select the subtitle again. A full episode usually takes 1-5 minutes the first time; repeats are
   instant (cache in the `data` folder).

How it works: the subtitle list answers immediately with a local link. Opening the link waits up to
`SUB_WAIT_MS` (15 s) for the job; if it is not done you get the placeholder. A translation that
fails part-way resumes from the finished parts on the next attempt.

Remove old cache entries with `npm run cache:cleanup`.

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
