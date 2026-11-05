/** "gemini-3.5-flash-lite" becomes "Gemini 3.5 Flash Lite". */
export function prettyModel(id: string): string {
  const words = id
    .split(/[-_\s]+/)
    .filter((w) => w !== '')
    .reduce<string[]>((out, word) => {
      const last = out[out.length - 1];
      // "5-5" is version 5.5, not two numbers
      if (last !== undefined && /^\d+$/.test(last) && /^\d+$/.test(word)) {
        out[out.length - 1] = last + '.' + word;
      } else {
        out.push(word);
      }
      return out;
    }, []);
  return words
    .map((w) =>
      w.toLowerCase() === 'gpt'
        ? 'GPT'
        : /^\d/.test(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/** The provider and model for the header line: "Google Gemini 3.5 Flash Lite". */
export function providerLine(providerLabel: string, model: string): string {
  const pretty = prettyModel(model);
  const lastWord = providerLabel.trim().split(/\s+/).pop() ?? '';
  if (lastWord !== '' && pretty.toLowerCase().startsWith(lastWord.toLowerCase() + ' ')) {
    return providerLabel + ' ' + pretty.slice(lastWord.length + 1);
  }
  return providerLabel === '' ? pretty : providerLabel + ' · ' + pretty;
}
