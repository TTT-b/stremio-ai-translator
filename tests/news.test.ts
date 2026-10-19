import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersionsDesc, NewsFeed } from '../src/news/news';

const item = (id: string, date: string, over: object = {}) => ({
  id,
  date,
  title: { he: 'כותרת', en: 'Title' },
  body: { he: 'גוף', en: 'Body' },
  ...over,
});
const file = (...items: object[]) => JSON.stringify({ v: 1, items });
const respond = (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as typeof fetch;

const make = (over: Partial<ConstructorParameters<typeof NewsFeed>[0]> = {}, dir?: string) => {
  const d = dir ?? mkdtempSync(join(tmpdir(), 'news-'));
  return {
    dir: d,
    feed: new NewsFeed({
      url: 'https://example.test/news.json',
      cacheFile: join(d, 'cache.json'),
      seenFile: join(d, 'seen.json'),
      enabled: true,
      ...over,
    }),
  };
};

describe('NewsFeed', () => {
  it('downloads the file, shows the newest message first and keeps a copy', async () => {
    const { dir, feed } = make({
      fetchImpl: respond(file(item('old', '2026-01-01'), item('new', '2026-10-18'))),
    });
    const r = await feed.get();
    expect(r.online).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(['new', 'old']);

    // Offline later: the saved copy is shown.
    const offline = make({ fetchImpl: respond('nope', 500) }, dir).feed;
    const again = await offline.get();
    expect(again.online).toBe(false);
    expect(again.items.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('ignores invalid, oversized or unsafe files and keeps what it had', async () => {
    const good = file(item('a', '2026-10-18'));
    const { dir } = make({ fetchImpl: respond(good) });
    await make({ fetchImpl: respond(good) }, dir).feed.get();
    for (const bad of [
      'not json',
      file(item('x', '2026-10-18', { link: 'http://example.test/plain' })),
      file(item('bad id!', '2026-10-18')),
      file(item('x', 'yesterday')),
      'x'.repeat(70 * 1024),
    ]) {
      const f = make({ fetchImpl: respond(bad) }, dir).feed;
      const r = await f.get();
      expect(r.online).toBe(false);
      expect(r.items.map((i) => i.id)).toEqual(['a']);
    }
  });

  it('asks again after 30 minutes, retries a failure after 1 minute, and never when disabled', async () => {
    let calls = 0;
    let now = 1_000_000;
    let fail = false;
    const fetchImpl = (async () => {
      calls++;
      return fail
        ? new Response('x', { status: 500 })
        : new Response(file(item('a', '2026-10-18')));
    }) as typeof fetch;
    const { feed } = make({ fetchImpl, now: () => now });
    await feed.get();
    await feed.get();
    expect(calls).toBe(1);
    now += 29 * 60_000;
    await feed.get();
    expect(calls).toBe(1);
    now += 2 * 60_000;
    fail = true;
    await feed.get();
    expect(calls).toBe(2);
    await feed.get(); // failed: not retried straight away
    expect(calls).toBe(2);
    now += 61_000;
    await feed.get();
    expect(calls).toBe(3);

    let off = 0;
    const disabled = make({
      enabled: false,
      fetchImpl: (async () => {
        off++;
        return new Response(file());
      }) as typeof fetch,
    }).feed;
    await disabled.get();
    expect(off).toBe(0);
  });

  it('remembers opened messages across restarts and refuses malformed ids', () => {
    const { dir, feed } = make();
    expect(feed.markSeen(['a', 'release-1.4.8'])).toBe(true);
    expect(feed.markSeen(['no spaces allowed'])).toBe(false);
    expect(feed.markSeen('a')).toBe(false);
    expect(make({}, dir).feed.seen().sort()).toEqual(['a', 'release-1.4.8']);
    writeFileSync(join(dir, 'seen.json'), 'garbage');
    expect(make({}, dir).feed.seen()).toEqual([]);
    expect(readFileSync(join(dir, 'seen.json'), 'utf8')).toBe('garbage');
  });
});

describe('compareVersionsDesc', () => {
  it('sorts versions numerically, newest first', () => {
    expect(['1.4.5', '1.10.0', '1.9.2', '1.4.10'].sort(compareVersionsDesc)).toEqual([
      '1.10.0',
      '1.9.2',
      '1.4.10',
      '1.4.5',
    ]);
  });
});
