import { AppError } from '../../errors';
import type { Logger } from '../../logging/logger';
import type { ConnectionTestResult } from '../../translation/provider';
import { decodeSubtitleBytes } from '../opensubtitles/decode';
import { normalizeTitle } from '../titles';
import type {
  DownloadedSubtitle,
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
} from '../types';
import { extractZipEntry, readZipEntries } from '../zip';

/**
 * SubDL (subdl.com): a second place to look for subtitles when OpenSubtitles has nothing or its
 * daily downloads are used up. Free API key; subtitles come as small zip files.
 */
export const SUBDL_API_URL = 'https://api.subdl.com/api/v1';
export const SUBDL_DOWNLOAD_URL = 'https://dl.subdl.com';

const MAX_ZIP_BYTES = 5 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_PATH = /^\/subtitle\/[\w.-]+(?:\/[\w.-]+)?$/;

export interface SubdlOptions {
  apiKey: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RawSubtitle {
  release_name?: unknown;
  name?: unknown;
  url?: unknown;
  season?: unknown;
  episode?: unknown;
  full_season?: unknown;
  hi?: unknown;
  language?: unknown;
}

interface RawResponse {
  status?: unknown;
  results?: { name?: unknown }[];
  subtitles?: RawSubtitle[];
}

/** SubDL asks for upper-case language codes, e.g. "EN". */
const apiLanguage = (code: string): string => code.split('-')[0]!.toUpperCase();

export class SubdlProvider implements SourceSubtitleProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: SubdlOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  getProviderName(): string {
    return 'subdl';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const base = { provider: 'subdl', model: '-' };
    if (!this.opts.apiKey) {
      return { ...base, ok: false, code: 'CONFIGURATION_INVALID', message: 'Missing SubDL key.' };
    }
    try {
      // A one-result search: SubDL answers 401/403 to a bad key and 200 to a good one.
      const res = await this.fetchImpl(
        `${SUBDL_API_URL}/subtitles?api_key=${encodeURIComponent(this.opts.apiKey)}&film_name=test&languages=EN&subs_per_page=1`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (res.status === 401 || res.status === 403) {
        return { ...base, ok: false, code: 'INVALID_API_KEY', message: 'SubDL rejected the key.' };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ...base, ok: true, message: 'SubDL key accepted.' };
    } catch {
      return {
        ...base,
        ok: false,
        code: 'SOURCE_DOWNLOAD_FAILED',
        message: 'Could not reach SubDL.',
      };
    }
  }

  private async getJson(params: URLSearchParams): Promise<RawResponse | undefined> {
    params.set('api_key', this.opts.apiKey);
    let res: Response;
    try {
      res = await this.fetchImpl(`${SUBDL_API_URL}/subtitles?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return undefined;
    }
    if (!res.ok) return undefined;
    const body = (await res.json().catch(() => null)) as RawResponse | null;
    return body && body.status !== false ? body : undefined;
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    if (!this.opts.apiKey) return [];
    const v = query.video;
    const log = this.opts.logger.child({ stage: 'SOURCE', provider: 'subdl' });
    const base = new URLSearchParams();
    let wantedTitle: string | undefined;
    let season = v.season;
    let episode = v.episode;
    if (v.idKind === 'imdb' && v.imdbId) base.set('imdb_id', v.imdbId);
    else if (v.idKind === 'tmdb') base.set('tmdb_id', v.externalId);
    else {
      const guess = (await query.resolveTitles?.().catch(() => []))?.[0];
      if (!guess) return [];
      wantedTitle = normalizeTitle(guess.title);
      base.set('film_name', guess.title);
      season = guess.season ?? v.season;
      episode = guess.episode ?? v.episode;
    }
    const isSeries = v.type === 'series';
    base.set('type', isSeries ? 'tv' : 'movie');
    if (isSeries) {
      if (season !== undefined) base.set('season_number', String(season));
      if (episode !== undefined) base.set('episode_number', String(episode));
    }
    base.set('subs_per_page', '30');
    base.set('hi', '1');

    const out: SubtitleCandidate[] = [];
    // One request per language, so each result's language is known for certain.
    for (const lang of [
      ...new Set(query.languages.map((l) => l.split('-')[0]!.toLowerCase())),
    ].slice(0, 3)) {
      const p = new URLSearchParams(base);
      p.set('languages', apiLanguage(lang));
      const body = await this.getJson(p);
      if (!body) continue;
      if (wantedTitle) {
        const name = body.results?.[0]?.name;
        // A text search can match a different show: keep it only when the title agrees.
        if (typeof name !== 'string' || !normalizeTitle(name).includes(wantedTitle)) continue;
      }
      for (const s of body.subtitles ?? []) {
        const c = this.candidate(s, lang, isSeries ? episode : undefined);
        if (c) out.push(c);
      }
    }
    log.info({ results: out.length }, 'search');
    return out;
  }

  private candidate(
    s: RawSubtitle,
    language: string,
    wantedEpisode: number | undefined,
  ): SubtitleCandidate | undefined {
    if (typeof s.url !== 'string' || !DOWNLOAD_PATH.test(s.url) || s.full_season === true) return;
    if (
      wantedEpisode !== undefined &&
      typeof s.episode === 'number' &&
      s.episode > 0 &&
      s.episode !== wantedEpisode
    ) {
      return;
    }
    const ids = /(\d+)-(\d+)/.exec(s.url);
    if (!ids) return;
    const fileName =
      typeof s.name === 'string'
        ? s.name
        : typeof s.release_name === 'string'
          ? s.release_name
          : '';
    return {
      fileId: Number(ids[2]),
      language,
      fileName,
      downloadCount: 0,
      rating: 0,
      hashMatch: false,
      hearingImpaired: s.hi === true,
      machineTranslated: false,
      provider: 'subdl',
      downloadPath: s.url,
    };
  }

  async download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle> {
    const path = candidate.downloadPath;
    if (!path || !DOWNLOAD_PATH.test(path)) throw new AppError('SOURCE_DOWNLOAD_FAILED');
    let res: Response;
    try {
      res = await this.fetchImpl(`${SUBDL_DOWNLOAD_URL}${path}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'could not reach SubDL');
    }
    if (res.status === 429) throw new AppError('SOURCE_QUOTA_EXCEEDED', 'SubDL download limit');
    if (!res.ok) throw new AppError('SOURCE_DOWNLOAD_FAILED', `HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_ZIP_BYTES) throw new AppError('SOURCE_FILE_TOO_LARGE');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_ZIP_BYTES) throw new AppError('SOURCE_FILE_TOO_LARGE');

    let file: Buffer = bytes;
    let fileName = candidate.fileName;
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
      try {
        const entry = readZipEntries(bytes).find((e) => /\.srt$/i.test(e.name));
        if (!entry) throw new AppError('UNSUPPORTED_SUBTITLE_FORMAT', 'no .srt in the archive');
        file = extractZipEntry(bytes, entry, MAX_SUBTITLE_BYTES);
        fileName = entry.name;
      } catch (err) {
        throw err instanceof AppError ? err : new AppError('SOURCE_DOWNLOAD_FAILED', 'bad archive');
      }
    }
    return { content: decodeSubtitleBytes(file), fileName };
  }
}
