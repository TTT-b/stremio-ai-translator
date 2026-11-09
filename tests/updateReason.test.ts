import { describe, expect, it } from 'vitest';
import { classifyUpdateError } from '../src/electron/updateReason';

describe('classifyUpdateError', () => {
  it.each([
    ['getaddrinfo ENOTFOUND github.com', 'offline'],
    ['net::ERR_INTERNET_DISCONNECTED', 'offline'],
    ['connect ECONNREFUSED 127.0.0.1:443', 'offline'],
    ['connect ETIMEDOUT 140.82.0.1:443', 'timeout'],
    ['Request timed out', 'timeout'],
    ['ENOSPC: no space left on device', 'disk'],
    ['sha512 checksum mismatch, expected abc, got def', 'corrupt'],
  ])('maps "%s" to %s', (message, expected) => {
    expect(classifyUpdateError(message)).toBe(expected);
  });

  it('returns undefined when the cause is unknown', () => {
    expect(classifyUpdateError('Something strange happened')).toBeUndefined();
    expect(classifyUpdateError('')).toBeUndefined();
  });

  it('prefers disk over a generic timeout word', () => {
    expect(classifyUpdateError('ENOSPC while the request timeout was set')).toBe('disk');
  });
});
