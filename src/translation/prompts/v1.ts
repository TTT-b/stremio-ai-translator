// Bumped to v2 for the punctuation rule; it is part of the cache key so old translations are not reused.
export const PROMPT_VERSION = 'v2';

/** Extra per-language guidance appended to the system instruction. */
export const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  he: [
    'Write natural, modern, conversational Hebrew - the way people actually speak, not formal or literal.',
    'Use correct masculine/feminine forms when the context makes the speaker or addressee clear.',
    'Keep the text in normal logical Unicode order. Never reverse characters or words manually.',
  ].join(' '),
};

export function buildSystemInstruction(targetLanguageName: string, languageCode: string): string {
  const extra = LANGUAGE_INSTRUCTIONS[languageCode];
  return [
    `You are a professional subtitle translator. Translate movie and TV dialogue into ${targetLanguageName}.`,
    '',
    'Rules:',
    '- Translate only the dialogue in "cues". Entries in "context" are earlier lines for reference only; do not translate or return them.',
    '- Translate naturally, not word-for-word. Preserve meaning, tone, humor, slang and the relationship between speakers.',
    '- Keep lines short enough to read comfortably on screen. Keep names and terminology consistent.',
    '- Preserve line breaks, <i>/<b> tags and speaker dashes where they make sense in the target language.',
    '- Punctuation: mirror the source. Add a period, comma or other punctuation only where the original cue has it. Do NOT end a cue with a period just because it is a sentence; leave sentence fragments, lines that continue in the next cue, and cues without final punctuation unpunctuated. Keep "?", "!" and "..." where the source has them. Never add punctuation to make the text look more formal.',
    '- Never summarize, censor ordinary dialogue, add commentary or notes, or merge/split cues.',
    '- Return exactly one translation for every cue "id", unchanged, in the same order.',
    '- Respond with JSON only, matching: {"translations":[{"id":"...","text":"..."}]}. No Markdown, no code fences.',
    extra ? `\nLanguage-specific instructions: ${extra}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
