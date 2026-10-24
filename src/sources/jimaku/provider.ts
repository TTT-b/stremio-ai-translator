import { createHash } from 'node:crypto';
import { AppError } from '../../errors';
import type { Logger } from '../../logging/logger';
import type { ConnectionTestResult } from '../../translation/provider';
import { decodeSubtitleBytes } from '../opensubtitles/decode';
import { fileIsEpisode } from '../pack';
import { normalizeTitle } from '../titles';
import type {
  DownloadedSubtitle,
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
} from '../types';

/**
 * Jimaku (jimaku.cc): subtitles for anime, almost all in Japanese, one file per episode. They are
 * the last resort (translating from Japanese is worse than from English). Needs a free API key.
 */
export const JIMAKU_API_URL = 'https://jimaku.cc/api';
const FILE_HOST = 'jimaku.cc';
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
/** Entries tried per search: a title can have a TV entry, a movie entry and a recap. */
const MAX_ENTRIES = 3;

export interface JimakuOptions {
  apiKey: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RawEntry {
  id?: unknown;
  name?: unknown;
  english_name?: unknown;
  japanese_name?: unknown;
}

interface RawFile {
  name?: unknown;
  url?: unknown;
  size?: unknown;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A stable positive number for a file, used where the app expects a numeric file id. */
function fileIdFor(url: string): number {
  return createHash('sha1').update(url).digest().readUInt32BE(0);
}

export class JimakuProvider implements SourceSubtitleProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: JimakuOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  getProviderName(): string {
    return 'jimaku';
  }

  private get(path: string): Promise<Response> {
    return this.fetchImpl(`${JIMAKU_API_URL}${path}`, {
      headers: { Authorization: this.opts.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const base = { provider: 'jimaku', model: '-' };
    if (!this.opts.apiKey) {
      return { ...base, ok: false, code: 'CONFIGURATION_INVALID', message: 'Missing Jimaku key.' };
    }
    try {
      const res = await this.get('/entries/search?query=test');
      if (res.status === 401 || res.status === 403) {
        return { ...base, ok: false, code: 'INVALID_API_KEY', message: 'Jimaku rejected the key.' };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ...base, ok: true, message: 'Jimaku key accepted.' };
    } catch {
      return {
        ...base,
        ok: false,
        code: 'SOURCE_DOWNLOAD_FAILED',
        message: 'Could not reach Jimaku.',
      };
    }
  }

  private async json(path: string): Promise<unknown> {
    try {
      const res = await this.get(path);
      if (!res.ok) return undefined; // 429 = too many requests for now; treated as "nothing"
      return await res.json();
    } catch {
      return undefined;
    }
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    if (!this.opts.apiKey) return [];
    const log = this.opts.logger.child({ stage: 'SOURCE', provider: 'jimaku' });
    const guess = (await query.resolveTitles?.().catch(() => []))?.[0];
    if (!guess) return [];
    const wantedTitle = normalizeTitle(guess.title);
    if (!wantedTitle) return [];
    // The file name's own episode number is used first: anime packs number episodes straight through.
    const episode = guess.episode ?? query.video.episode;
    const isSeries = query.video.type === 'series';
    if (isSeries && episode === undefined) return [];
    const season = guess.season ?? query.video.season;
    // Jimaku numbers long anime straight through ("- 052"), so a bare number is trusted only for
    // the first season; for a later one the file name must say the season.
    const bare = season === undefined || season <= 1;

    const found = await this.json(`/entries/search?query=${encodeURIComponent(guess.title)}`);
    const entries = (Array.isArray(found) ? (found as RawEntry[]) : [])
      .filter((e) => typeof e.id === 'number')
      .filter((e) =>
        [e.name, e.english_name, e.japanese_name]
          .map((n) => normalizeTitle(asText(n)))
          .some((n) => n !== '' && (n === wantedTitle || n.includes(wantedTitle))),
      )
      .slice(0, MAX_ENTRIES);

    const out: SubtitleCandidate[] = [];
    for (const entry of entries) {
      const files = await this.json(
        `/entries/${String(entry.id)}/files${isSeries ? `?episode=${String(episode)}` : ''}`,
      );
      for (const f of Array.isArray(files) ? (files as RawFile[]) : []) {
        const url = asText(f.url);
        const name = asText(f.name);
        if (!/\.srt$/i.test(name) || !this.isOwnFile(url)) continue;
        // The episode filter of the API is loose: a file of another episode (or show) is dropped.
        if (isSeries && !fileIsEpisode(name, season, episode as number, bare)) continue;
        if (typeof f.size === 'number' && f.size > MAX_SUBTITLE_BYTES) continue;
        out.push({
          fileId: fileIdFor(url),
          language: 'ja',
          fileName: name,
          downloadCount: 0,
          rating: 0,
          hashMatch: false,
          hearingImpaired: /\[cc\]|\bcc\b/i.test(name),
          machineTranslated: false,
          provider: 'jimaku',
          downloadPath: url,
        });
      }
      if (out.length > 0) break; // the first entry that has this episode is the right one
    }
    log.info({ results: out.length }, 'search');
    return out;
  }

  /** Only files on Jimaku's own host are ever downloaded. */
  private isOwnFile(url: string): boolean {
    try {
      const u = new URL(url);
      return (
        u.protocol === 'https:' &&
        (u.hostname === FILE_HOST || u.hostname.endsWith(`.${FILE_HOST}`))
      );
    } catch {
      return false;
    }
  }

  async download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle> {
    const url = candidate.downloadPath;
    if (!url || !this.isOwnFile(url)) throw new AppError('SOURCE_DOWNLOAD_FAILED');
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: this.opts.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError('SOURCE_DOWNLOAD_FAILED', 'could not reach Jimaku');
    }
    if (res.status === 429) throw new AppError('SOURCE_QUOTA_EXCEEDED', 'Jimaku rate limit');
    if (!res.ok) throw new AppError('SOURCE_DOWNLOAD_FAILED', `HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_SUBTITLE_BYTES) throw new AppError('SOURCE_FILE_TOO_LARGE');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_SUBTITLE_BYTES) throw new AppError('SOURCE_FILE_TOO_LARGE');
    return { content: decodeSubtitleBytes(bytes), fileName: candidate.fileName };
  }
}
