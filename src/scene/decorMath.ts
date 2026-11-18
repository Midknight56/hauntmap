import type { Point, Rect } from "./layout/types";
import { unit } from "./fx";

// The numbers behind the halloween details of the map: cobwebs, cracks, bats, spiders and fog. Pure, no PixiJS, no randomness
// (every shape comes from a seed), so that a scene draws the same details on every run. They are drawing only.

/** The clock the details show when they stand still (reduced motion): the same pose on every run. */
export const STILL_CLOCK_MS = 9_000;
/**
 * The most things of the decor that move: 3 banks of fog, 3 bats, 3 spiders and 6 candle flames. They count inside the 40 particles of
 * the steering file, together with the dust of the loops and the motes.
 */
export const MAX_DECOR_MOVERS = 15;

/** A 32-bit hash of a text (FNV-1a), so that the same room or wing gets the same details on every run. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Corner = "tl" | "tr" | "bl" | "br";

/**
 * A cobweb in the corner of a square of `r` units, as polylines in the square (0 to r on both axes): `strands` threads that fan out
 * of the corner, and three rings that join them, each ring sagging a little toward the corner.
 */
export function webPaths(corner: Corner, r: number, strands: number): Point[][] {
  const flipX = corner === "tr" || corner === "br";
  const flipY = corner === "bl" || corner === "br";
  const place = (x: number, y: number): Point => ({ x: flipX ? r - x : x, y: flipY ? r - y : y });
  const n = Math.max(3, Math.round(strands));
  const angle = (k: number): number => (k / (n - 1)) * (Math.PI / 2);
  const paths: Point[][] = [];
  for (let k = 0; k < n; k++) paths.push([place(0, 0), place(Math.cos(angle(k)) * r, Math.sin(angle(k)) * r)]);
  for (const ring of [0.38, 0.68, 0.97]) {
    const rho = r * ring;
    for (let k = 0; k < n - 1; k++) {
      const a = angle(k);
      const b = angle(k + 1);
      const mid = (a + b) / 2;
      const sag = rho * 0.86;
      paths.push([place(Math.cos(a) * rho, Math.sin(a) * rho), place(Math.cos(mid) * sag, Math.sin(mid) * sag), place(Math.cos(b) * rho, Math.sin(b) * rho)]);
    }
  }
  return paths;
}

/** A crack of six points across a box of `w` by `h` units, from the left edge to the right one, inside the box. */
export function crackPath(seed: number, w: number, h: number): Point[] {
  const points: Point[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const jitter = i === 0 || i === n - 1 ? 0 : (unit(seed, 20 + i) - 0.5) * (w / (n - 1)) * 0.6;
    points.push({ x: Math.min(w, Math.max(0, (w * i) / (n - 1) + jitter)), y: Math.min(h, Math.max(0, h * (0.1 + 0.8 * unit(seed, 40 + i)))) });
  }
  return points;
}

const SPIDER_PERIOD_MS = 14_000;
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * How far down its thread a spider is, 0 (at the wall) to 1 (the whole thread out): it rests, drops in 2.8 s, hangs, climbs back in
 * 3.5 s and rests again. `seed` shifts the cycle so that the spiders of a map are not in step.
 */
export function spiderDrop(clockMs: number, seed: number): number {
  const phase = (((clockMs / SPIDER_PERIOD_MS + unit(seed, 7)) % 1) + 1) % 1;
  if (phase < 0.25) return 0;
  if (phase < 0.45) return smooth((phase - 0.25) / 0.2);
  if (phase < 0.65) return 1;
  if (phase < 0.9) return 1 - smooth((phase - 0.65) / 0.25);
  return 0;
}

export interface BatPose {
  active: boolean;
  x: number;
  y: number;
  /** 0 to 1: the beat of the wings. */
  flap: number;
}

const BAT_FLIGHT_MS = 5_000;
/** A bat crosses the map for 5 s about once in 22 s (27 s and 32 s for the others), and is away the rest of the time. */
export function batFlight(clockMs: number, seed: number, bounds: Rect): BatPose {
  const cycle = 22_000 + seed * 5_000;
  const start = 2_000 + seed * 6_000;
  const since = clockMs - start;
  const phase = ((since % cycle) + cycle) % cycle;
  const flap = 0.5 + 0.5 * Math.sin(clockMs / 55 + seed);
  if (phase >= BAT_FLIGHT_MS) return { active: false, x: bounds.x, y: bounds.y, flap };
  const episode = Math.floor(since / cycle);
  const u = phase / BAT_FLIGHT_MS;
  const leftToRight = (((episode + seed) % 2) + 2) % 2 === 0;
  const x = bounds.x - 60 + (bounds.w + 120) * (leftToRight ? u : 1 - u);
  const y = bounds.y + bounds.h * (0.2 + 0.5 * unit(seed, episode + 11)) + Math.sin(u * Math.PI * 6 + seed) * bounds.h * 0.07 + Math.sin(u * 17 + seed) * 10;
  return { active: true, x, y, flap };
}

const channel = (hex: string, offset: number): number => parseInt(hex.slice(offset, offset + 2), 16);
const lin = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** The WCAG relative luminance of `#rrggbb`. */
export function luminanceOf(hex: string): number {
  return 0.2126 * lin(channel(hex, 1)) + 0.7152 * lin(channel(hex, 3)) + 0.0722 * lin(channel(hex, 5));
}

/** The color a layer of `fg` at opacity `alpha` makes over `bg`, blended the way a renderer does it: per channel, in the encoded values. */
export function blendHex(bg: string, fg: string, alpha: number): string {
  const mix = (o: number): string =>
    Math.round(channel(bg, o) * (1 - alpha) + channel(fg, o) * alpha)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

export function contrastOf(a: string, b: string): number {
  const x = luminanceOf(a);
  const y = luminanceOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every ink of the map keeps at least this contrast on the floor the fog lies over, even where the layers of fog stack (the rule asks for 4.5; this leaves room). */
const FOG_CONTRAST = 4.8;

/**
 * The most opacity the fog may reach where its layers stack, so that every `ink` keeps `FOG_CONTRAST` to 1 on the `wing` floor under
 * fog of the color `fog`. At most 0.14; 0 when even a trace of the fog would take an ink under that.
 */
export function fogAlphaCap(input: { wing: string; fog: string; inks: readonly string[] }): number {
  for (let alpha = 0.14; alpha > 0.0001; alpha -= 0.005) {
    const under = blendHex(input.wing, input.fog, alpha);
    if (input.inks.every((ink) => contrastOf(ink, under) >= FOG_CONTRAST)) return Math.round(alpha * 1000) / 1000;
  }
  return 0;
}
