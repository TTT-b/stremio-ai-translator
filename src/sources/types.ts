import { AppError } from '../errors';

export interface VideoRef {
  type: 'movie' | 'series';
  /** IMDb ID including the "tt" prefix. */
  imdbId: string;
  season?: number;
  episode?: number;
}

/** Parse a Stremio video id: "tt1234567" (movie) or "tt1234567:1:2" (series S1E2). */
export function parseVideoId(type: string, id: string): VideoRef {
  const m = /^(tt\d{5,10})(?::(\d{1,4}):(\d{1,5}))?$/.exec(id);
  if (!m || (type !== 'movie' && type !== 'series')) {
    throw new AppError('STREMIO_REQUEST_INVALID', 'unsupported id or type');
  }
  const imdbId = m[1] as string;
  if (type === 'series') {
    if (m[2] === undefined || m[3] === undefined) {
      throw new AppError('STREMIO_REQUEST_INVALID', 'series id needs season and episode');
    }
    return { type, imdbId, season: Number(m[2]), episode: Number(m[3]) };
  }
  return { type, imdbId };
}

export interface SubtitleQuery {
  video: VideoRef;
  /** Language codes to search for (ISO 639-1), most wanted first. */
  languages: string[];
  /** OpenSubtitles 64-bit file hash from Stremio `extra.videoHash`. */
  movieHash?: string;
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
}

export interface DownloadedSubtitle {
  /** Decoded UTF-8 text (BOM stripped). */
  content: string;
  fileName: string;
  /** Downloads left today, when the provider reports it. */
  remaining?: number;
}

/** Replaceable source of subtitles; translation code only depends on this. */
export interface SourceSubtitleProvider {
  getProviderName(): string;
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>;
  download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle>;
  testConnection(): Promise<import('../translation/provider').ConnectionTestResult>;
}
