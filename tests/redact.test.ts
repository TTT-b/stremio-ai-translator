import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger';
import { createRedactor } from '../src/logging/redact';

const SECRET = 'AIzaSyDUMMYKEYDUMMYKEYDUMMYKEY123456';

describe('redactor', () => {
  const { scrub, scrubString } = createRedactor(() => ['hunter2-password']);

  it('masks known secret values and key patterns in strings', () => {
    expect(scrubString('pw is hunter2-password ok')).not.toContain('hunter2-password');
    expect(scrubString(`key ${SECRET}`)).not.toContain(SECRET);
    expect(scrubString('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(scrubString('https://x/y?key=abc123&z=1')).not.toContain('abc123');
  });

  it('masks sensitive keys in objects, including nested', () => {
    const out = scrub({
      apiKey: 'abc',
      nested: { password: 'p', ok: 'fine' },
      headers: { Authorization: 'x' },
    });
    expect(JSON.stringify(out)).not.toMatch(/"abc"|"p"|"x"/);
    expect(JSON.stringify(out)).toContain('fine');
  });

  it('scrubs error messages', () => {
    const out = scrub({ err: new Error(`failed with ${SECRET}`) });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});

describe('logger file output', () => {
  it('never writes secrets to the log file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-'));
    const logger = createLogger({
      level: 'info',
      secrets: () => ['topsecretvalue'],
      logDir: dir,
      console: false,
    });
    logger.info(
      { stage: 'API', apiKey: 'topsecretvalue', note: 'has topsecretvalue inside' },
      'msg topsecretvalue',
    );
    logger.flush();
    await new Promise((r) => setTimeout(r, 300));
    const file = readdirSync(dir).find((f) => f.startsWith('app-'));
    expect(file).toBeDefined();
    const content = readFileSync(join(dir, file as string), 'utf8');
    expect(content).toContain('"stage":"API"');
    expect(content).not.toContain('topsecretvalue');
  });
});
