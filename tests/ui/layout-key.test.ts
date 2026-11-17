import { describe, expect, it } from "vitest";
import { layoutKey } from "../../src/scene/layout/key";
import type { LayoutRequest } from "../../src/scene/layout/types";
import { fixture } from "./fixtureFiles";
import { mulberry32, perf200 } from "./generators";
import { layoutOf, requestFor } from "./layoutRequests";

const DAGRE = { name: "dagre", version: "3.1.3" };

function shuffled<T>(list: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function permuted(req: LayoutRequest, seed: number): LayoutRequest {
  return {
    ...req,
    modules: shuffled(req.modules, seed),
    relations: shuffled(req.relations, seed + 1),
    boundaries: shuffled(req.boundaries, seed + 2),
    expandedWings: shuffled(req.expandedWings, seed + 3).map((w) => ({ ...w, shownIds: shuffled(w.shownIds, seed + 4) })),
  };
}

describe("layoutKey and determinism (3.3)", () => {
  it("is a SHA-256 hex string", async () => {
    expect(await layoutKey(requestFor(fixture("triad")), DAGRE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shuffled modules, relations, boundaries and shown IDs give a deep-equal result and the same key", async () => {
    for (const [inv, expanded] of [
      [fixture("two-wings"), "all"],
      [perf200, "all"],
    ] as const) {
      const req = requestFor(inv, expanded);
      const base = await layoutOf(req);
      for (const seed of [1, 2, 3]) {
        const other = await layoutOf(permuted(req, seed));
        expect(other).toEqual(base);
        expect(other.layoutKey).toBe(base.layoutKey);
      }
    }
  });

  it("two runs on the same request give the same result", async () => {
    const req = requestFor(fixture("boundary"), "all");
    expect(await layoutOf(req)).toEqual(await layoutOf(req));
  });

  it("changes with the preset, the engine version, the boundary set and the shown modules", async () => {
    const inv = fixture("mixed-presets");
    const base = await layoutKey(requestFor(inv, "all"), DAGRE);
    expect(await layoutKey(requestFor(inv, "all", "type-inclusive"), DAGRE)).not.toBe(base);
    expect(await layoutKey(requestFor(inv, "all"), { name: "dagre", version: "9.9.9" })).not.toBe(base);
    expect(await layoutKey(requestFor(inv, []), DAGRE)).not.toBe(base);

    const boundary = requestFor(fixture("boundary"), "all");
    const baseBoundary = await layoutKey(boundary, DAGRE);
    const fewer = { ...boundary, boundaries: boundary.boundaries.slice(1) };
    expect(await layoutKey(fewer, DAGRE)).not.toBe(baseBoundary);

    const shown = requestFor(perf200, "all");
    const smaller: LayoutRequest = {
      ...shown,
      expandedWings: shown.expandedWings.map((w, i) => (i === 0 ? { ...w, shownIds: w.shownIds.slice(1), hiddenCount: w.hiddenCount + 1 } : w)),
    };
    expect(await layoutKey(smaller, DAGRE)).not.toBe(await layoutKey(shown, DAGRE));
  });

  it("does not depend on the order of wings", async () => {
    const req = requestFor(perf200, "all");
    const reversed = { ...req, expandedWings: [...req.expandedWings].reverse() };
    expect(await layoutKey(reversed, DAGRE)).toBe(await layoutKey(req, DAGRE));
  });
});
