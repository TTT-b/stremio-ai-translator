import { AppError } from '../errors';
import type { ConnectionTestResult } from '../translation/provider';

export type IdKind = 'imdb' | 'tmdb' | 'kitsu';

export interface VideoRef {
  type: 'movie' | 'series';
  idKind: IdKind;
  /** The id without episode parts: "tt0111161", "603" (tmdb) or "49294" (kitsu). */
  externalId: string;
  /** Set only when idKind is "imdb". */
  imdbId?: string;
  season?: number;
  episode?: number;
}

/**
 * Parse a Stremio video id.
 *  - IMDb:  "tt1234567"            movie        | "tt1234567:1:2"  series S1E2
 *  - TMDB:  "tmdb:603"             movie        | "tmdb:1399:1:2"  series S1E2
 *  - Kitsu: "kitsu:49294"          movie/OVA    | "kitsu:49294:3"  episode 3
 * The legacy Stremio type "anime" is treated as series when an episode is present.
 */
export function parseVideoId(type: string, id: string): VideoRef {
  const bad = (why: string) => new AppError('STREMIO_REQUEST_INVALID', why);
  if (type !== 'movie' && type !== 'series' && type !== 'anime') throw bad('unsupported type');

  const imdb = /^(tt\d{5,10})(?::(\d{1,4}):(\d{1,5}))?$/.exec(id);
  if (imdb) {
    const hasEpisode = imdb[2] !== undefined && imdb[3] !== undefined;
    if (type === 'series' && !hasEpisode) throw bad('series id needs season and episode');
    const ref: VideoRef = {
      type: hasEpisode ? 'series' : 'movie',
      idKind: 'imdb',
      externalId: imdb[1] as string,
      imdbId: imdb[1] as string,
    };
    if (hasEpisode) {
      ref.season = Number(imdb[2]);
      ref.episode = Number(imdb[3]);
    }
    return ref;
  }

  const tmdb = /^tmdb:(\d{1,10})(?::(\d{1,4}):(\d{1,5}))?$/.exec(id);
  if (tmdb) {
    const hasEpisode = tmdb[2] !== undefined && tmdb[3] !== undefined;
    if (type === 'series' && !hasEpisode) throw bad('series id needs season and episode');
    const ref: VideoRef = {
      type: hasEpisode ? 'series' : 'movie',
      idKind: 'tmdb',
      externalId: tmdb[1] as string,
    };
    if (hasEpisode) {
      ref.season = Number(tmdb[2]);
      ref.episode = Number(tmdb[3]);
    }
    return ref;
  }

  const kitsu = /^kitsu:(\d{1,10})(?::(\d{1,5}))?$/.exec(id);
  if (kitsu) {
    const ref: VideoRef = {
      type: kitsu[2] !== undefined ? 'series' : 'movie',
      idKind: 'kitsu',
      externalId: kitsu[1] as string,
    };
    if (kitsu[2] !== undefined) ref.episode = Number(kitsu[2]);
    return ref;
  }
  throw bad('unsupported id');
}

/** A title (and episode position) to search for by text when ID/hash searches find nothing. */
export interface TitleGuess {
  title: string;
  season?: number;
  episode?: number;
}

export interface SubtitleQuery {
  video: VideoRef;
  /** Language codes to search for (ISO 639-1), most wanted first. */
  languages: string[];
  /** OpenSubtitles 64-bit file hash from Stremio `extra.videoHash`. */
  movieHash?: string;
  /**
   * Called only when hash and ID searches return nothing. Returns titles to search by text
   * (from the video file name or a metadata lookup). May return an empty list.
   */
  resolveTitles?: () => Promise<TitleGuess[]>;
}

export interface SubtitleCandidate {
  /** Provider's file id used for download. */
  fileId: number;
  language: string;
  fileName: string;
  downloadCount: number;
  rating: number;
  hashMatch: boolean;
  hearingImpaired: boolean;
  /** True when the provider marks it as machine/AI translated. */
  machineTranslated: boolean;
  /** Which provider it came from; OpenSubtitles when absent. */
  provider?: 'opensubtitles' | 'subdl';
  /** Provider-specific download path (SubDL). */
  downloadPath?: string;
}

export interface DownloadedSubtitle {
  /** Decoded UTF-8 text (BOM stripped). */
  content: string;
  fileName: string;
  /** Downloads left today, when the provider reports it. */
  remaining?: number;
}

/** A provider's daily download allowance, as it reports it. */
export interface DownloadQuota {
  /** Downloads allowed per day. */
  limit: number;
  /** Downloads still available today. */
  left: number;
}

/** Replaceable source of subtitles; translation code only depends on this. */
export interface SourceSubtitleProvider {
  /** The account's daily download allowance, when the provider can tell (never throws). */
  quota?(): Promise<DownloadQuota | undefined>;
  getProviderName(): string;
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>;
  download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle>;
  testConnection(): Promise<ConnectionTestResult>;
}
