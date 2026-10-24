import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../logging/logger';
import { parseSubtitle } from '../subtitles/parse';

/**
 * Subtitles stored inside the video file itself. When the video plays through Stremio's local
 * streaming server (torrents), the file is reachable on 127.0.0.1, so ffmpeg (shipped with
 * Stremio) can read its text subtitle tracks. Those match the file exactly: no timing drift and
 * no OpenSubtitles download. Everything here is best effort: any problem returns undefined and
 * the normal OpenSubtitles path runs instead.
 */

export interface EmbeddedSubtitle {
  /** Decoded SRT text. */
  raw: string;
  /** Language the track is in, as the code that was asked for. */
  language: string;
  cues: number;
  /** ffmpeg stream index inside the file (tracks only). */
  streamIndex?: number;
  /** Where it came from: a track inside the video, or a subtitle file in the same torrent. */
  source?: 'track' | 'file';
}

export type Exec = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; maxBytes: number },
) => Promise<Buffer>;

export interface EmbeddedDeps {
  /** Stremio's streaming server, e.g. http://127.0.0.1:11470 (loopback only). */
  serverUrl: string;
  /** ffmpeg.exe path, or empty to look in Stremio's install folder. */
  ffmpegPath: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  exec?: Exec;
  /** Longest one try may take before the next try or the OpenSubtitles search (default 30 s). */
  budgetMs?: number;
  /** Longest all tries may take together when tracks were found but not yet readable (default 2 min). */
  retryBudgetMs?: number;
  /** Pause between tries (default 10 s). Tests set 0. */
  retryGapMs?: number;
  /**
   * Reading a track means reading the whole video file. When that would take longer than this many
   * seconds at the speed the torrent is downloading, the tracks are not tried (files stored beside
   * the video still are). Unset or 0: always try.
   */
  maxEtaSec?: number;
  /** True once the user cancelled: no more tries. */
  shouldStop?: () => boolean;
  /** How long to keep looking for the video on the local server (default 8 s). Tests set 0. */
  waitMs?: number;
  /** Replaces setTimeout-based waiting. Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Where to look for ffmpeg/ffprobe next to Stremio. Injectable for tests. */
  toolDirs?: string[];
}

export interface EmbeddedQuery {
  filename: string;
  /** Language wanted in the final subtitles (served without translation if a track has it). */
  targetLanguage: string;
  /** Language translated from when the target has no track. */
  sourceLanguage?: string;
}

const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const MIN_CUES = 20;
export const STREAM_WAIT_MS = 8000;
/** Everything here is best effort: after this long the normal OpenSubtitles search takes over. */
const EMBEDDED_BUDGET_MS = 30_000;
/**
 * A video that is still loading shows its subtitle tracks but cannot be read yet. Instead of giving
 * up after the first budget, the lookup tries again for this long in total, with a pause between.
 */
const RETRY_BUDGET_MS = 120_000;
const RETRY_GAP_MS = 10_000;
const FILE_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 12_000;
const TRACK_TIMEOUT_MS = 25_000;
/** A step is not started with less time than this left. */
const MIN_STEP_MS = 1500;
const STREAM_POLL_MS = 1000;
const MAX_STATS_BYTES = 16 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;

/** ffprobe uses ISO 639-2 language tags; map the app's two-letter codes onto them. */
const ISO3: Record<string, string[]> = {
  he: ['heb', 'iw'],
  en: ['eng'],
  ar: ['ara'],
  es: ['spa'],
  fr: ['fre', 'fra'],
  de: ['ger', 'deu'],
  ru: ['rus'],
  pt: ['por'],
  it: ['ita'],
  tr: ['tur'],
  fa: ['per', 'fas'],
  ja: ['jpn'],
  zh: ['chi', 'zho'],
  ko: ['kor'],
  nl: ['dut', 'nld'],
  pl: ['pol'],
  uk: ['ukr'],
  hi: ['hin'],
  el: ['gre', 'ell'],
};

export function languageMatches(tag: string | undefined, code: string): boolean {
  if (!tag) return false;
  const t = tag.toLowerCase();
  const c = code.toLowerCase().split('-')[0] as string;
  return t === c || t.startsWith(`${c}-`) || (ISO3[c]?.includes(t) ?? false);
}

