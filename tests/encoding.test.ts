import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Text read as the wrong encoding and saved again turns Hebrew into strings like these. */
const MOJIBAKE = /\u05d2\u20ac|(?<![\u05d0-\u05ea])\u05f3[\u05d0-\u05ea]/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('source text encoding', () => {
  it('has no garbled Hebrew or symbols in sources and docs', () => {
    const files = [
      ...walk('src').filter(
        (f) => /\.(ts|css)$/.test(f) && !f.includes('generated') && !f.includes('iconData'),
      ),
      'README.md',
      'TROUBLESHOOTING.md',
    ];
    const bad = files.filter((f) => MOJIBAKE.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
