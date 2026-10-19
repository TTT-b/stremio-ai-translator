# Stremio AI Subtitle Translator — Build Instructions for Claude Code

You are a senior TypeScript engineer building a stable, secure, maintainable Stremio subtitle add-on, starting from an empty folder.

## About the user

The user is a Tier 1 SOC analyst. He understands basic technical concepts, can run terminal commands, read logs and follow precise instructions, and has used an IDE (PyCharm) before, but he is not a software developer.

- Do not expect him to make architectural decisions, edit code manually, or debug stack traces.
- Security explanations can be technical; coding explanations should be simple.
- When a manual action is genuinely required, state exactly: what to do, where (which app / terminal / folder), the exact command or value, what success looks like, and what output to send back if it fails.
- Never ask him to paste a secret into the chat. Secrets go into the local `.env` file only. Confirm success without displaying the secret.
- Commands must be copy-paste ready (Windows PowerShell first; mention macOS/Linux differences only if they matter).

## Project

**Name:** AI Subtitle Translator for Stremio

**Goal:** When the user plays a movie or episode in Stremio, the add-on offers a subtitle in his chosen language (Hebrew by default). If a subtitle in that language already exists on OpenSubtitles, serve it directly. If not, download the best available source subtitle (English preferred), translate it with Gemini, cache it, and serve it.

**Version 1 is a LOCAL, single-user add-on** running on the user's own computer at `http://127.0.0.1:7000`. It is not a public multi-user service. Design the code so it could become public later (see "Future: public deployment"), but do not build public-hosting features now.

## Scope

### Version 1 includes

- Stremio subtitle add-on (movies and series, using IMDb IDs and season/episode).
- OpenSubtitles.com REST API as the source subtitle provider.
- Gemini as the translation provider.
- SRT and WebVTT parsing/serialization (deterministic code, not AI).
- Chunked, validated translation that preserves timestamps, cue order and cue count exactly.
- Persistent translation cache on disk.
- A small local status/configuration page: target language, Test Connection buttons, install link.
- Structured logs with secret redaction.
- Automated tests that cost nothing (mocked APIs).

### Version 1 excludes

User accounts, multi-user key storage, payment, analytics/telemetry, admin dashboards, AI agents, MCP, RAG, vector databases, Redis, React/Next.js, microservices. Docker is optional and comes last (phase 7).

## Mandatory process

1. Inspect the folder. State whether it is empty or has existing work. If work exists, continue it; never rebuild from scratch.
2. Research current official docs before writing integration code: Stremio Add-on SDK (subtitles resource, manifest, `extra` args), OpenSubtitles REST API v1, and the current Gemini API / official SDK (`@google/genai`). Do not use deprecated APIs or guessed model names. Note the doc URLs you used in `README.md`.
3. Write a short plan (`PLAN.md`): structure, phases, risks, assumptions.
4. Implement in the small phases below. Do not stop after the plan.
5. After each phase: format, lint, type-check, run tests, fix root causes, review the git diff, commit.
6. Never weaken, skip or delete a test to make it pass.
7. Never claim something works without running the relevant check.
8. **Stop after Phase 3 and report** (see "First run").

## Tech stack

- Node.js current LTS, TypeScript strict mode.
- `stremio-addon-sdk` (use its router with Express if extra routes are needed).
- Zod for config/input validation.
- Vitest, ESLint, Prettier.
- SQLite (`better-sqlite3`) or plain JSON files for the cache, whichever is simpler and reliable.
- Native `fetch`.
- `pino` (or similar) structured logging with redaction.

## Configuration and secrets (local model)

All secrets live in `.env` (gitignored), with a committed `.env.example`:

```
GEMINI_API_KEY=
GEMINI_MODEL=            # safe default chosen from current docs
OPENSUBTITLES_API_KEY=
OPENSUBTITLES_USERNAME=
OPENSUBTITLES_PASSWORD=
OPENSUBTITLES_USER_AGENT=StremioAITranslator v1.0
TARGET_LANGUAGE=he
PORT=7000
LOG_LEVEL=info
```

- Validate all config with Zod at startup; fail with a clear, human-readable message naming the missing variable (never its value).
- Server binds to `127.0.0.1` only.
- API keys must never appear in: logs, URLs, the manifest, the config page HTML, browser console, cache keys, cache files, error responses, or git.
- Non-secret settings changed on the config page (target language, model) are saved to a local `settings.json` (gitignored).

## OpenSubtitles (source provider)

Implement behind a `SourceSubtitleProvider` interface so it can be replaced without touching translation code.

- Uses API key **plus** login (username/password → token) because downloads require an authenticated user; respect the daily download quota and surface `quota exceeded` clearly.
- Send the required `Api-Key` and `User-Agent` headers. Cache the login token until expiry.
- Search strategy, in order:
  1. If Stremio passes `videoHash` / `videoSize` / `filename` in `extra`, use `moviehash` first (best timing match).
  2. Search by IMDb ID (+ season/episode for series).
