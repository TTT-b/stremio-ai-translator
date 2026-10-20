/** Short made-up dialogues for the "translate a sample" check; one is picked at random each time. */
const SAMPLES: readonly string[] = [
  [
    'Good morning. Did you sleep well?',
    '<i>Yes, thank you. The room was lovely.</i>',
    '- Shall we have breakfast?\n- Of course.',
  ],
  [
    'We should leave before it gets dark.',
    '<i>I know a shortcut through the forest.</i>',
    '- Is it safe?\n- Trust me.',
  ],
  [
    'The train leaves in ten minutes.',
    "<i>Then we'd better hurry.</i>",
    '- Do you have the tickets?\n- Right here.',
  ],
  [
    'Welcome back. We missed you.',
    "<i>It's good to be home.</i>",
    "- Dinner is ready.\n- I'm starving.",
  ],
  [
    'Did you hear that noise?',
    "<i>It's probably just the wind.</i>",
    "- Should we check?\n- Let's wait until morning.",
  ],
].map((cues) =>
  cues
    .map((text, i) => {
      const t = (ms: number) =>
        `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
      return `${i + 1}\n${t(1000 + i * 3000)} --> ${t(3500 + i * 3000)}\n${text}\n`;
    })
    .join('\n'),
);

export const SAMPLE_COUNT = SAMPLES.length;

/** One of the sample subtitles (an SRT text). */
export function pickSample(random: () => number = Math.random): string {
  return SAMPLES[Math.min(SAMPLES.length - 1, Math.floor(random() * SAMPLES.length))] as string;
}

/** The translated lines as plain readable text: no numbers, times or tags. */
export function readableLines(texts: string[]): string {
  return texts.map((t) => t.replace(/<[^>]+>/g, '').trim()).join('\n\n');
}
