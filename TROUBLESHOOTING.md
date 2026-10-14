# Troubleshooting

Logs are in the `logs` folder (`app-YYYY-MM-DD.log`). When asking for help, send the newest
log file - it never contains your keys.

## "Test Connection" fails

1. Read the message next to the button; it names the cause.
2. `Missing in .env` / `not set` -> open `.env`, fill the named variable, **restart** the add-on
   (Ctrl+C in the terminal, then `npm start`).
3. `API key was rejected` -> re-copy the key (no spaces or quotes). Gemini: create a new key at
   https://aistudio.google.com/apikey. OpenSubtitles: check the consumer API key at
   https://www.opensubtitles.com/en/consumers.
4. `OpenSubtitles login failed` -> username/password are your opensubtitles.com account (not the
   API key). Try logging in on the website.
5. `model is unavailable` / `not available to this key` -> Google retired that model for new
   users. Pick another model on the config page (or set `GEMINI_MODEL` in `.env`).
   5a. `quota or billing limit` with `prepaid credits depleted` -> the Google project behind your key
   has no credits. Open https://ai.studio/projects, check billing/credits for the project, or
   create a key in a different project. Newer (3.x) models need credits; 2.5 models are closed
   to new users.
6. `timed out` / `rate limiting` -> wait a minute and retry.

## No translation happens

1. Is Gemini green on the config page ("Test Gemini")?
2. Click "Translate built-in sample". If that works, translation is fine and the problem is on the
   subtitle-source side.
3. Look in the log for `SOURCE_SUBTITLE_NOT_FOUND`, `SOURCE_QUOTA_EXCEEDED` (OpenSubtitles daily
   download limit reached) or `TRANSLATION_VALIDATION_FAILED` (model kept returning bad output;
   lower `CHUNK_SIZE` in `.env`, e.g. 30).

## Stremio shows no subtitle

1. Is the add-on running (terminal open, config page loads)?
2. Is it installed? (Stremio -> Add-ons -> look for "AI Subtitle Translator".) Use the install
   button on the config page.
3. Use Stremio **desktop**; Stremio Web needs HTTPS and will not accept `http://127.0.0.1`.
4. Reselect the subtitle after a minute: the first request starts the translation.

## Subtitle out of sync

The translated file keeps the source file's timestamps exactly, so sync equals the source
subtitle's sync. Choose a different source release, or use Stremio's subtitle delay control.

## Hebrew punctuation looks wrong

Symptoms: periods or question marks at the wrong end of a line. Set `RTL_FIX=true` in `.env`,
restart, reselect the subtitle. Turn it back off if it makes things worse.
