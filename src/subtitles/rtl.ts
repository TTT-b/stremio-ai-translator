const RLM = '‏';

/**
 * Optional RTL punctuation fix: prefix every non-empty line with a Right-to-Left Mark so
 * leading/trailing punctuation sticks to the right side. Off by default (config RTL_FIX).
 */
export function applyRtlFix(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' || line.startsWith(RLM) ? line : RLM + line))
    .join('\n');
}