export const defaultExec: Exec = (cmd, args, { timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        child.kill();
        reject(new Error('output too large'));
        return;
      }
      chunks.push(c);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`exit ${code}`));
    });
  });

/** Find ffmpeg and ffprobe: the configured path's folder first, then Stremio's install folders. */
export function locateTools(
  ffmpegPath: string,
  toolDirs?: string[],
): { ffmpeg: string; ffprobe: string } | undefined {
  const dirs = [
    ...(ffmpegPath ? [join(ffmpegPath, '..')] : []),
    ...(toolDirs ?? [
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs', 'Stremio')] : []),
      ...(process.env.ProgramFiles ? [join(process.env.ProgramFiles, 'Stremio')] : []),
      ...(process.env['ProgramFiles(x86)']
        ? [join(process.env['ProgramFiles(x86)'], 'Stremio')]
        : []),
    ]),
  ];
  for (const dir of dirs) {
    const ffmpeg = join(dir, 'ffmpeg.exe');
    const ffprobe = join(dir, 'ffprobe.exe');
    if (existsSync(ffmpeg) && existsSync(ffprobe)) return { ffmpeg, ffprobe };
  }
  return undefined;
}

const statsSchema = z.record(
  z.string(),
  z
    .object({
      infoHash: z.string().regex(/^[0-9a-f]{40}$/i),
      /** How much of the torrent is on disk and how fast it is coming in (bytes, bytes per second). */
      downloaded: z.number().optional(),
      downloadSpeed: z.number().optional(),
      files: z
        .array(
          z.object({ path: z.string().max(1024), length: z.number().optional() }).passthrough(),
        )
        .max(5000),
    })
    .passthrough(),
);

export interface LocalStream {
  infoHash: string;
  fileIdx: number;
  url: string;
  /** Path of the playing file inside the torrent. */
  videoPath: string;
  /** Every file in the torrent, in index order. */
  files: { path: string; length: number }[];
  /** Torrent-wide download progress, when Stremio's server reports it. */
  downloaded?: number;
  downloadSpeed?: number;
}

/**
 * Seconds it would take to read the playing file in full (what extracting a track needs), from its
 * size and the torrent's download speed. Undefined when either is unknown.
 */
export function estimateReadSeconds(stream: LocalStream): number | undefined {
  const length = stream.files[stream.fileIdx]?.length ?? 0;
  const speed = stream.downloadSpeed ?? 0;
  if (length <= 0 || speed <= 0) return undefined;
  return Math.max(0, length - (stream.downloaded ?? 0)) / speed;
}

/** The torrent file currently held by Stremio's server whose name matches the playing video. */
export async function findStream(
  serverUrl: string,
  filename: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalStream | undefined> {
  const res = await fetchImpl(`${serverUrl}/stats.json`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return undefined;
  const text = await res.text();
  if (text.length > MAX_STATS_BYTES) return undefined;
  const parsed = statsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) return undefined;
  const wanted = filename.toLowerCase();
  for (const torrent of Object.values(parsed.data)) {
    const idx = torrent.files.findIndex(
      (f) => basename(f.path.replace(/\\/g, '/')).toLowerCase() === wanted,
    );
    if (idx >= 0) {
      const infoHash = torrent.infoHash.toLowerCase();
      return {
        infoHash,
        fileIdx: idx,
        url: `${serverUrl}/${infoHash}/${idx}`,
        videoPath: (torrent.files[idx] as { path: string }).path,
        files: torrent.files.map((f) => ({ path: f.path, length: f.length ?? 0 })),
        ...(torrent.downloaded !== undefined ? { downloaded: torrent.downloaded } : {}),
        ...(torrent.downloadSpeed !== undefined ? { downloadSpeed: torrent.downloadSpeed } : {}),
      };
    }
  }
  return undefined;
}

const LANGUAGE_NAMES: Record<string, string[]> = {
  he: ['hebrew'],
  en: ['english'],
  ar: ['arabic'],
  es: ['spanish'],
  fr: ['french'],
  de: ['german'],
  ru: ['russian'],
  pt: ['portuguese'],
  it: ['italian'],
  tr: ['turkish'],
  fa: ['persian'],
  ja: ['japanese'],
  zh: ['chinese'],
  ko: ['korean'],
  nl: ['dutch'],
  pl: ['polish'],
  uk: ['ukrainian'],
  hi: ['hindi'],
  el: ['greek'],
};

/** Does a subtitle file name say it is in this language ("2_English.srt", "Movie.heb.srt")? */
export function fileNameLanguageMatches(fileName: string, code: string): boolean {
  const tokens = fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z]+/)
    .filter(Boolean);
  const names = LANGUAGE_NAMES[code.toLowerCase().split('-')[0] as string] ?? [];
  return tokens.some((t) => languageMatches(t, code) || names.includes(t));
}

