import { AppError } from '../../errors';
import type { Logger } from '../../logging/logger';
import type { ConnectionTestResult } from '../../translation/provider';
import { normalizeTitle } from '../titles';
import type {
  DownloadedSubtitle,
  DownloadQuota,
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
  TitleGuess,
} from '../types';
import {
  errorFromStatus,
  missingCredentials,
  OPENSUBTITLES_BASE_URL,
  type OpenSubtitlesCredentials,
} from './client';
import { decodeSubtitleBytes } from './decode';

export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

/** Hosts a subtitle file may be downloaded from (HTTPS only). */
export function isAllowedDownloadUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return /(^|\.)opensubtitles\.(com|org)$/.test(host);
}

interface RawSubtitle {
  attributes?: {
    language?: string;
    download_count?: number;
    ratings?: number;
    moviehash_match?: boolean;
    hearing_impaired?: boolean;
    ai_translated?: boolean;
    machine_translated?: boolean;
    files?: { file_id?: number; file_name?: string }[];
    release?: string;
    feature_details?: {
      title?: string;
      parent_title?: string;
      movie_name?: string;
      season_number?: number;
      episode_number?: number;
    };
  };
}

export interface OpenSubtitlesProviderOptions {
  credentials: OpenSubtitlesCredentials;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /** Minimum gap between two API requests of the whole app (default 600 ms). Tests set 0. */
  requestGapMs?: number;
  /** Pause before retrying a rate-limited request when OpenSubtitles gives none (default 2 s). */
  retryDelayMs?: number;
}

/**
 * OpenSubtitles limits how fast one client may call its API. Every job makes several calls, and
 * jobs run side by side, so requests are spaced out across the whole app: a burst would be
 * refused with 429 ("too many requests") and the job would fail.
 */
