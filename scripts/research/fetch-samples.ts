/**
 * Research helper: lists and downloads a few real subtitle files into data/research/ (gitignored)
 * for the accuracy measurements in docs/research/sync-accuracy.md. The files are never committed.
 *
 *   npx tsx scripts/research/fetch-samples.ts list tt0050083
 *   npx tsx scripts/research/fetch-samples.ts get <name> <fileId>
 *
 * RESEARCH_ENV may point at the .env to read (keys are used, never printed).
 */
import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/env';
import { createLogger } from '../../src/logging/logger';
import { OpenSubtitlesProvider } from '../../src/sources/opensubtitles/provider';
import { parseVideoId } from '../../src/sources/types';
import { parseSubtitle } from '../../src/subtitles/parse';

loadEnv({ path: process.env['RESEARCH_ENV'] ?? '.env', quiet: true });

const OUT_DIR = join('data', 'research');

async function main(): Promise<void> {
  const [mode, a, b] = process.argv.slice(2);
  const config = loadConfig();
  const provider = new OpenSubtitlesProvider({
    credentials: {
      apiKey: config.openSubtitlesApiKey,
      username: config.openSubtitlesUsername,
      password: config.openSubtitlesPassword,
      userAgent: config.openSubtitlesUserAgent,
    },
    logger: createLogger({ level: 'silent' }),
  });
  const quota = await provider.quota();
  process.stdout.write(`downloads left today: ${quota?.left ?? '?'} of ${quota?.limit ?? '?'}\n`);
  if (mode === 'list' && a) {
    const [id, type = 'movie'] = a.split('@');
    const found = await provider.search({
      video: parseVideoId(type, id as string),
      languages: ['en'],
    });
    for (const c of found.slice(0, 40)) {
      process.stdout.write(
        `${c.fileId}\t${c.downloadCount}\t${c.hearingImpaired ? 'HI' : '--'}\t${c.fileName}\n`,
      );
    }
    return;
  }
  if (mode === 'get' && a && b) {
    const got = await provider.download({
      fileId: Number(b),
      language: 'en',
      fileName: a,
      downloadCount: 0,
      rating: 0,
      hashMatch: false,
      hearingImpaired: false,
      machineTranslated: false,
    });
    mkdirSync(OUT_DIR, { recursive: true });
    const cues = parseSubtitle(got.content).cues;
    writeFileSync(join(OUT_DIR, `${a}.srt`), got.content, 'utf8');
    process.stdout.write(`saved ${a}.srt: ${cues.length} lines, left ${got.remaining ?? '?'}\n`);
    return;
  }
  process.stdout.write('usage: list <imdbId>[@series] | get <name> <fileId>\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