- **If a subtitle already exists in the target language → serve it directly, no translation** (saves cost and gives human-quality output).
- Otherwise pick the best source subtitle (prefer English; prefer hash match, then download count / rating).
- Downloads: only from the URL returned by the OpenSubtitles API, HTTPS only, host allowlist, timeout, max size (e.g. 2 MB), handle encoding (detect and convert non-UTF-8, strip BOM).
- Do not scrape websites. Do not invent undocumented endpoints.
- A dev route accepts a local SRT/VTT fixture so the translation pipeline can be tested without Stremio or OpenSubtitles.

## Gemini (translation provider)

Behind a `TranslationProvider` interface:

```
testConnection()
translateChunk()
getProviderName()
getModelInformation()
normalizeError()
```

- Use the official SDK or REST API; model comes from config with a safe, current default.
- Use structured JSON output (response schema) when supported.
- Timeouts, normalized errors (invalid key, quota, rate limit, model unavailable, timeout, malformed response), token usage reporting when available.
- Retry only transient errors (429 respecting Retry-After, 5xx, network reset, timeout) with bounded exponential backoff + jitter, max attempts. Never retry invalid key / invalid config.
- Do not build fake OpenAI/Anthropic providers. Document in `README.md` how to add one.

## Subtitle processing

Deterministic code handles: parsing, timestamps, cue IDs, ordering, hashing, file I/O, cache, validation. The AI translates dialogue text only.

Preserve exactly: cue order, start/end timestamps, cue count. Preserve where possible: line breaks, `<i>`/`<b>` tags, speaker dashes.

### Chunking

- No cue-by-cue API calls; no unbounded whole-file request.
- Size-aware chunks (e.g. ~50–100 cues, configurable), with a little read-only context from the previous chunk for consistency (not re-translated).
- Limited concurrency (e.g. 2–3 chunks in parallel, configurable).

Request contract:

```json
{ "targetLanguage": "Hebrew", "cues": [{ "id": "101", "text": "Original text" }] }
```

Response contract:

```json
{ "translations": [{ "id": "101", "text": "Translated text" }] }
```

Validate every chunk: each ID exactly once, no unknown/missing/duplicate IDs, non-empty text when source is non-empty, no Markdown or commentary. Retry an invalid chunk a bounded number of times; if it still fails, fail the job clearly. Never return a corrupted file.

### Translation prompt

Versioned template in its own file (e.g. `src/translation/prompts/v1.ts`), with a place for per-language instructions. It must instruct the model to:

- Translate only the given dialogue, naturally (not word-for-word), keeping meaning, tone, humor, slang, and speaker relationships.
- Keep lines short enough to read on screen; keep names and terms consistent.
- Never summarize, censor ordinary dialogue, add commentary, or change IDs.
- Return only the required JSON.

Hebrew-specific:

- Natural modern conversational Hebrew, not formal or literal.
- Correct gender forms when context allows.
- Keep logical Unicode order; never reverse text manually.
- RTL punctuation fix (e.g. adding RLM/RLE marks) must be a **config option, default off**, enabled only if a real test in the Stremio player shows misplaced punctuation.

## The latency problem (important)

Translating a full episode can take 30–120 seconds, while Stremio expects the subtitles response quickly. Design for this explicitly:

- The subtitles handler responds immediately with a list entry pointing to a local URL like `/sub/<jobId>.srt`.
- Requesting the subtitles list starts the translation job in the background.
- When the player fetches `/sub/<jobId>.srt`: if ready, serve it; if still running, wait up to a short limit, then serve a valid short placeholder SRT ("Translation in progress — reselect this subtitle in a minute").
- Concurrent requests for the same job share one job.
- Research how Stremio handles this and confirm the behavior in a real test.

## Cache

- Key: SHA-256 of normalized source subtitle + target language + source language + provider + model + prompt version + relevant options. Never the API key.
- Cache only fully validated translations. Atomic writes. Detect corrupt entries. Configurable expiry and a cleanup command.
- Log hit/miss without dialogue text.

## Config / status page (local)

Simple server-rendered HTML (no framework) at `http://127.0.0.1:7000/`:

- Shows which keys are configured (yes/no only, never values).
- Target language selector (Hebrew default + common languages), optional model selector.
- "Test Gemini" and "Test OpenSubtitles" buttons with clear results.
- "Install in Stremio" button (`stremio://127.0.0.1:7000/manifest.json`) plus the copyable manifest URL.
- Short notice: provider quotas, billing, free-tier data-use terms are controlled by the providers.
- Escape all output (no XSS), security headers, no wildcard CORS beyond what Stremio needs.

## Stremio

- Manifest: stable unique ID, clear name/description, only the `subtitles` resource, types `movie` and `series`, `idPrefixes: ["tt"]`.
- Valid subtitle response objects; subtitle URLs return correct content type and valid SRT/VTT.
- Test movie and series requests separately.
- Note in README: Stremio desktop works with `http://127.0.0.1`; Stremio Web / other devices would need HTTPS (future).

## Errors

Normalized error codes, each with: safe user message, HTTP status, retryable flag, structured log data, no secrets:

