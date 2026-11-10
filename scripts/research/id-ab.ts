/**
 * Research: does telling the model the exact number of lines (minItems / maxItems in the answer
 * schema) stop it from ending the list early? The same chunks are sent both ways, in turn.
 *
 *   npx tsx scripts/research/id-ab.ts --file=data/research/bb-reward.srt [--chunks=8] [--passes=2]
 *       [--model=...] [--out=result.json]
 *
 * RESEARCH_ENV may point at the .env to read. Keys are used, never printed; only ids and counts
 * are printed or saved.
 */
import { GoogleGenAI } from '@google/genai';
import { config as loadEnv } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config/env';
import { isAppError } from '../../src/errors';
import { chunkCues } from '../../src/subtitles/chunk';
import { cleanSubtitle } from '../../src/subtitles/clean';
import { parseSubtitle } from '../../src/subtitles/parse';
import { GeminiProvider, type GeminiClientLike } from '../../src/translation/gemini';

loadEnv({ path: process.env['RESEARCH_ENV'] ?? '.env', quiet: true });

const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Arm = 'plain' | 'exact';
interface Row {
  arm: Arm;
  chunk: number;
  asked: number;
  returned: number;
  missing: number;
  duplicate: number;
  unknown: number;
  finish: string;
  missingIds?: string[];
  unknownIds?: string[];
  error?: string;
}

async function main(): Promise<void> {
  const path = flag('file');
  if (!path) throw new Error('--file=... is required');
  const config = loadConfig();
  const model = flag('model') ?? config.aiModel;
  const real = new GoogleGenAI({
    apiKey: config.aiApiKey,
    httpOptions: { timeout: config.aiTimeoutMs },
  });
  let lastFinish = 'none';
  /** `plain` takes the line count out of the schema again: the app as it was before. */
  const clientFor = (arm: Arm): GeminiClientLike => ({
    models: {
      async generateContent(params) {
        const schema = params.config?.['responseJsonSchema'] as
          { properties: { translations: Record<string, unknown> } } | undefined;
        const config2 =
          arm === 'plain' && schema
            ? {
                ...params.config,
                responseJsonSchema: {
                  ...schema,
                  properties: {
                    translations: Object.fromEntries(
                      Object.entries(schema.properties.translations).filter(
                        ([k]) => k !== 'minItems' && k !== 'maxItems',
                      ),
                    ),
                  },
                },
              }
            : params.config;
        const res = await real.models.generateContent({
          ...params,
          ...(config2 ? { config: config2 } : {}),
        });
        lastFinish = String(res.candidates?.[0]?.finishReason ?? 'none');
        return res;
      },
    },
  });
  const providers: Record<Arm, GeminiProvider> = {
    plain: new GeminiProvider({
      apiKey: config.aiApiKey,
      model,
      timeoutMs: config.aiTimeoutMs,
      client: clientFor('plain'),
    }),
    exact: new GeminiProvider({
      apiKey: config.aiApiKey,
      model,
      timeoutMs: config.aiTimeoutMs,
      client: clientFor('exact'),
    }),
  };

  const cues = cleanSubtitle(parseSubtitle(readFileSync(path, 'utf8'))).cues;
  const chunks = chunkCues(cues, Number(flag('chunk') ?? 80)).slice(0, Number(flag('chunks') ?? 8));
  const rows: Row[] = [];
  for (let pass = 0; pass < Number(flag('passes') ?? 2); pass++) {
    for (const chunk of chunks) {
      for (const arm of (pass % 2 ? ['exact', 'plain'] : ['plain', 'exact']) as Arm[]) {
        const asked = chunk.cues.map((c) => String(c.index));
        const base = { arm, chunk: chunk.number, asked: asked.length };
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const reply = await providers[arm].translateChunk({
              targetLanguage: 'Hebrew',
              targetLanguageCode: 'he',
              cues: chunk.cues.map((c) => ({ id: String(c.index), text: c.text })),
              context: chunk.context,
              upcoming: chunk.upcoming,
            });
            const want = new Set(asked);
            const seen = new Map<string, number>();
            for (const t of reply.translations)
              if (want.has(t.id)) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
            rows.push({
              ...base,
              returned: reply.translations.length,
              missing: asked.filter((id) => !seen.has(id)).length,
              duplicate: [...seen.values()].filter((n) => n > 1).length,
              unknown: reply.translations.filter((t) => !want.has(t.id)).length,
              finish: lastFinish,
              missingIds: asked.filter((id) => !seen.has(id)).slice(0, 20),
              unknownIds: reply.translations
                .filter((t) => !want.has(t.id))
                .map((t) => t.id.slice(0, 12))
                .slice(0, 20),
            });
            break;
          } catch (err) {
            const code = isAppError(err)
              ? `${err.code}${err.details['truncated'] ? ':cut-off' : ''}:${String(err.details['status'] ?? '')}`
              : 'UNKNOWN';
            const waitable = /RATE_LIMITED|TIMEOUT/.test(code);
            if (!waitable || attempt === 3) {
              rows.push({
                ...base,
                returned: 0,
                missing: 0,
                duplicate: 0,
                unknown: 0,
                finish: lastFinish,
                error: code,
              });
              break;
            }
            await sleep(15_000);
          }
        }
        await sleep(1500);
      }
    }
  }
  const summary = (['plain', 'exact'] as Arm[]).map((arm) => {
    const mine = rows.filter((r) => r.arm === arm);
    const ok = mine.filter((r) => !r.error);
    return {
      arm,
      model,
      answered: ok.length,
      answersMissingLines: ok.filter((r) => r.missing > 0).length,
      linesAsked: ok.reduce((n, r) => n + r.asked, 0),
      linesMissing: ok.reduce((n, r) => n + r.missing, 0),
      duplicates: ok.reduce((n, r) => n + r.duplicate, 0),
      unknownIds: ok.reduce((n, r) => n + r.unknown, 0),
      errors: mine.filter((r) => r.error).map((r) => r.error),
      endings: [...new Set(ok.map((r) => r.finish))],
    };
  });
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
  const out = flag('out');
  if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 1), 'utf8');
}

main().catch((err: unknown) => {
  process.stderr.write(`failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
