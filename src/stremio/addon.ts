import type { RequestHandler } from 'express';
import sdk, { type Manifest } from 'stremio-addon-sdk';
import { findLanguage } from '../config/languages';
import type { Config } from '../config/env';
import type { JobManager } from '../jobs/manager';
import type { Logger } from '../logging/logger';
import { stripControlChars } from '../sources/titles';
import { parseVideoId } from '../sources/types';

export const MANIFEST: Manifest = {
  id: 'community.ai-subtitle-translator.local',
  version: '1.0.0',
  name: 'AI Subtitle Translator',
  description:
    'Local add-on: serves an existing subtitle in your language from OpenSubtitles, or translates an English one with Gemini.',
  resources: ['subtitles'],
  types: ['movie', 'series', 'anime'],
  // tt = IMDb, kitsu = Kitsu anime ids, tmdb = TMDB ids
  idPrefixes: ['tt', 'kitsu', 'tmdb'],
  catalogs: [],
  // Shows the gear button next to the add-on in Stremio; it opens `<add-on address>/configure`.
  behaviorHints: { configurable: true },
};

/** Stremio calls this for every video; we answer immediately and work in the background. */
export function createStremioRouter(deps: {
  config: () => Config;
  jobs: JobManager;
  logger: Logger;
}): RequestHandler {
  const builder = new sdk.addonBuilder(MANIFEST);

  builder.defineSubtitlesHandler(async ({ type, id, extra }) => {
    const log = deps.logger.child({ stage: 'STREMIO', type, id });
    const cfg = deps.config();
    try {
      const video = parseVideoId(type, id);
      const lang = findLanguage(cfg.targetLanguage);
      if (!lang) return { subtitles: [] };
      const hash =
        extra.videoHash && /^[0-9a-f]{16}$/i.test(extra.videoHash)
          ? extra.videoHash.toLowerCase()
          : undefined;
      // Plain text only: no control characters, bounded length (used for the text-search fallback).
      const filename =
        typeof extra.filename === 'string'
          ? stripControlChars(extra.filename).trim().slice(0, 300)
          : '';
      const job = deps.jobs.ensure({
        video,
        targetLanguage: lang.code,
        ...(hash ? { movieHash: hash } : {}),
        ...(filename ? { filename } : {}),
      });
      log.info(
        {
          jobId: job.id.slice(0, 8),
          jobStatus: job.status,
          hasHash: hash !== undefined,
          targetLanguage: lang.code,
        },
        'subtitles requested',
      );
      return {
        subtitles: [
          {
            id: `ai-${job.id}`,
            url: `http://127.0.0.1:${cfg.port}/sub/${job.id}.srt`,
            lang: lang.iso3,
          },
        ],
        cacheMaxAge: 30,
      };
    } catch (err) {
      log.warn(
        { errorCode: (err as { code?: string }).code ?? 'UNKNOWN' },
        'subtitles request ignored',
      );
      return { subtitles: [] };
    }
  });

  return sdk.getRouter(builder.getInterface());
}