export interface Sidecar {
  index: number;
  path: string;
  language: string;
}

/**
 * Subtitle files that ship in the same torrent as the playing video and belong to it: in a folder
 * named like the video (the common `Subs/<video name>/2_English.srt`) or named like it
 * (`Movie.en.srt`). They match the release exactly. Target language first, then the source
 * language; within a language the smaller file first (full dialogue before SDH).
 */
export function findSidecars(
  stream: Pick<LocalStream, 'files' | 'videoPath'>,
  targetLanguage: string,
  sourceLanguage: string,
): Sidecar[] {
  const slash = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  const stem = basename(slash(stream.videoPath)).replace(/\.[^.]+$/, '');
  if (!stem) return [];
  const langs = [...new Set([targetLanguage, sourceLanguage])];
  const found: (Sidecar & { length: number })[] = [];
  stream.files.forEach((f, index) => {
    if (!/\.(srt|vtt)$/i.test(f.path)) return;
    const norm = slash(f.path);
    const base = basename(norm);
    const belongs = norm.split('/').slice(0, -1).includes(stem) || base.startsWith(stem);
    if (!belongs) return;
    const language = langs.find((l) => fileNameLanguageMatches(base, l));
    if (language) found.push({ index, path: f.path, language, length: f.length });
  });
  return langs.flatMap((l) =>
    found
      .filter((s) => s.language === l)
      .sort((a, b) => a.length - b.length || a.index - b.index)
      .map(({ length: _length, ...s }) => s),
  );
}

/** Decode subtitle bytes: UTF-8 (BOM stripped), UTF-16 with a BOM, else Windows-1252. */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.slice(2));
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const text = utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8;
  return text.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : text;
}
/**
 * Like findStream, but looks again every second for up to `waitMs`: Stremio asks for subtitles the
 * moment the stream is opened, before its server has loaded the torrent.
 */
export async function findStreamWaiting(
  serverUrl: string,
  filename: string,
  opts: {
    fetchImpl?: typeof fetch | undefined;
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Stop early when this says there is no time left. */
    hasTime?: () => boolean;
  } = {},
): Promise<LocalStream | undefined> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = opts.waitMs ?? STREAM_WAIT_MS;
  let stream = await findStream(serverUrl, filename, opts.fetchImpl);
  for (
    let waited = 0;
    !stream && waited < waitMs && (opts.hasTime?.() ?? true);
    waited += STREAM_POLL_MS
  ) {
    await sleep(STREAM_POLL_MS);
    stream = await findStream(serverUrl, filename, opts.fetchImpl);
  }
  return stream;
}

const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        index: z.number().int(),
        codec_name: z.string().optional(),
        tags: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default([]),
});

export interface TextTrack {
  index: number;
  language: string | undefined;
  title: string;
}

export async function listTextTracks(
  ffprobe: string,
  url: string,
  exec: Exec,
  timeoutMs = 30_000,
): Promise<TextTrack[]> {
  const out = await exec(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      's',
      '-show_entries',
      'stream=index,codec_name:stream_tags=language,title',
      '-of',
      'json',
      url,
    ],
    { timeoutMs, maxBytes: 1024 * 1024 },
  );
  const probe = probeSchema.parse(JSON.parse(out.toString('utf8')));
  return probe.streams
    .filter((s) => TEXT_CODECS.has((s.codec_name ?? '').toLowerCase()))
    .map((s) => ({
      index: s.index,
      language: s.tags?.language ?? s.tags?.LANGUAGE,
      title: s.tags?.title ?? s.tags?.TITLE ?? '',
    }));
}

