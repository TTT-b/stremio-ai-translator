import type { ConnectionTestResult } from '../translation/provider';
import type {
  DownloadedSubtitle,
  DownloadQuota,
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
} from './types';

export type SourceId = 'opensubtitles' | 'subdl' | 'jimaku';

export interface OrderedEntry {
  id: SourceId;
  provider: SourceSubtitleProvider;
}

/**
 * Several subtitle providers in the user's order. Every provider is asked at once (a search costs
 * no download), each candidate remembers its place in the order, and the selection prefers the
 * earlier one. A provider that fails never fails the search, unless nothing was found and either
 * all of them failed or OpenSubtitles (the main one) did.
 */
export class OrderedSource implements SourceSubtitleProvider {
  constructor(private readonly entries: OrderedEntry[]) {}

  getProviderName(): string {
    return this.entries.map((e) => e.provider.getProviderName()).join('+');
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    let firstError: unknown;
    let failed = 0;
    let mainFailed = false;
    const lists = await Promise.all(
      this.entries.map(async (entry, rank) => {
        try {
          const found = await entry.provider.search(query);
          return found.map((c) => ({ ...c, providerRank: rank }));
        } catch (err) {
          failed++;
          if (entry.id === 'opensubtitles') mainFailed = true;
          firstError ??= err;
          return [] as SubtitleCandidate[];
        }
      }),
    );
    const all = lists.flat();
    // Nothing found: say why only when the failure could be the reason (all failed, or the main one).
    if (all.length === 0 && (mainFailed || failed === this.entries.length)) throw firstError;
    return all;
  }

  download(candidate: SubtitleCandidate): Promise<DownloadedSubtitle> {
    const id: SourceId = candidate.provider ?? 'opensubtitles';
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return Promise.reject(new Error(`no provider for ${id}`));
    return entry.provider.download(candidate);
  }

  testConnection(): Promise<ConnectionTestResult> {
    const entry = this.entries.find((e) => e.id === 'opensubtitles') ?? this.entries[0];
    if (!entry) throw new Error('no providers');
    return entry.provider.testConnection();
  }

  quota(): Promise<DownloadQuota | undefined> {
    const entry = this.entries.find((e) => e.id === 'opensubtitles');
    return entry?.provider.quota?.() ?? Promise.resolve(undefined);
  }
}
