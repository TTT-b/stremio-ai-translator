# PLAN

## Goal

Local, single-user Stremio add-on (`http://127.0.0.1:7000`). For the played title it serves an
existing subtitle in the target language (default Hebrew) from OpenSubtitles, or downloads the
best source subtitle (English preferred), translates it with Gemini, caches and serves it.

## Structure

```
src/
  index.ts                 entry: load .env, validate config, start server on 127.0.0.1
  errors.ts                AppError + normalized error codes (message, HTTP status, retryable)
  config/                  env.ts (Zod), settings.ts (settings.json), languages.ts
  logging/                 logger.ts (pino, console + daily file), redact.ts
  subtitles/               parse (SRT/VTT), serialize, chunk, validate, rtl
  translation/             provider.ts (interface), gemini.ts, retry.ts, pipeline.ts, prompts/v1.ts
  sources/opensubtitles/   client.ts (login now; search/download in phase 4)
  web/                     server.ts (Express), html.ts (status page)
tests/                     Vitest, all external APIs mocked; tests/live is opt-in
```

## Phases

1. Foundation - tooling, config validation, redacting logger, repo files. **Done**
2. Subtitle + translation core, Gemini provider, dev route. **Done**
3. Status page with Test buttons. **Done** -> stop and report
4. OpenSubtitles provider (search, moviehash, login, download, encoding). **Done**
5. Cache, background jobs, "in progress" placeholder. **Done**
6. Stremio integration. **Done** (real-player test is a manual step)
7. Hardening, docs, optional Docker. **Done** (Docker intentionally skipped: localhost-only)

## Source-subtitle strategy (phase 4)

1. If Stremio sends `videoHash`/`videoSize`, search by `moviehash` first.
2. Otherwise search by IMDb ID (+ season/episode for series).
3. If a target-language subtitle exists, serve it directly (no translation cost).
4. Else choose an English source: hash match > download count / rating. Fall back to any language.

## Key decisions

- **JSON files for the cache** (no native build tools needed on Windows): atomic writes, SHA-256 keys.
- **Express 4** because `stremio-addon-sdk` builds on it.
- **API keys optional at startup** so the status page can show what is missing; features that need
  a key fail with `CONFIGURATION_INVALID` naming the variable.
- **Local-only protections**: bind 127.0.0.1, Host allow-list (DNS rebinding), Origin check
  (cross-site POSTs), strict CSP, no CORS headers.
- IDs sent to the model are the cue index; timestamps never go through the AI.

## Risks

| Risk                                                     | Mitigation                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Translation takes longer than Stremio waits              | Background job + placeholder subtitle (phase 5)                         |
| Model drops/merges/duplicates cues                       | Per-chunk ID validation, bounded retries, final structure check         |
| OpenSubtitles daily download quota                       | Clear `SOURCE_QUOTA_EXCEEDED`, cache everything                         |
| Gemini model names change                                | Model is configurable; default taken from current docs                  |
| RTL punctuation looks wrong in Stremio                   | `RTL_FIX` option, off by default, enable after a real player test       |
| OpenSubtitles API details (endpoints) not fully verified | Verify in the live test (`npm run test:live`) before relying on phase 4 |

## Assumptions

- Windows 11 + PowerShell, Node.js >= 22 (24 installed).
- User has (or will create) a Gemini API key and an OpenSubtitles.com account + API consumer key.
- Stremio desktop (plain `http://127.0.0.1` add-ons work there).

## Ideas for later

- **Home server mode** (saved 2026-10-20, not started): a settings toggle that serves only the Stremio endpoints
  (`/manifest.json`, `/subtitles/...`, `/sub/...`) to the home network, so phones, TVs and laptops can use one PC as
  the translator. Keep the settings page and `/api/*` loopback-only; show the LAN manifest URL and a Firewall note.
  Limit: embedded-subtitle lookup and the sound-based timing check need Stremio's streaming server on the same
  machine, so other devices only get the OpenSubtitles path. About a day with tests; a Docker image can follow.
