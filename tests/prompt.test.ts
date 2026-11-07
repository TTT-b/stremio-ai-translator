import { describe, expect, it } from 'vitest';
import { chunkCues } from '../src/subtitles/chunk';
import { TRANSLATION_TEMPERATURE } from '../src/translation/gemini';
import { buildSystemInstruction, PROMPT_VERSION } from '../src/translation/prompts/v1';

describe('translation prompt', () => {
  const he = buildSystemInstruction('Hebrew', 'he');

  it('is a new version so older cached translations are not reused', () => {
    expect(PROMPT_VERSION).toBe('v9');
  });

  it('carries the target language name into the rules', () => {
    expect(he).toContain('natural spoken Hebrew');
    expect(he).toContain('in the Hebrew script');
  });

  it('asks for gender, names in the target script, bracketed sounds and no reversed text', () => {
    expect(he).toMatch(/silently decide who is speaking/);
    expect(he).toMatch(/Never mix letters from any other writing system/);
    expect(he).toMatch(/inside square brackets/);
    expect(he).toMatch(/never reverse letters/);
  });

  it('adds the Hebrew block only for Hebrew', () => {
    expect(he).toContain('Hebrew-specific instructions');
    expect(buildSystemInstruction('French', 'fr')).not.toContain('specific instructions');
  });

  it('names no particular person, show or word', () => {
    expect(he).not.toMatch(/Daniel|דניאל/);
  });
});

describe('model settings', () => {
  it('uses a low temperature for every model', () => {
    expect(TRANSLATION_TEMPERATURE).toBe(0.3);
  });

  it('gives each chunk more reading context by default', () => {
    const cues = Array.from({ length: 40 }, (_, i) => ({
      index: i + 1,
      startMs: i,
      endMs: i + 1,
      text: `l${i}`,
    }));
    const second = chunkCues(cues, 10)[1];
    expect(second?.context).toHaveLength(8);
    expect(second?.upcoming).toHaveLength(6);
  });
});