`CONFIGURATION_INVALID`, `INVALID_API_KEY`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`, `PROVIDER_MODEL_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_RESPONSE_INVALID`, `SOURCE_AUTH_FAILED`, `SOURCE_QUOTA_EXCEEDED`, `SOURCE_SUBTITLE_NOT_FOUND`, `SOURCE_DOWNLOAD_FAILED`, `SOURCE_FILE_TOO_LARGE`, `UNSUPPORTED_SUBTITLE_FORMAT`, `SUBTITLE_PARSE_FAILED`, `TRANSLATION_VALIDATION_FAILED`, `CACHE_READ_FAILED`, `CACHE_WRITE_FAILED`, `FINAL_SUBTITLE_INVALID`, `STREMIO_REQUEST_INVALID`.

## Logging

Structured logs with a request ID per Stremio request, stage tags:

```
[CONFIG] [STREMIO] [SOURCE] [DOWNLOAD] [PARSER] [CACHE] [CHUNK] [API] [VALIDATION] [ASSEMBLY] [DELIVERY]
```

Include: media type, IMDb ID, season/episode, provider, model, target language, cue count, chunk n/total, duration, HTTP status, error code, cache hit/miss, tokens used.

Never log: API keys, passwords, tokens, auth headers, full dialogue (unless `LOG_LEVEL=debug` AND `LOG_DIALOGUE=true`, still with secrets redacted).

Also write logs to a rotating file in `logs/` (gitignored) so the user can send a log file when something fails.

## Testing

Default `npm test` must cost nothing (all external APIs mocked).

Unit: config validation, redaction, SRT/VTT parse & serialize round-trip, chunking, ID validation (missing/duplicate/unknown/empty), cache keys, hit/miss, error normalization, retry/backoff, timeouts, download host allowlist & size limit, Stremio response shape.

Mocked integration: successful translation, invalid key, quota, rate limit, timeout, malformed response, partial chunk failure, OpenSubtitles not found / auth failure, existing target-language subtitle served without translation, cached translation, full subtitle request flow including the "in progress" placeholder.

Optional live test (`npm run test:live`): only when `LIVE_TEST=1`, uses keys from `.env`, one tiny request per provider, never prints keys.

Fixtures: small original subtitle files written for tests only. No copyrighted subtitles in the repo.

## Repository files

`README.md` (for the user: what it does, requirements, getting each API key, setup, start/stop, install in Stremio, test with sample file, update, common errors, privacy note that dialogue is sent to Gemini), `CLAUDE.md`, `PLAN.md`, `TROUBLESHOOTING.md`, `.env.example`, `.gitignore`, `package.json`, `tsconfig.json`, ESLint + Prettier configs.

`.gitignore` must cover: `.env`, `node_modules/`, `data/`, `logs/`, `settings.json`, build output, temp files.

`CLAUDE.md` permanent rules: read the repo before editing; never rewrite from scratch; smallest safe change; don't touch unrelated files; never expose or commit secrets; run tests after changes; fix root causes; update docs when behavior changes; give exact manual steps; never claim success without validation.

`TROUBLESHOOTING.md`: decision paths for "Test Connection fails", "No translation happens", "Stremio shows no subtitle", "Subtitle out of sync", "Hebrew punctuation looks wrong".

## Phases (commit after each)

1. Foundation: project init, tooling, config validation, logging with redaction, `CLAUDE.md`, `.gitignore`, `.env.example`.
2. Subtitles + translation core: SRT/VTT parser/serializer, chunking, validation, prompt v1, Gemini provider, Test Connection, dev route translating a local fixture.
3. Config/status page with both Test buttons.
   **→ Stop here and report.**
4. OpenSubtitles provider (search, hash match, login, download, encoding).
5. Cache + background jobs + placeholder behavior.
6. Stremio integration (manifest, subtitles handler, delivery) and a real test in Stremio desktop.
7. Hardening + docs: security review (search repo for secrets, check tracked files, check logs, `npm audit`), optional Dockerfile, final README.

## Definition of done (Version 1)

1. `npm run dev` starts the server; config page loads at `http://127.0.0.1:7000/`.
2. Both Test Connection buttons succeed with real keys and fail clearly with wrong keys.
3. Add-on installs in Stremio desktop.
4. Playing an episode with an existing Hebrew subtitle on OpenSubtitles → served directly, no Gemini call.
5. Playing an episode without one → English source downloaded, translated by Gemini, validated, served.
6. Timestamps and cue count identical to the source.
7. Replaying the same episode uses the cache.
8. Logs show every stage with no secrets.
9. All automated tests pass; lint and type-check clean.
10. The user can follow `README.md` alone.

## First run

Start now:

1. Inspect the folder and say whether it's empty.
2. Research the official docs listed above.
3. Write `PLAN.md` (structure, phases, risks, assumptions, source-subtitle strategy).
4. Implement Phases 1–3.
5. Run all checks and fix failures.
6. Report: what was created, which checks ran and passed, what remains, and the exact next manual step (most likely: fill `.env`, then run one command and open the config page).

## Future: public deployment (not now, document only)

Document in `README.md` what would change to make it public: HTTPS hosting, per-user BYOK with keys encrypted at rest (AES-GCM, master secret from env), opaque config ID in the manifest URL, config deletion, rate limiting, SSRF hardening, abuse controls.
