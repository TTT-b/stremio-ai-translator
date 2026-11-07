import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

import { fitSubtitleToEmbeddedCues, readPieceWithFfmpeg } from '../src/sync/cueFit';
import { detectSpeech } from '../src/sync/speech';
import { fitSubtitleToVideo } from '../src/sync/videoFit';
import type { Cue } from '../src/subtitles/types';

const aborted = (): AbortSignal => {
  const c = new AbortController();
  c.abort();
  return c.signal;
};

const cues: Cue[] = Array.from({ length: 60 }, (_, i) => ({
  index: i + 1,
  startMs: 20_000 + i * 10_000,
  endMs: 22_000 + i * 10_000,
  text: `line number ${i}`,
}));

describe('an already cancelled request does not start ffmpeg', () => {
  beforeEach(() => spawnMock.mockClear());

  it('detectSpeech stops without spawning', async () => {
    await expect(detectSpeech('ffmpeg', 'http://x/y', aborted())).rejects.toThrow('stopped');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('readPieceWithFfmpeg stops without spawning', async () => {
    await expect(
      readPieceWithFfmpeg({
        ffmpeg: 'ffmpeg',
        url: 'http://x/y',
        streamIndex: 0,
        fromSec: 0,
        toSec: 10,
        signal: aborted(),
      }),
    ).rejects.toThrow('stopped');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fitSubtitleToVideo stops before listening to anything', async () => {
    const detect = vi.fn();
    await expect(
      fitSubtitleToVideo({
        ffmpeg: 'ffmpeg',
        url: 'http://x/y',
        signal: aborted(),
        cues,
        detect,
      }),
    ).rejects.toThrow('stopped');
    expect(detect).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fitSubtitleToEmbeddedCues stops before probing', async () => {
    const exec = vi.fn();
    const readPiece = vi.fn();
    await expect(
      fitSubtitleToEmbeddedCues({
        ffmpeg: 'ffmpeg',
        ffprobe: 'ffprobe',
        url: 'http://x/y',
        language: 'en',
        signal: aborted(),
        cues,
        exec,
        readPiece,
      }),
    ).rejects.toThrow('stopped');
    expect(exec).not.toHaveBeenCalled();
    expect(readPiece).not.toHaveBeenCalled();
  });
});
