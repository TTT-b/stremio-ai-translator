// Try the speech-based timing fit on a real video and subtitle (nothing is uploaded anywhere).
//   npx tsx scripts/try-timing.ts <video> <subtitle.srt> [--shift=7000] [--ffmpeg=path]
// --shift moves the subtitle first by that many ms, so you can see the fit bring it back.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyFit, fitTiming } from '../src/sync/fit';
import { detectSpeech } from '../src/sync/speech';
import { parseSubtitle } from '../src/subtitles/parse';
import { serializeSubtitle } from '../src/subtitles/serialize';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const [video, subPath] = args.filter((a) => !a.startsWith('--'));
if (!video || !subPath) {
  console.log('Usage: npx tsx scripts/try-timing.ts <video> <subtitle.srt> [--shift=ms]');
  process.exit(1);
}
const ffmpeg = flag('ffmpeg') ?? `${process.env.LOCALAPPDATA}\\Programs\\Stremio\\ffmpeg.exe`;
const shift = Number(flag('shift') ?? 0);

const file = parseSubtitle(readFileSync(subPath, 'utf8'));
const start = file.cues.map((c) => c.startMs);
const given = file.cues.map((c) => ({ ...c, startMs: c.startMs + shift, endMs: c.endMs + shift }));
console.log(`Subtitle: ${given.length} lines${shift ? `, moved by ${shift} ms on purpose` : ''}`);

const t0 = Date.now();
const abort = new AbortController();
let lastShown = 0;
const scan = await detectSpeech(ffmpeg, video, abort.signal, (s) => {
  if (s - lastShown >= 600) {
    lastShown = s;
    process.stdout.write(`\rReading the sound: ${Math.round(s / 60)} min   `);
  }
});
const on = scan.speech.reduce((n, v) => n + v, 0);
console.log(
  `\nSound read in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${Math.round(scan.seconds / 60)} min, speech in ${((on / scan.speech.length) * 100).toFixed(0)}% of it`,
);

const fit = fitTiming(given, scan.speech);
if (!fit) {
  console.log('Result: NOT SURE - the subtitle would be left exactly as it is.');
  process.exit(0);
}
const fixed = applyFit(given, fit);
console.log(
  `Result: move by ${(fit.offsetMs / 1000).toFixed(2)} s, stretch x${fit.scale.toFixed(5)}, agreement ${fit.score.toFixed(2)} (before ${fit.baseline.toFixed(2)})`,
);
if (shift) {
  const err = fixed.map((c, i) => Math.abs(c.startMs - (start[i] as number))).sort((a, b) => a - b);
  const q = (p: number) => err[Math.floor(err.length * p)] as number;
  const within = (ms: number) =>
    ((err.filter((e) => e <= ms).length / err.length) * 100).toFixed(0);
  console.log(
    `Against the original: median error ${q(0.5)} ms, 95% of lines within ${q(0.95)} ms; ${within(200)}% within 0.2 s`,
  );
}
const out = subPath.replace(/\.(srt|vtt)$/i, '') + '.fitted.srt';
writeFileSync(out, serializeSubtitle({ ...file, cues: fixed }), 'utf8');
console.log(`Saved: ${out}`);