/**
 * Tracks to try, best first: the target language before the source language; within a language,
 * full dialogue before hearing-impaired (SDH/CC) tracks; forced and commentary tracks never.
 */
export function rankTracks(
  tracks: TextTrack[],
  targetLanguage: string,
  sourceLanguage: string,
): { track: TextTrack; language: string }[] {
  const usable = tracks.filter((t) => !/forced|commentary|signs/i.test(t.title));
  const hearing = (t: TextTrack) => /sdh|hearing|\bcc\b|caption/i.test(t.title);
  const rank = (code: string) =>
    usable
      .filter((t) => languageMatches(t.language, code))
      .sort((a, b) => Number(hearing(a)) - Number(hearing(b)))
      .map((track) => ({ track, language: code }));
  const target = rank(targetLanguage);
  return sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()
    ? target
    : [...target, ...rank(sourceLanguage)];
}

/**
 * Read the best subtitle that ships with the video that is playing right now: a text track inside
 * the file, or a subtitle file in the same torrent. Never throws: returns undefined (after a log
 * line saying why) when there is nothing usable.
 */
export async function loadEmbeddedSubtitle(
  query: EmbeddedQuery,
  deps: EmbeddedDeps,
): Promise<EmbeddedSubtitle | undefined> {
  const log = deps.logger.child({ stage: 'SOURCE' });
  const exec = deps.exec ?? defaultExec;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    // Stremio asks for subtitles the moment the stream is opened, before its server has loaded
    // the torrent. Look again for a few seconds before deciding the video is not local.
    const startedAt = Date.now();
    let deadline = startedAt + (deps.budgetMs ?? EMBEDDED_BUDGET_MS);
    const remaining = () => deadline - Date.now();
    const waitMs = deps.waitMs ?? STREAM_WAIT_MS;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let stream = await findStream(deps.serverUrl, query.filename, deps.fetchImpl);
    for (let waited = 0; !stream && waited < waitMs && remaining() > 0; waited += STREAM_POLL_MS) {
      await sleep(STREAM_POLL_MS);
      stream = await findStream(deps.serverUrl, query.filename, deps.fetchImpl);
    }
    if (!stream) {
      log.info({ embedded: 'not-local', waitedMs: waitMs }, 'embedded subtitles skipped');
      return undefined;
    }
    const found = stream;
    const target = query.targetLanguage;
    const source = query.sourceLanguage ?? 'en';
    const langs = [...new Set([target, source])];
    const tools = locateTools(deps.ffmpegPath, deps.toolDirs);
    const sidecars = findSidecars(found, target, source);
    let tracks: TextTrack[] | undefined;
    let probeFailed = false;
    /** A source was found but could not be read (yet): a later try may work. */
    let unreadable = false;
    const tried = { files: 0, tracks: 0 };

    // A subtitle that is not ready is skipped, never waited for: the whole stage has a time budget.
    const accept = (got: {
      raw: string;
      language: string;
      streamIndex?: number;
      source: 'track' | 'file';
    }): EmbeddedSubtitle | undefined => {
      const cues = parseSubtitle(got.raw).cues.length;
      if (cues >= MIN_CUES) {
        log.info(
          {
            embedded: 'used',
            via: got.source,
            language: got.language,
            streamIndex: got.streamIndex,
            cues,
          },
          'embedded subtitle',
        );
        return { ...got, cues };
      }
      log.info({ embedded: 'too-short', via: got.source, cues }, 'embedded source skipped');
      return undefined;
    };
    const readFile = async (file: Sidecar) => {
      const res = await fetchImpl(`${deps.serverUrl}/${found.infoHash}/${file.index}`, {
        signal: AbortSignal.timeout(Math.min(FILE_TIMEOUT_MS, remaining())),
      });
      if (!res.ok) return undefined;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_SUBTITLE_BYTES) return undefined;
      return { raw: decodeSubtitleBytes(bytes), language: file.language, source: 'file' as const };
    };
    const readTrack = async (track: TextTrack, language: string) => {
      if (!tools) return undefined;
      const out = await exec(
        tools.ffmpeg,
        ['-v', 'error', '-nostdin', '-i', found.url, '-map', `0:${track.index}`, '-f', 'srt', '-'],
        { timeoutMs: Math.min(TRACK_TIMEOUT_MS, remaining()), maxBytes: MAX_SUBTITLE_BYTES },
      );
      // Strip a BOM and the <font> styling ffmpeg adds when it converts mp4 (mov_text) tracks.
      const raw = decodeSubtitleBytes(out).replace(/<\/?font\b[^>]*>/gi, '');
      return { raw, language, streamIndex: track.index, source: 'track' as const };
    };

    // Reading a track reads the whole video; a big file on a slow connection is not worth the wait
    // (and the reading would compete with the playback for the connection).
    const eta = estimateReadSeconds(found);
    const tooBig = !!deps.maxEtaSec && eta !== undefined && eta > deps.maxEtaSec;
    if (tooBig) {
      log.info(
        { embedded: 'too-big', etaSec: Math.round(eta), limitSec: deps.maxEtaSec },
        'reading the tracks inside the video would take too long',
      );
    }

    const attempt = async (): Promise<EmbeddedSubtitle | undefined> => {
      unreadable = false;
      for (const lang of langs) {
        // 1. Subtitle files in the same torrent: small and quick, no ffmpeg needed.
        for (const s of sidecars.filter((x) => x.language === lang).slice(0, 2)) {
          if (remaining() < MIN_STEP_MS) break;
          tried.files++;
          try {
            const got = await readFile(s);
            if (!got) unreadable = true;
            const used = got && accept(got);
            if (used) return used;
          } catch {
            /* not downloaded yet or unreadable: try the next one */
            unreadable = true;
          }
        }
        // 2. Text tracks inside the file (ffprobe once, then ffmpeg per track).
        if (tools && !tooBig && remaining() >= MIN_STEP_MS) {
          if (!tracks) {
            try {
              tracks = await listTextTracks(
                tools.ffprobe,
                found.url,
                exec,
                Math.min(PROBE_TIMEOUT_MS, remaining()),
              );
            } catch {
              tracks = []; // slow or unreadable container: the other sources still work
              probeFailed = true; // ...but a later try looks again
            }
          }
          for (const r of rankTracks(tracks, target, source)
            .filter((x) => x.language === lang)
            .slice(0, 2)) {
            if (remaining() < MIN_STEP_MS) break;
            tried.tracks++;
            try {
              const got = await readTrack(r.track, r.language);
              const used = got && accept(got);
              if (used) return used;
            } catch {
              /* the file is not fully downloaded yet: reading the whole track would have to wait */
              unreadable = true;
            }
          }
        }
      }
      return undefined;
    };
    let used = await attempt();
    // Tracks were listed but the video is not loaded far enough to read them: wait and try again.
    // A caller that sets its own budget (tests, quick checks) gets no extra tries unless it asks.
    const retryUntil =
      startedAt + (deps.retryBudgetMs ?? (deps.budgetMs !== undefined ? 0 : RETRY_BUDGET_MS));
    const retryGap = deps.retryGapMs ?? RETRY_GAP_MS;
    while (
      !used &&
      (unreadable || remaining() < MIN_STEP_MS) &&
      (probeFailed || (tracks?.length ?? 0) + sidecars.length > 0) &&
      Date.now() + retryGap + MIN_STEP_MS < retryUntil &&
      !deps.shouldStop?.()
    ) {
      await sleep(retryGap);
      if (deps.shouldStop?.()) break;
      if (probeFailed) {
        tracks = undefined;
        probeFailed = false;
      }
      deadline = Math.min(Date.now() + (deps.budgetMs ?? EMBEDDED_BUDGET_MS), retryUntil);
      log.info(
        { embedded: 'retry', tracks: tracks?.length ?? 0 },
        'embedded subtitles not readable yet',
      );
      used = await attempt();
    }
    if (used) return used;
    log.info(
      {
        embedded: remaining() < MIN_STEP_MS ? 'out-of-time' : 'no-source',
        tracks: tracks?.length ?? 0,
        files: sidecars.length,
        triedFiles: tried.files,
        triedTracks: tried.tracks,
        ffmpeg: !!tools,
      },
      'embedded subtitles skipped',
    );
  } catch (err) {
    log.info(
      { embedded: 'failed', reason: err instanceof Error ? err.message : 'error' },
      'embedded subtitles skipped',
    );
  }
  return undefined;
}
