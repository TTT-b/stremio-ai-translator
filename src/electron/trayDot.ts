import type { TrayDot } from './trayMenu';

/** Dot colours as [red, green, blue]. */
export const DOT_RGB: Record<TrayDot, readonly [number, number, number]> = {
  gray: [107, 114, 128],
  yellow: [251, 191, 36],
  green: [52, 211, 153],
  red: [251, 113, 133],
};

const BYTES_PER_PIXEL = 4;
const RING_WIDTH = 1.5;

/**
 * A copy of a square BGRA bitmap (as Electron's `toBitmap()` gives it) with a coloured dot in the
 * bottom-right corner and a thin dark ring around it so it reads on any taskbar colour.
 */
export function withDot(bitmap: Uint8Array, size: number, dot: TrayDot): Uint8Array {
  const out = Uint8Array.from(bitmap);
  const radius = Math.max(3, Math.round(size * 0.22));
  const cx = size - radius - 1;
  const cy = size - radius - 1;
  const [r, g, b] = DOT_RGB[dot];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dist > radius + RING_WIDTH) continue;
      const i = (y * size + x) * BYTES_PER_PIXEL;
      const inside = dist <= radius;
      out[i] = inside ? b : 27;
      out[i + 1] = inside ? g : 20;
      out[i + 2] = inside ? r : 17;
      out[i + 3] = 255;
    }
  }
  return out;
}
