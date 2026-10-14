import { AppError } from '../../errors';
import type { Logger } from '../../logging/logger';
import type { ConnectionTestResult } from '../../translation/provider';
import type {
  DownloadedSubtitle,
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
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
  };
}

export interface OpenSubtitlesProviderOptions {
  credentials: OpenSubtitlesCredentials;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

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
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'could not reach OpenSubtitles');
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
        message: `Missing in .env: ${missing.join(', ')}`,
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

  /** Build the search URL. Parameters must be lowercase and alphabetically sorted. */
  buildSearchUrl(q: SubtitleQuery, useHash: boolean): string {
    const p = new URLSearchParams();
    const v = q.video;
    if (useHash && q.movieHash) p.set('moviehash', q.movieHash);
    if (v.type === 'series') {
      p.set('episode_number', String(v.episode));
      p.set('parent_imdb_id', v.imdbId.replace(/^tt/, ''));
      p.set('season_number', String(v.season));
      p.set('type', 'episode');
    } else {
      p.set('imdb_id', v.imdbId.replace(/^tt/, ''));
      p.set('type', 'movie');
    }
    if (q.languages.length > 0) p.set('languages', [...q.languages].sort().join(','));
    const sorted = new URLSearchParams([...p.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return `${OPENSUBTITLES_BASE_URL}/subtitles?${sorted.toString()}`;
  }

  private async searchOnce(url: string): Promise<SubtitleCandidate[]> {
    this.assertConfigured(false);
    const res = await this.request(url, { headers: this.headers() });
    if (!res.ok) throw errorFromStatus(res.status);
    const body = (await res.json().catch(() => null)) as { data?: RawSubtitle[] } | null;
    if (!body || !Array.isArray(body.data)) {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'unexpected search response');
    }
    const out: SubtitleCandidate[] = [];
    for (const item of body.data) {
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
   * Search order: moviehash first (best timing match), then IMDb ID (+ season/episode).
   * If the requested languages give nothing, retry once without a language filter.
   */
  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const log = this.opts.logger.child({
      stage: 'SOURCE',
      imdbId: query.video.imdbId,
      season: query.video.season,
      episode: query.video.episode,
    });
    if (query.movieHash) {
      const byHash = await this.searchOnce(this.buildSearchUrl(query, true));
      const hashed = byHash.filter((c) => c.hashMatch);
      log.info(
        { strategy: 'moviehash', results: byHash.length, hashMatches: hashed.length },
        'search',
      );
      if (hashed.length > 0) return byHash;
    }
    let results = await this.searchOnce(this.buildSearchUrl(query, false));
    log.info({ strategy: 'imdb', results: results.length }, 'search');
    if (results.length === 0 && query.languages.length > 0) {
      results = await this.searchOnce(this.buildSearchUrl({ ...query, languages: [] }, false));
      log.info({ strategy: 'imdb-any-language', results: results.length }, 'search');
    }
    return results;
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