let nextApiSlot = 0;
const MAX_RATE_RETRIES = 3;
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class OpenSubtitlesProvider implements SourceSubtitleProvider {
  private token?: { value: string; expiresAt: number };
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: OpenSubtitlesProviderOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  getProviderName(): string {
    return 'opensubtitles';
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const c = this.opts.credentials;
    return {
      'Api-Key': c.apiKey,
      'User-Agent': c.userAgent,
      Accept: 'application/json',
      ...extra,
    };
  }

  private assertConfigured(needLogin: boolean): void {
    const c = this.opts.credentials;
    const missing = needLogin ? missingCredentials(c) : c.apiKey ? [] : ['OPENSUBTITLES_API_KEY'];
    if (missing.length > 0) {
      throw new AppError('CONFIGURATION_INVALID', `missing ${missing.join(', ')}`);
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const api = url.startsWith(OPENSUBTITLES_BASE_URL);
    for (let attempt = 0; ; attempt++) {
      if (api) {
        const gap = this.opts.requestGapMs ?? 600;
        const slot = Math.max(Date.now(), nextApiSlot);
        nextApiSlot = slot + gap;
        if (slot > Date.now()) await sleepMs(slot - Date.now());
      }
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch {
        throw new AppError('SOURCE_DOWNLOAD_FAILED', 'could not reach OpenSubtitles');
      }
      // 429 = too many requests right now (not the daily download limit, which is 406): wait and retry.
      if (res.status !== 429 || !api || attempt >= MAX_RATE_RETRIES) return res;
      const asked = Number(res.headers.get('retry-after'));
      const wait =
        Number.isFinite(asked) && asked > 0 ? asked * 1000 : (this.opts.retryDelayMs ?? 2000);
      this.opts.logger.info(
        { stage: 'SOURCE', waitMs: Math.min(wait, 10_000) },
        'opensubtitles rate limit, waiting',
      );
      await sleepMs(Math.min(wait, 10_000));
    }
  }

  private async login(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > this.now()) return this.token.value;
    this.assertConfigured(true);
    const c = this.opts.credentials;
    const res = await this.request(`${OPENSUBTITLES_BASE_URL}/login`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username: c.username, password: c.password }),
    });
    if (!res.ok) throw errorFromStatus(res.status);
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!body || typeof body.token !== 'string' || body.token === '') {
      throw new AppError('SOURCE_AUTH_FAILED', 'login response had no token');
    }
    this.token = { value: body.token, expiresAt: this.now() + TOKEN_TTL_MS };
    this.opts.logger.info({ stage: 'SOURCE' }, 'opensubtitles login ok');
    return body.token;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const base = { provider: 'opensubtitles', model: '-' };
    const missing = missingCredentials(this.opts.credentials);
    if (missing.length > 0) {
      return {
        ...base,
        ok: false,
        code: 'CONFIGURATION_INVALID',
        message: `Missing: ${missing.join(', ')}. Add it in the API keys card.`,
      };
    }
    try {
      await this.login(true);
      return { ...base, ok: true, message: 'Logged in to OpenSubtitles successfully.' };
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('SOURCE_DOWNLOAD_FAILED');
      return { ...base, ok: false, code: e.code, message: e.message };
    }
  }

  private finishUrl(p: URLSearchParams, languages: string[]): string {
    if (languages.length > 0) p.set('languages', [...languages].sort().join(','));
    // OpenSubtitles requires lowercase parameter names in alphabetical order.
    const sorted = new URLSearchParams([...p.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return `${OPENSUBTITLES_BASE_URL}/subtitles?${sorted.toString()}`;
  }

  /**
   * Search URL by hash and/or provider ID (IMDb or TMDB). Returns undefined when there is
   * nothing to search with (e.g. a Kitsu id with no file hash) - never sends empty ids.
   */
  buildSearchUrl(q: SubtitleQuery, useHash: boolean): string | undefined {
    const p = new URLSearchParams();
    const v = q.video;
    const hash = useHash ? q.movieHash : undefined;
    if (hash) p.set('moviehash', hash);

    const idValue =
      v.idKind === 'imdb' && v.imdbId
        ? v.imdbId.replace(/^tt/, '')
        : v.idKind === 'tmdb'
          ? v.externalId
          : undefined;
    if (idValue && /^\d+$/.test(idValue)) {
      const prefix = v.idKind === 'tmdb' ? 'tmdb' : 'imdb';
      if (v.type === 'series' && v.episode !== undefined && v.season !== undefined) {
        p.set('episode_number', String(v.episode));
        p.set(`parent_${prefix}_id`, idValue);
        p.set('season_number', String(v.season));
        p.set('type', 'episode');
      } else {
        p.set(`${prefix}_id`, idValue);
        if (v.type === 'movie') p.set('type', 'movie');
      }
    }
    if (
      !p.has('moviehash') &&
      !p.has('imdb_id') &&
      !p.has('tmdb_id') &&
      !p.has('parent_imdb_id') &&
      !p.has('parent_tmdb_id')
    ) {
      return undefined;
    }
    return this.finishUrl(p, q.languages);
  }

  /** Free-text search URL for a title guess. */
  buildTextUrl(
    guess: TitleGuess,
    languages: string[],
    opts: { withSeason: boolean; withEpisode: boolean },
  ): string {
    const p = new URLSearchParams();
    p.set('query', normalizeTitle(guess.title));
    if (guess.episode !== undefined && opts.withEpisode) {
      p.set('episode_number', String(guess.episode));
      p.set('type', 'episode');
      if (opts.withSeason && guess.season !== undefined)
        p.set('season_number', String(guess.season));
    }
    return this.finishUrl(p, languages);
  }

  private async searchOnce(
    url: string,
    accept?: (raw: RawSubtitle) => boolean,
  ): Promise<SubtitleCandidate[]> {
    this.assertConfigured(false);
    const res = await this.request(url, { headers: this.headers() });
    if (!res.ok) throw errorFromStatus(res.status);
    const body = (await res.json().catch(() => null)) as { data?: RawSubtitle[] } | null;
    if (!body || !Array.isArray(body.data)) {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'unexpected search response');
    }
    const out: SubtitleCandidate[] = [];
    for (const item of body.data) {
      if (!item || (accept && !accept(item))) continue;
      const a = item.attributes;
      const file = a?.files?.[0];
      if (!a || typeof a.language !== 'string' || typeof file?.file_id !== 'number') continue;
      out.push({
        fileId: file.file_id,
        language: a.language,
        fileName: file.file_name ?? a.release ?? '',
        downloadCount: a.download_count ?? 0,
        rating: a.ratings ?? 0,
        hashMatch: a.moviehash_match === true,
        hearingImpaired: a.hearing_impaired === true,
        machineTranslated: a.ai_translated === true || a.machine_translated === true,
      });
    }
    return out;
  }

  /**
   * Search ladder (each step only runs when the previous one found nothing):
   *  1. moviehash (best timing match)
   *  2. IMDb / TMDB id (+ season/episode)
   *  3. same id search without a language filter
   *  4. text search by title guesses (file name, then Kitsu/Cinemeta titles), keeping only
   *     results that really belong to that title and episode
   */
  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const v = query.video;
    const log = this.opts.logger.child({
      stage: 'SOURCE',
      idKind: v.idKind,
      id: v.externalId,
      season: v.season,
      episode: v.episode,
    });

    if (query.movieHash) {
      const url = this.buildSearchUrl({ ...query, languages: query.languages }, true);
      if (url) {
        const byHash = await this.searchOnce(url);
        const hashed = byHash.filter((c) => c.hashMatch);
        log.info(
          { strategy: 'moviehash', results: byHash.length, hashMatches: hashed.length },
          'search',
        );
        if (hashed.length > 0) return byHash;
      }
    }

    const hasProviderId = v.idKind === 'imdb' || v.idKind === 'tmdb';
    const idUrl = hasProviderId ? this.buildSearchUrl(query, false) : undefined;
    if (idUrl) {
      let results = await this.searchOnce(idUrl);
      log.info({ strategy: 'id', results: results.length }, 'search');
      if (results.length === 0 && query.languages.length > 0) {
        const anyUrl = this.buildSearchUrl({ ...query, languages: [] }, false);
        if (anyUrl) results = await this.searchOnce(anyUrl);
        log.info({ strategy: 'id-any-language', results: results.length }, 'search');
      }
      if (results.length > 0) return results;
    } else {
      log.info({ strategy: 'id' }, 'no usable id for this video, using text search');
    }

    return this.searchByText(query, log);
  }

  private async searchByText(query: SubtitleQuery, log: Logger): Promise<SubtitleCandidate[]> {
    if (!query.resolveTitles) return [];
    const guesses = await query.resolveTitles();
    for (const guess of guesses) {
      const wanted = normalizeTitle(guess.title);
      const belongsToTitle = (raw: RawSubtitle): boolean => {
        const f = raw.attributes?.feature_details;
        const hay = [f?.parent_title, f?.title, f?.movie_name, raw.attributes?.release]
          .filter((s): s is string => typeof s === 'string')
          .map(normalizeTitle);
        return hay.some((h) => h.includes(wanted));
      };
      const isEpisode = (raw: RawSubtitle): boolean => {
        if (guess.episode === undefined) return true;
        const f = raw.attributes?.feature_details;
        if (typeof f?.episode_number === 'number' && f.episode_number > 0) {
          const seasonOk =
            guess.season === undefined ||
            typeof f.season_number !== 'number' ||
            f.season_number === guess.season;
          return f.episode_number === guess.episode && seasonOk;
        }
        const rel = raw.attributes?.release ?? '';
        return new RegExp(`(?<!\\d)0*${guess.episode}(?!\\d)`).test(rel);
      };

      const attempts = [
        { withSeason: true, withEpisode: true },
        { withSeason: false, withEpisode: true },
        { withSeason: false, withEpisode: false },
      ];
      const seen = new Set<string>();
      for (const opts of attempts) {
        const url = this.buildTextUrl(guess, query.languages, opts);
        if (seen.has(url)) continue;
        seen.add(url);
        const found = await this.searchOnce(url, (r) => belongsToTitle(r) && isEpisode(r));
        log.info(
          { strategy: 'text', title: guess.title, ...opts, results: found.length },
          'search',
        );
        if (found.length > 0) return found;
      }
    }
    return [];
  }

  /** Daily download allowance of the account, or undefined when it cannot be read. */
  async quota(): Promise<DownloadQuota | undefined> {
    try {
      const call = async (token: string) =>
        this.request(`${OPENSUBTITLES_BASE_URL}/infos/user`, {
          method: 'GET',
          headers: this.headers({ Authorization: `Bearer ${token}` }),
        });
      let res = await call(await this.login());
      if (res.status === 401) res = await call(await this.login(true));
      if (!res.ok) return undefined;
      const body = (await res.json().catch(() => null)) as {
        data?: { allowed_downloads?: unknown; remaining_downloads?: unknown };
      } | null;
      const limit = body?.data?.allowed_downloads;
      const left = body?.data?.remaining_downloads;
      if (typeof limit !== 'number' || typeof left !== 'number' || limit <= 0) return undefined;
      return { limit, left: Math.max(0, Math.min(left, limit)) };
    } catch {
      return undefined;
    }
  }

  async download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle> {
    const log = this.opts.logger.child({ stage: 'DOWNLOAD', fileId: candidate.fileId });
    const call = async (token: string) =>
      this.request(`${OPENSUBTITLES_BASE_URL}/download`, {
        method: 'POST',
        headers: this.headers({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ file_id: candidate.fileId, sub_format: 'srt' }),
      });

    let res = await call(await this.login());
    if (res.status === 401) res = await call(await this.login(true)); // token expired
    if (!res.ok) throw errorFromStatus(res.status);

    const meta = (await res.json().catch(() => null)) as {
      link?: unknown;
      file_name?: unknown;
      remaining?: unknown;
    } | null;
    if (!meta || typeof meta.link !== 'string' || !isAllowedDownloadUrl(meta.link)) {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'download link missing or not allowed');
    }
    const remaining = typeof meta.remaining === 'number' ? meta.remaining : undefined;

    const file = await this.request(meta.link, {
      headers: { 'User-Agent': this.opts.credentials.userAgent },
    });
    if (!file.ok) throw new AppError('SOURCE_DOWNLOAD_FAILED', `HTTP ${file.status}`);
    // Redirects must not leave the allow-list either.
    if (file.url && !isAllowedDownloadUrl(file.url)) {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'redirected to a disallowed host');
    }
    const declared = Number(file.headers.get('content-length') ?? 0);
    if (declared > MAX_SUBTITLE_BYTES) throw new AppError('SOURCE_FILE_TOO_LARGE');

    const bytes = await readLimited(file, MAX_SUBTITLE_BYTES);
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
      throw new AppError('UNSUPPORTED_SUBTITLE_FORMAT', 'zip archive');
    }
    log.info({ bytes: bytes.length, remaining }, 'subtitle downloaded');
    return {
      content: decodeSubtitleBytes(bytes),
      fileName: typeof meta.file_name === 'string' ? meta.file_name : candidate.fileName,
      ...(remaining !== undefined ? { remaining } : {}),
    };
  }
}

async function readLimited(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new AppError('SOURCE_FILE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
