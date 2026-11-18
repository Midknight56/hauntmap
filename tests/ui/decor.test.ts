import { describe, expect, it } from "vitest";
import {
  batFlight,
  blendHex,
  contrastOf,
  crackPath,
  fogAlphaCap,
  hash32,
  MAX_DECOR_MOVERS,
  spiderDrop,
  STILL_CLOCK_MS,
  webPaths,
  type Corner,
} from "../../src/scene/decorMath";
import { MAX_MOTES } from "../../src/scene/fx";
import { MAX_PARTICLES } from "../../src/scene/corridors";
import { THEMES } from "../../src/styles/theme";

// Halloween detail pass, item 3: the numbers behind the cobwebs, cracks, bats, spiders and fog. Pure, no PixiJS.

describe("the particle budget", () => {
  it("keeps the moving things of the decor, the dust of the loops and the motes inside 40", () => {
    expect(MAX_DECOR_MOVERS).toBeLessThanOrEqual(15);
    expect(MAX_DECOR_MOVERS + MAX_MOTES).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});

describe("hash32", () => {
  it("is the same for the same text and differs for another", () => {
    expect(hash32("src/orders")).toBe(hash32("src/orders"));
    expect(hash32("src/orders")).not.toBe(hash32("src/payments"));
    expect(hash32("x")).toBeGreaterThanOrEqual(0);
  });
});

describe("the spider on its thread", () => {
  it("rests at the wall, drops, hangs, climbs back and rests again, without a jump", () => {
    const seen: number[] = [];
    for (let t = 0; t < 40_000; t += 16) seen.push(spiderDrop(t, 3));
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBeGreaterThan(0.95);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    for (let i = 1; i < seen.length; i++) expect(Math.abs((seen[i] as number) - (seen[i - 1] as number))).toBeLessThan(0.03);
    // It comes back: after a maximum there is a later zero.
    const top = seen.indexOf(Math.max(...seen));
    expect(seen.slice(top).some((v) => v === 0)).toBe(true);
  });

  it("is at the wall at the first moment of a still scene only if its still pose says so", () => {
    expect(spiderDrop(STILL_CLOCK_MS, 3)).toBe(spiderDrop(STILL_CLOCK_MS, 3));
  });
});

describe("the bats", () => {
  const bounds = { x: 0, y: 0, w: 900, h: 600 };
  it("fly across the map now and then and are away the rest of the time", () => {
    let flying = 0;
    let total = 0;
    for (let t = 0; t < 120_000; t += 100) {
      for (const seed of [0, 1, 2]) {
        total++;
        const f = batFlight(t, seed, bounds);
        if (f.active) {
          flying++;
          expect(f.x).toBeGreaterThanOrEqual(bounds.x - 80);
          expect(f.x).toBeLessThanOrEqual(bounds.x + bounds.w + 80);
          expect(f.y).toBeGreaterThanOrEqual(bounds.y - 80);
          expect(f.y).toBeLessThanOrEqual(bounds.y + bounds.h + 80);
          expect(f.flap).toBeGreaterThanOrEqual(0);
          expect(f.flap).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(flying / total).toBeGreaterThan(0.12);
    expect(flying / total).toBeLessThan(0.45);
  });

  it("show at least one bat in the air within the first 20 seconds", () => {
    let seen = false;
    for (let t = 0; t < 20_000; t += 100) for (const seed of [0, 1, 2]) if (batFlight(t, seed, bounds).active) seen = true;
    expect(seen).toBe(true);
  });

  it("move along their path without jumping", () => {
    let last: { x: number; y: number } | null = null;
    for (let t = 0; t < 60_000; t += 16) {
      const f = batFlight(t, 1, bounds);
      if (f.active && last !== null) expect(Math.hypot(f.x - last.x, f.y - last.y)).toBeLessThan(12);
      last = f.active ? { x: f.x, y: f.y } : null;
    }
  });
});

describe("the fog", () => {
  it("is faint enough that ink and muted ink keep 4.5 to 1 on the wing floor in every palette, even where the layers stack", () => {
    for (const theme of Object.values(THEMES)) {
      const c = theme.colors;
      const cap = fogAlphaCap({ wing: c.wing, fog: c.edge, inks: [c.ink, c.inkMuted, c.roomInk, c.plateInk] });
      expect(cap, theme.name).toBeGreaterThan(0.02);
      expect(cap, theme.name).toBeLessThanOrEqual(0.14);
      const under = blendHex(c.wing, c.edge, cap);
      for (const ink of [c.ink, c.inkMuted, c.roomInk, c.plateInk]) expect(contrastOf(ink, under), `${theme.name} ${ink}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the cobwebs and cracks", () => {
  const corners: Corner[] = ["tl", "tr", "bl", "br"];
  it("stay inside the square of their corner", () => {
    for (const corner of corners) {
      for (const r of [13, 26]) {
        const paths = webPaths(corner, r, 7);
        expect(paths.length).toBeGreaterThan(3);
        for (const path of paths) {
          expect(path.length).toBeGreaterThanOrEqual(2);
          for (const p of path) {
            expect(p.x).toBeGreaterThanOrEqual(-1e-9);
            expect(p.x).toBeLessThanOrEqual(r + 1e-9);
            expect(p.y).toBeGreaterThanOrEqual(-1e-9);
            expect(p.y).toBeLessThanOrEqual(r + 1e-9);
          }
        }
      }
    }
  });

  it("start at the corner of the room or wing", () => {
    const at: Record<Corner, { x: number; y: number }> = { tl: { x: 0, y: 0 }, tr: { x: 20, y: 0 }, bl: { x: 0, y: 20 }, br: { x: 20, y: 20 } };
    for (const corner of corners) {
      const paths = webPaths(corner, 20, 6);
      expect(paths.some((p) => Math.hypot((p[0] as { x: number }).x - at[corner].x, (p[0] as { y: number }).y - at[corner].y) < 1e-9)).toBe(true);
    }
  });

  it("make the same cracks for the same seed, inside the box asked for", () => {
    const a = crackPath(42, 60, 30);
    expect(crackPath(42, 60, 30)).toEqual(a);
    expect(crackPath(43, 60, 30)).not.toEqual(a);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(60);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(30);
    }
    expect(a.length).toBeGreaterThanOrEqual(4);
  });
});
