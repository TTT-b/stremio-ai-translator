declare module 'stremio-addon-sdk' {
  import type { RequestHandler } from 'express';

  export interface SubtitleObject {
    id: string;
    url: string;
    lang: string;
  }

  export interface SubtitlesArgs {
    type: string;
    id: string;
    extra: Record<string, string | undefined>;
    config?: unknown;
  }

  export interface SubtitlesResponse {
    subtitles: SubtitleObject[];
    cacheMaxAge?: number;
    staleRevalidate?: number;
    staleError?: number;
  }

  export interface Manifest {
    id: string;
    version: string;
    name: string;
    description: string;
    resources: string[];
    types: string[];
    idPrefixes?: string[];
    catalogs: unknown[];
    behaviorHints?: Record<string, boolean>;
  }

  export class addonBuilder {
    constructor(manifest: Manifest);
    defineSubtitlesHandler(handler: (args: SubtitlesArgs) => Promise<SubtitlesResponse>): this;
    getInterface(): unknown;
  }

  export function getRouter(addonInterface: unknown): RequestHandler;

  const sdk: { addonBuilder: typeof addonBuilder; getRouter: typeof getRouter };
  export default sdk;
}
