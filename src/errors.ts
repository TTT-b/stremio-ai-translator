export type ErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'INVALID_API_KEY'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'PROVIDER_MODEL_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'SOURCE_AUTH_FAILED'
  | 'SOURCE_QUOTA_EXCEEDED'
  | 'SOURCE_SUBTITLE_NOT_FOUND'
  | 'SOURCE_DOWNLOAD_FAILED'
  | 'SOURCE_FILE_TOO_LARGE'
  | 'UNSUPPORTED_SUBTITLE_FORMAT'
  | 'SUBTITLE_PARSE_FAILED'
  | 'TRANSLATION_VALIDATION_FAILED'
  | 'CACHE_READ_FAILED'
  | 'CACHE_WRITE_FAILED'
  | 'FINAL_SUBTITLE_INVALID'
  | 'STREMIO_REQUEST_INVALID';

interface ErrorMeta {
  httpStatus: number;
  retryable: boolean;
  userMessage: string;
}

export const ERROR_META: Record<ErrorCode, ErrorMeta> = {
  CONFIGURATION_INVALID: {
    httpStatus: 500,
    retryable: false,
    userMessage: 'The add-on configuration is incomplete or invalid. Check your .env file.',
  },
  INVALID_API_KEY: {
    httpStatus: 401,
    retryable: false,
    userMessage: 'The API key was rejected by the provider. Check the key in your .env file.',
  },
  PROVIDER_RATE_LIMITED: {
    httpStatus: 429,
    retryable: true,
    userMessage: 'The translation provider is rate limiting requests. Try again shortly.',
  },
  PROVIDER_QUOTA_EXCEEDED: {
    httpStatus: 429,
    retryable: false,
    userMessage: 'The translation provider quota or billing limit was reached.',
  },
  PROVIDER_MODEL_UNAVAILABLE: {
    httpStatus: 502,
    retryable: false,
    userMessage: 'The selected translation model is unavailable. Choose another model.',
  },
  PROVIDER_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    userMessage: 'The translation provider timed out or is temporarily unavailable.',
  },
  PROVIDER_RESPONSE_INVALID: {
    httpStatus: 502,
    retryable: true,
    userMessage: 'The translation provider returned an unusable response.',
  },
  SOURCE_AUTH_FAILED: {
    httpStatus: 401,
    retryable: false,
    userMessage: 'OpenSubtitles login failed. Check username and password in your .env file.',
  },
  SOURCE_QUOTA_EXCEEDED: {
    httpStatus: 429,
    retryable: false,
    userMessage: 'The OpenSubtitles download quota was reached. Try again after it resets.',
  },
  SOURCE_SUBTITLE_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    userMessage: 'No suitable source subtitle was found.',
  },
  SOURCE_DOWNLOAD_FAILED: {
    httpStatus: 502,
    retryable: true,
    userMessage: 'Downloading the source subtitle failed.',
  },
  SOURCE_FILE_TOO_LARGE: {
    httpStatus: 413,
    retryable: false,
    userMessage: 'The subtitle file is larger than the allowed limit.',
  },
  UNSUPPORTED_SUBTITLE_FORMAT: {
    httpStatus: 415,
    retryable: false,
    userMessage: 'The subtitle format is not supported (only SRT and WebVTT).',
  },
  SUBTITLE_PARSE_FAILED: {
    httpStatus: 422,
    retryable: false,
    userMessage: 'The subtitle file could not be parsed.',
  },
  TRANSLATION_VALIDATION_FAILED: {
    httpStatus: 502,
    retryable: false,
    userMessage: 'The translation failed validation and was discarded.',
  },
  CACHE_READ_FAILED: {
    httpStatus: 500,
    retryable: true,
    userMessage: 'Reading the translation cache failed.',
  },
  CACHE_WRITE_FAILED: {
    httpStatus: 500,
    retryable: true,
    userMessage: 'Writing the translation cache failed.',
  },
  FINAL_SUBTITLE_INVALID: {
    httpStatus: 500,
    retryable: false,
    userMessage: 'The final subtitle did not match the source (timing or cue count).',
  },
  STREMIO_REQUEST_INVALID: {
    httpStatus: 400,
    retryable: false,
    userMessage: 'The request was not valid.',
  },
};

/** Application error with a stable code. `message` is safe to show; never put secrets in it. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly userMessage: string;
  /** Structured, secret-free details for logs. */
  readonly details: Record<string, unknown>;
  /** Optional provider hint for how long to wait before retrying. */
  retryAfterMs?: number;

  constructor(code: ErrorCode, detail?: string, details: Record<string, unknown> = {}) {
    const meta = ERROR_META[code];
    super(detail ? `${meta.userMessage} (${detail})` : meta.userMessage);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = meta.httpStatus;
    this.retryable = meta.retryable;
    this.userMessage = meta.userMessage;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.userMessage, retryable: this.retryable };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
