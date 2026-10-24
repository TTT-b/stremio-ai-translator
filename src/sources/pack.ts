/**
 * A season pack is one zip with a subtitle file per episode. This picks the file of the episode
 * that is playing, by the numbers in the file names ("Show.S02E05.srt", "Show - 031 (1080p).srt").
 */
const base = (name: string): string => name.replace(/\\/g, '/').split('/').pop() ?? name;

const isSrt = (name: string): boolean => /\.srt$/i.test(name);

/** Quality and codec words that look like episode numbers ("1080p", "x264", "10bit") are blanked out. */
const blankNoise = (s: string): string =>
  s.replace(
    /\b(?:\d{3,4}p|\d{3,4}x\d{3,4}|[xh]\.?26[45]|\d{1,2}bit|hevc|aac\d*|ac3|flac)\b/gi,
    ' ',
  );

/**
 * The episode number a name without season label carries: the LAST number in it, outside brackets
 * ("Mob Psycho 100 - 05" is episode 5, not 100; "Kaguya-sama 3 - 05" is episode 5, not 3).
 */
function bareNumber(n: string): number | undefined {
  const plain = n.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  let last: number | undefined;
  for (const m of plain.matchAll(/(?:^|[^0-9a-z])(?:e|ep)?[ ._-]?(\d+)(?:v\d)?(?![0-9a-z])/gi)) {
    last = Number(m[1]);
  }
  return last;
}

/**
 * Is this one subtitle file the wanted episode? A name that carries a season and episode must carry
 * these; a name with only a number ("Show - 031") counts when `bare` allows it. Anime that numbers
 * its episodes straight through (episode 52 is "season 2 episode 1") is why a bare number is not
 * trusted for a later season.
 */
export function fileIsEpisode(
  name: string,
  season: number | undefined,
  episode: number,
  bare: boolean,
): boolean {
  const n = blankNoise(base(name).replace(/\.(srt|ass|vtt)$/i, ''));
  const labelled = /s\d+[ ._-]*e\d+|(?:^|[^0-9])\d+x\d+/i.test(n);
  if (labelled) {
    if (season === undefined) return new RegExp(`e0*${episode}(?![0-9])`, 'i').test(n);
    return (
      new RegExp(`s0*${season}[ ._-]*e0*${episode}(?![0-9])`, 'i').test(n) ||
      new RegExp(`(?:^|[^0-9])0*${season}x0*${episode}(?![0-9])`, 'i').test(n)
    );
  }
  return bare && bareNumber(n) === episode;
}

export function pickEpisodeEntry<T extends { name: string }>(
  entries: T[],
  season: number | undefined,
  episode: number,
): T | undefined {
  const files = entries.filter((e) => isSrt(e.name));
  if (files.length === 0) return undefined;
  const names = files.map((e) => blankNoise(base(e.name).replace(/\.srt$/i, '')));
  const find = (re: RegExp): T | undefined => files[names.findIndex((n) => re.test(n))];
  const findBare = (): T | undefined => files[names.findIndex((n) => bareNumber(n) === episode)];

  if (season !== undefined) {
    const withSeason =
      find(new RegExp(`s0*${season}[ ._-]*e0*${episode}(?![0-9])`, 'i')) ??
      find(new RegExp(`(?:^|[^0-9])0*${season}x0*${episode}(?![0-9])`, 'i'));
    if (withSeason) return withSeason;
  }
  // Packs that label their files with season and episode never match by a bare number: a wrong
  // episode is worse than none.
  const labelled = names.some((n) => /s\d+[ ._-]*e\d+|\d+x\d+/i.test(n));
  if (labelled) return undefined;
  return findBare();
}
