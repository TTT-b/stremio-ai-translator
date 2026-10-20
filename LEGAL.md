# Legal notes

This page is a plain summary, not legal advice.

## The project

- **License:** MIT (see `LICENSE`). Anyone may use, copy and change the app, with the copyright
  notice kept.
- **Not affiliated with Stremio.** "Stremio" is a trademark of its owner. The name is used only to say
  what the add-on works with. The app is not made, endorsed or supported by Stremio, OpenSubtitles,
  SubDL, Google, Anthropic or OpenAI.
- **No video or subtitle files are included or shared.** The app does not host, upload or share any
  video or subtitle. Subtitles are downloaded from the user's own OpenSubtitles / SubDL account or
  read from the video the user is already playing, translated on the user's computer and kept in
  the user's own cache. The user is responsible for having the right to watch the content.
- **ffmpeg is not bundled.** The app uses the ffmpeg that comes with the user's Stremio install.

## Third-party code

The app is built from open-source packages. A check of every package in the build (including build
tools) found only permissive licenses: MIT, ISC, Apache-2.0, BSD-2/3-Clause, BlueOak-1.0.0, 0BSD, and
two MPL-2.0 packages (MPL applies to changes to those files only, and none were changed). No GPL or
AGPL package is used. Electron and Chromium are included in the installer under their own licenses.

## Services the user connects

The user brings their own keys. Each service has its own terms the user accepts when creating the key:
OpenSubtitles, SubDL, and the AI provider (Google Gemini, Anthropic Claude or OpenAI). Keys stay on
the user's computer and are never sent anywhere except to that provider.

## Windows warning (SmartScreen)

The installer is not yet signed with a paid code-signing certificate, so Windows may show a blue
"Windows protected your PC" window. Click **More info**, then **Run anyway**. It goes away only with
a signed installer or after enough people have installed it.
