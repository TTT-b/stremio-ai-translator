/**
 * How much to magnify the app's screens for a window of this size (in device-independent pixels,
 * i.e. after the system's display scaling). A big window gets bigger text and buttons so the screen
 * is used and stays easy to read; a small one is not shrunk much.
 *
 * Wide windows are fitted to a 1280 x 900 layout, tall (portrait) ones to a 720 x 1400 one, so a
 * 27" monitor, a laptop and a rotated screen all show the same layout at a comfortable size.
 */

const LANDSCAPE = { width: 1280, height: 900 };
const PORTRAIT = { width: 720, height: 1400 };
export const MIN_ZOOM = 0.95;
export const MAX_ZOOM = 2;

export function zoomFor(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const base = height > width * 1.1 ? PORTRAIT : LANDSCAPE;
  const fit = Math.min(width / base.width, height / base.height);
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit));
  return Math.round(clamped * 20) / 20; // steps of 5%, so it does not change on every pixel
}
