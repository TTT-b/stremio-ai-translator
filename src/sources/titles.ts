import type { Logger } from '../logging/logger';
import type { TitleGuess, VideoRef } from './types';

type FetchLike = typeof fetch;

const LOOKUP_TIMEOUT_MS = 8000;
const MAX_LOOKUP_BYTES = 256 * 1024;

/** Replace control characters (and DEL) with spaces. */
export function stripControlChars(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) as number;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out;
}

/** Lowercase letters/digits only; used to compare titles loosely. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NOISE =
  /\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu ray|bdrip|brrip|web ?dl|webrip|web|hdtv|dvdrip|hevc|x26[45]|h ?26[45]|av1|aac|ac3|ddp?\d?\s?\d?|flac|opus|10bit|8bit|hdr|remux|multi|dual audio|eng|jpn|sub|subs|subbed|dubbed|proper|repack|complete|batch|v\d)\b/gi;

/**
 * Pull a title and episode position out of a release file name, e.g.
 * "[SubsPlease] Tensei shitara Slime Datta Ken - 12 (1080p) [ABCD1234].mkv" or
 * "The.Beginning.After.the.End.S02E03.1080p.WEB-DL.mkv".
 */
export function parseFilename(raw: string): TitleGuess | undefined {
  let s = stripControlChars(raw).trim();
  if (!s) return undefined;
  s = s.replace(/\.(mkv|mp4|avi|webm|mov|m4v|ts|srt|ass)$/i, '');
  s = s.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' '); // [group] (1080p) {x}
  s = s.replace(/[._]+/g, ' ');

  let season: number | undefined;
  let episode: number | undefined;
  let title = s;

  const se = /\bS(\d{1,2})\s?E(\d{1,3})\b/i.exec(s);
  const x = /\b(\d{1,2})x(\d{2,3})\b/i.exec(s);
  const dash = /\s-\s*(?:E|EP|Episode\s*)?(\d{1,4})(?:v\d)?\b/i.exec(s);
  const ep = /\b(?:E|EP|Episode)\s?(\d{1,4})\b/i.exec(s);
  if (se) {
    season = Number(se[1]);
    episode = Number(se[2]);
    title = s.slice(0, se.index);
  } else if (x) {
    season = Number(x[1]);
    episode = Number(x[2]);
    title = s.slice(0, x.index);
  } else if (dash) {
    episode = Number(dash[1]);
    title = s.slice(0, dash.index);
  } else if (ep) {
    episode = Number(ep[1]);
    title = s.slice(0, ep.index);
  } else {
    title = s.replace(/\b(19|20)\d{2}\b.*$/, ''); // movie: cut at the year
  }

  title = title
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[-\s]+$/g, '')
    .trim();
  if (title.length < 2) return undefined;
  const guess: TitleGuess = { title };
  if (season !== undefined) guess.season = season;
  if (episode !== undefined) guess.episode = episode;
  return guess;
}

/** "Show Name Season 2" / "Show 2nd Season" -> base title + season number. */
export function splitSeason(title: string): { base: string; season?: number } {
  const patterns: [RegExp, number][] = [
    [/\s+season\s*(\d{1,2})$/i, 1],
    [/\s+(\d{1,2})(?:st|nd|rd|th)\s+season$/i, 1],
    [/\s+s(\d{1,2})$/i, 1],
  ];
  for (const [re] of patterns) {
    const m = re.exec(title);
    if (m) return { base: title.slice(0, m.index).trim(), season: Number(m[1]) };
  }
  return { base: title };
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  f: FetchLike,
): Promise<unknown> {
  const res = await f(url, { headers, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_LOOKUP_BYTES) throw new Error('response too large');
  return JSON.parse(text);
}

/** Titles for a Kitsu anime id via the public Kitsu API (no key needed). */
export async function kitsuTitles(id: string, f: FetchLike = fetch): Promise<string[]> {
  const json = (await getJson(
    `https://kitsu.io/api/edge/anime/${encodeURIComponent(id)}`,
    { Accept: 'application/vnd.api+json' },
    f,
  )) as {
    data?: { attributes?: { canonicalTitle?: string; titles?: Record<string, string> } };
  };
  const a = json.data?.attributes;
  return [a?.titles?.en, a?.canonicalTitle, a?.titles?.en_jp].filter(
    (t): t is string => typeof t === 'string' && t.trim() !== '',
  );
}

/** Name for an IMDb id via Stremio's public Cinemeta add-on. */
export async function cinemetaTitle(
  type: 'movie' | 'series',
  imdbId: string,
  f: FetchLike = fetch,
): Promise<string | undefined> {
  const json = (await getJson(
    `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`,
    { Accept: 'application/json' },
    f,
  )) as { meta?: { name?: string } };
  return typeof json.meta?.name === 'string' ? json.meta.name : undefined;
}

/**
 * Build the lazy title resolver used when ID/hash searches find nothing.
 * Order: the playing file's name (best release match), then metadata titles.
 */
export function makeTitleResolver(opts: {
  video: VideoRef;
  filename?: string | undefined;
  logger: Logger;
  fetchImpl?: FetchLike;
}): () => Promise<TitleGuess[]> {
  const f = opts.fetchImpl ?? fetch;
  return async () => {
    const { video, logger } = opts;
    // Kitsu has one entry per season and no season number: with no "Season N" marker in the
    // title, assume season 1 so other seasons' episodes are never returned for it.
    const defaultSeason = video.idKind === 'kitsu' && video.episode !== undefined ? 1 : undefined;
    const guesses: TitleGuess[] = [];
    const add = (g: TitleGuess | undefined) => {
      if (!g || !g.title.trim()) return;
      const key = normalizeTitle(g.title);
      if (key && !guesses.some((x) => normalizeTitle(x.title) === key)) guesses.push(g);
    };

    const fromFile = opts.filename ? parseFilename(opts.filename) : undefined;
    if (fromFile) {
      const { base, season } = splitSeason(fromFile.title);
      add({
        title: base,
        ...((fromFile.season ?? season ?? video.season ?? defaultSeason)
          ? { season: (fromFile.season ?? season ?? video.season ?? defaultSeason) as number }
          : {}),
        ...((fromFile.episode ?? video.episode)
          ? { episode: (fromFile.episode ?? video.episode) as number }
          : {}),
      });
    }

    try {
      let names: string[] = [];
      if (video.idKind === 'kitsu') names = await kitsuTitles(video.externalId, f);
      else if (video.imdbId) {
        const n = await cinemetaTitle(video.type, video.imdbId, f);
        names = n ? [n] : [];
      }
      for (const name of names) {
        const { base, season } = splitSeason(name);
        const s = season ?? video.season ?? defaultSeason;
        add({
          title: base,
          ...(s !== undefined ? { season: s } : {}),
          ...(video.episode !== undefined ? { episode: video.episode } : {}),
        });
      }
    } catch (err) {
      logger.warn(
        {
          stage: 'SOURCE',
          idKind: video.idKind,
          reason: err instanceof Error ? err.message : 'error',
        },
        'title lookup failed',
      );
    }
    return guesses.slice(0, 4);
  };
}
