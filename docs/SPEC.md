# TTT Sub: product spec

> **Rule: any change to what the product does must update this file in the same change.**
> This file says WHAT the product does, in simple words. How the code works is in
> [DEVELOPERS.md](DEVELOPERS.md); details and settings are in [DETAILS.md](DETAILS.md) and
> [SOURCES-AND-TIMING.md](SOURCES-AND-TIMING.md). Items marked **(to verify)** were not confirmed
> in the code.

## 1. Who it is for

- People who watch with **Stremio desktop on Windows** and want subtitles in their own language
  (Hebrew by default) even when no ready subtitle exists.
- Not developers: setup is a wizard, everything is done with buttons.
- One person, one computer. The app runs only on that computer (`127.0.0.1`); nothing is shared
  on the home network. (Sharing with other devices is only an idea for later, see
  [PLAN.md](../PLAN.md).)
- The user brings their own keys: an AI key (Gemini, Claude or OpenAI) and a free OpenSubtitles
  account. SubDL and Jimaku keys are optional.
- Settings, "Accounts and keys": each service has one fixed colour dot, the same in Settings and on
  the connection checks (AI gold, OpenSubtitles blue, SubDL violet, Jimaku pink). The AI card has a
  "Links:" row with three small buttons (Gemini, Claude, OpenAI) under the key box.

## 2. What the user sees and does, step by step

1. **Once:** install the app, follow the setup wizard (AI key, OpenSubtitles, language, test,
   install), and click **Install in Stremio**.
2. **Every time:** keep TTT Sub running (it can sit in the tray near the clock).
3. Play a movie or episode in Stremio, open the subtitles menu, pick the **TTT Sub** entry.
4. The subtitle opens in one of these ways:
   - **Ready at once** if this video was translated before, or a ready subtitle in the user's
     language exists.
   - **Placeholder:** a one-line subtitle "TTT Sub: Translating... when it is done, select the
     subtitle again" (with the percentage). The user waits and selects the entry again. The first
     time, a full episode takes about 1-5 minutes.
   - **Long films (1000+ lines):** the first quarter is shown as soon as it is ready, with a last
     line saying the rest is still coming. Select again later for the whole film.
5. If the timing is fixed after the subtitle was delivered (see section 3), the app shows a
   notice and a Windows notification: select the subtitle again to get the better one.
6. Later plays of the same video are instant (the translation is saved on the computer).

## 3. Where a subtitle comes from, and in what order

The app tries to give a subtitle in the user's language. Best first:

1. **Saved copy** from an earlier translation (instant).
2. **Subtitle inside the video** (or a subtitle file in the same torrent): exact timing, no
   download. Only when the video plays through Stremio's own streaming server (e.g. torrents).
   Waits up to about 15 seconds (**Skip** ends the wait). Can be turned off in Settings.
3. **Downloaded subtitle.** Sources: SubDL (first by default), OpenSubtitles, Jimaku (anime,
   mostly Japanese, last resort). A source without a key is skipped. All are searched together,
   and these rules pick the winner (details: [SOURCES-AND-TIMING.md](SOURCES-AND-TIMING.md)):
   - exact file match (hash) on OpenSubtitles always wins;
   - a ready subtitle in the user's language wins over a translation;
   - English wins over Japanese; a single episode wins over a season pack.
4. **Translation by AI** (Gemini, Claude or OpenAI, chosen by the key) when the winner is not in
   the user's language. Speaker names and sound notes are removed first. Time stamps never go
   through the AI. The result is checked line by line before it is saved.

**Timing check after the choice.** A downloaded subtitle may be off. The app compares it with the
video's own subtitle track, or else with the sound of the video, and moves it only when sure.
Against the video's own track it corrects one shift, a subtitle made for another frame rate, and
jumps (a scene or a break the subtitle does not have); against the sound, one shift or a frame rate.
Translation does not wait for this check; if the subtitle is moved later, the user is told to
select it again. The "My subtitles" list labels timing as **exact**, **by speech** or
**estimated**. When the sound check finds the subtitle already in step, the label becomes **by speech** (it was checked), never "estimated".

## 4. Screens and buttons, in plain words

- **Setup wizard** (first run, or while a key is missing), 5 steps: AI key; OpenSubtitles;
  language (and optional two-line subtitles: original above, translation below); test
  connections; install in Stremio. **Back / Continue** move between steps. A small underlined
  "Skip the wizard" link under the buttons asks to confirm (without the wizard the add-on does not
  work; it can be run again from Settings → "Run the wizard again"), then opens the main screen.
