/**
 * Add a message for everyone who has the app (shown under the bell). It writes `news.json`; the
 * app downloads that file from GitHub, so the message reaches users once the file is pushed.
 *
 *   npm run news -- --he-title "כותרת" --en-title "Title" --he "הודעה" --en "Message" [--link https://...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { newsFileSchema, type NewsItem } from '../src/news/news';

const FILE = 'news.json';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}

const heTitle = arg('he-title');
const enTitle = arg('en-title');
const he = arg('he');
const en = arg('en');
if (!heTitle || !enTitle || !he || !en) {
  console.error(
    'Missing text. Give all four: --he-title "..." --en-title "..." --he "..." --en "..." (optional: --link https://...)',
  );
  process.exit(1);
}

const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const slug = enTitle
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);
const link = arg('link');
const item: NewsItem = {
  id: arg('id') ?? `${date}-${slug || 'message'}`,
  date,
  title: { he: heTitle, en: enTitle },
  body: { he, en },
  ...(link ? { link } : {}),
};

const current = newsFileSchema.parse(JSON.parse(readFileSync(FILE, 'utf8')));
if (current.items.some((i) => i.id === item.id)) {
  console.error(`A message with the id "${item.id}" already exists. Use --id to choose another.`);
  process.exit(1);
}
const next = newsFileSchema.safeParse({ v: 1, items: [item, ...current.items].slice(0, 50) });
if (!next.success) {
  console.error(
    'The message is not valid (title up to 120 characters, text up to 1500, https links only).',
  );
  process.exit(1);
}
writeFileSync(FILE, `${JSON.stringify(next.data, null, 2)}\n`, 'utf8');
console.log(`Added "${enTitle}" (${item.id}) to ${FILE}.`);
console.log('It reaches users after it is pushed to GitHub: git add news.json, commit, git push.');
