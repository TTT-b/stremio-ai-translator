import { AppError } from '../../errors';

export const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

export interface OpenSubtitlesCredentials {
  apiKey: string;
  username: string;
  password: string;
  userAgent: string;
}

/** Missing .env variables for the given credentials (names only). */
export function missingCredentials(c: OpenSubtitlesCredentials): string[] {
  const missing: string[] = [];
  if (!c.apiKey) missing.push('OPENSUBTITLES_API_KEY');
  if (!c.username) missing.push('OPENSUBTITLES_USERNAME');
  if (!c.password) missing.push('OPENSUBTITLES_PASSWORD');
  return missing;
}

/** Map an OpenSubtitles HTTP status to a normalized error. */
export function errorFromStatus(status: number): AppError {
  if (status === 401) return new AppError('SOURCE_AUTH_FAILED');
  if (status === 403) {
    return new AppError('INVALID_API_KEY', 'OpenSubtitles rejected the API key or User-Agent');
  }
  if (status === 406) return new AppError('SOURCE_QUOTA_EXCEEDED');
  if (status === 429) return new AppError('SOURCE_QUOTA_EXCEEDED', 'rate or daily limit');
  return new AppError('SOURCE_DOWNLOAD_FAILED', `HTTP ${status}`);
}
