import type { ConnectionTestResult } from '../translation/provider';
import type {
  DownloadedSubtitle,
  DownloadQuota,
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
} from './types';

/**
 * OpenSubtitles first, with a second provider beside it. Candidates of both are listed together
 * (the second one ranks lower), so when OpenSubtitles has nothing, or its daily downloads are used
 * up, the job can still be served. A failure of the second provider never fails a search.
 */
export class FallbackSource implements SourceSubtitleProvider {
  /**
   * preferSecond: the second provider is asked first and the first one only when it has nothing
   * (or fails), so the first provider's daily downloads are not touched when the second one can serve.
   */
  constructor(
    private readonly primary: SourceSubtitleProvider,
    private readonly secondary: SourceSubtitleProvider,
    private readonly preferSecond = false,
  ) {}

  getProviderName(): string {
    return `${this.primary.getProviderName()}+${this.secondary.getProviderName()}`;
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    if (this.preferSecond) {
      const found = await this.secondary.search(query).catch(() => [] as SubtitleCandidate[]);
      if (found.length > 0) return found;
      return this.primary.search(query);
    }
    const second = this.secondary.search(query).catch(() => [] as SubtitleCandidate[]);
    let first: SubtitleCandidate[];
    try {
      first = await this.primary.search(query);
    } catch (err) {
      const rest = await second;
      if (rest.length > 0) return rest;
      throw err;
    }
    return [...first, ...(await second)];
  }

  download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle> {
    return candidate.provider === 'subdl'
      ? this.secondary.download(candidate)
      : this.primary.download(candidate);
  }

  testConnection(): Promise<ConnectionTestResult> {
    return this.primary.testConnection();
  }

  quota(): Promise<DownloadQuota | undefined> {
    return this.primary.quota?.() ?? Promise.resolve(undefined);
  }
}
