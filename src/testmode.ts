import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from './errors';
import type {
  DownloadedSubtitle,
  SourceSubtitleProvider,
  SubtitleCandidate,
} from './sources/types';
import type { TranslationProvider } from './translation/provider';

/**
 * Test mode (Advanced settings): no OpenSubtitles, no AI. A subtitle file is picked at random from
 * the built-in samples and from any .srt files in <data>/test-subtitles, and "translated" by
 * putting a prefix in front of every line. It runs through the real queue, so the buttons and the
 * diagnostics can be tried without playing a video or spending any quota.
 */

const MAX_FILES = 50;
const MAX_FILE_BYTES = 512 * 1024;
const STEP_DELAY_MS = 1500;

function srt(lines: string[], startSec = 1, stepSec = 3): string {
  const ts = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(Math.floor(s % 60))},000`;
  };
  return lines
    .map((text, i) => {
      const a = startSec + i * stepSec;
      return `${i + 1}\n${ts(a)} --> ${ts(a + stepSec - 0.5)}\n${text}\n`;
    })
    .join('\n');
}

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => `Line number ${i + 1} of the test.`);

/** Built-in samples, so test mode works with an empty folder. */
export const BUILTIN_SAMPLES: { name: string; content: string }[] = [
  {
    name: 'short.srt',
    content: srt([
      'Good morning.',
      '<i>Not really.</i>',
      '- Where are we going?\n- To the harbor.',
    ]),
  },
  { name: 'long.srt', content: srt(many(120), 1, 4) },
  {
    name: 'special.srt',
    content: srt([
      '"Quotes", commas, and: colons!',
      '♪ La la la ♪',
      'שלום, מה שלומך?',
      'Line one\nLine two\nLine three',
      '...',
      '<b>Bold</b> and <i>italic</i> text.',
    ]),
  },
  { name: 'repeated.srt', content: srt(['No.', 'No.', 'No.', 'Yes!', 'No.', 'Run!', 'Run!']) },
];

/** Folder the user can drop their own .srt files into. */
export function testSubtitlesDir(dataDir: string): string {
  const dir = join(dataDir, 'test-subtitles');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Built-in samples plus the user's files (small .srt files only). */
export function listTestSubtitles(dataDir: string): { name: string; content: string }[] {
  const all = [...BUILTIN_SAMPLES];
  try {
    const dir = testSubtitlesDir(dataDir);
    for (const name of readdirSync(dir)) {
      if (all.length >= MAX_FILES + BUILTIN_SAMPLES.length) break;
      const file = join(dir, name);
      if (!/\.srt$/i.test(name) || !existsSync(file)) continue;
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      all.push({ name, content: readFileSync(file, 'utf8') });
    }
  } catch {
    // An unreadable folder only means the built-in samples are used.
  }
  return all;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One pretend OpenSubtitles: a random sample per instance, with a short delay so the queue is visible. */
export function makeTestSource(dataDir: string): SourceSubtitleProvider {
  const files = listTestSubtitles(dataDir);
  const chosen = files[randomInt(files.length)] ?? BUILTIN_SAMPLES[0]!;
  return {
    getProviderName: () => 'Test mode',
    async search(): Promise<SubtitleCandidate[]> {
      await wait(STEP_DELAY_MS);
      return [
        {
          fileId: 1,
          language: 'en',
          fileName: chosen.name,
          downloadCount: 1,
          rating: 10,
          hashMatch: true,
          hearingImpaired: false,
          machineTranslated: false,
        },
      ];
    },
    async download(): Promise<DownloadedSubtitle> {
      return { content: chosen.content, fileName: chosen.name };
    },
    async testConnection() {
      return { ok: true, provider: 'Test mode', model: 'test', message: 'Test mode' };
    },
  };
}

/** A pretend AI: every line comes back with a prefix, after a short delay. */
export function makeTestProvider(): TranslationProvider {
  return {
    getProviderName: () => 'Test mode',
    getModelInformation: () => ({ provider: 'Test mode', model: 'test' }),
    async testConnection() {
      return { ok: true, provider: 'Test mode', model: 'test', message: 'Test mode' };
    },
    async translateChunk(request) {
      await wait(400);
      return {
        translations: request.cues.map((c) => ({ id: c.id, text: `HE: ${c.text}` })),
      };
    },
    normalizeError: (err) =>
      err instanceof AppError ? err : new AppError('PROVIDER_RESPONSE_INVALID', 'test mode'),
  };
}

/** A fresh made-up episode each time, so every test is a new job. */
export function randomTestVideoId(): string {
  const n = 9_000_000 + randomInt(1_000_000);
  return `tt${n}:1:${1 + randomInt(24)}`;
}