- **Main screen:**
  - what is translating now, with progress, lines and time left, and who is next in line;
  - **Skip** (gives up the current slow step and goes on) and **Cancel** (stops everything for
    that request). They stay while anything runs in the background;
  - **Sync to sound** (lines the latest subtitle up with the playing video on request);
  - **Test all** (checks the AI and the sources) and a meter of today's OpenSubtitles downloads;
  - **Try another subtitle** (switches to a different source for the result in memory; works
    only while that result is still in memory);
  - **Install in Stremio** and the add-on address with **Copy**.
- **My subtitles:** everything translated so far, grouped by series, season and episode. Each
  shows its source and timing label, all labels in the same fixed size. A **search box** at the top narrows the list by the first letters of the title and drops a list of matching titles below it; picking one shows only that title, with a "show all" button. The user can download the SRT file, delete (one, or via the **Select** button: pick rows, a season or a series, or **Select all**, then the red **Delete (n)**, which appears only while selecting; **Cancel** leaves select mode; picked rows get a gold border and a check mark; always asks first), or in the desktop app save the video with the subtitle inside
  (**MKV** or **MP4**, a copy; the original is never changed).
- **Settings** (side drawer): Accounts and keys, Translation (model, "ask before
  translating"; the preferred source only when two or more source keys are set, listing just those), General (start with Windows, start minimized), Maintenance (delete saved translations and the library after a confirm dialog, run
  setup again), About (version, check for updates, developer settings hidden by default).
- **News bell:** release notes of every version (newest open; older ones behind a button). No messages from the author.
- **Tray menu:** Open, Pause / Resume translation, time left, Start with Windows, Quit.
  The **X** on the window asks: minimize to tray (keeps working) or quit.
- Language of the screens: Hebrew (default) or English, switched in Settings.

## 5. What happens when things fail

- **Nothing found anywhere:** the player shows "TTT Sub: No subtitle found for this episode".
- **Any other failure:** the player shows "TTT Sub: Something went wrong. Open the app for
  details". The reason is on the main screen and Windows shows one notification.
  See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
- **AI per-minute limit:** the app slows down by itself. **Daily limit:** it waits until the
  quota resets and continues alone. **Overloaded or timed out:** retried after 1, 5 and 15
  minutes. The main screen shows the wait.
- **Translation stops half way:** the finished parts are kept; the next attempt continues from
  them.
- **A line the AI drops or breaks:** Gemini is told the exact number of lines to send back (parts
  of up to 100 lines); what is still missing or broken is repaired or retried; as a last resort the original line is
  kept (never more than 25% of a part).
- **OpenSubtitles daily downloads used up:** another source is used if one has a key; otherwise
  an error is shown.
- **No ffmpeg / no local stream / no text track in the video:** the inside-the-video step is
  skipped silently and the download path runs.
- **Sound check unsure or no sound for 45 s:** the subtitle stays exactly as it was.
- **Cancelled request:** asking again from Stremio within 20 seconds is ignored.
- **A stuck AI request** (no news for 12 s) is cut and asked again by the app itself. There is no
  "Continue" button any more.

## 6. Limits and waiting times

- **Opening a subtitle:** Stremio gives up after 10 seconds, so the app answers within 8 seconds
  at most (real result or placeholder).
- **First translation:** about 1-5 minutes per episode. Up to 4 translations run at once.
- **OpenSubtitles quota:** a free account has 20 downloads a day. Everything downloaded is kept,
  so deleting a translation does not cost quota again. The "compare 3 subtitles" timing helper
  runs only when 30+ downloads are left.
- **SubDL:** about 300 downloads a day. **Jimaku:** 25 requests a minute, files up to 2 MB.
- **AI quota and price** are controlled by the AI provider (Gemini has a free tier).
- **Saved translations are deleted automatically 90 days** after they were made.
- Video's own subtitle: wait about 15 s; skipped if reading it would take over 60 s. Picture
  subtitles (PGS) are not supported.
- Windows only, Stremio desktop only; the install button is tested in Chrome only.
- Keys stay on the computer, are never shown again after saving, never written to logs.
  Dialogue goes only to the AI provider that matches the key (and subtitle searches to the
  sources). Details: [README.md](../README.md#privacy).

## 7. Optional behavior (off or on by choice)

- **Ask before translating:** new requests wait in a queue with **Translate** / **Cancel**.
- **Translate the next episode ahead** (developer setting, off by default).
- **Always translate from English** (developer setting, off by default).
- **Pause translation** from the tray.

## 8. To verify

- **(to verify)** Whether "Try another subtitle" and the Skip/Cancel buttons look exactly as
  described above on screen (taken from HANDOFF.md and DETAILS.md, not from the UI code).
- **(to verify)** The 12-second stuck-request cut is in code (`STALL_AFTER_MS`), but what the
  user sees when it happens was not checked.
