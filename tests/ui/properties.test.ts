import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Investigation, Preset } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { DEFAULT_PREFS, PREFS_KEY, createPrefsStore, type Prefs } from "../../src/features/investigation/prefs";
import { currentStepOf, type Selection } from "../../src/features/investigation/selection";
import { searchModules } from "../../src/features/investigation/search";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient, makeLayoutResult } from "./fakeLayoutClient";
import { makeInvestigation, mulberry32 } from "./generators";
import { inside, intersects, layoutOf, rankMap, requestFor } from "./layoutRequests";
import { layoutKey } from "../../src/scene/layout/key";
import type { LayoutRequest } from "../../src/scene/layout/types";
import { createAnimator } from "../../src/scene/animation";
import { buildHitTargets, hitTest } from "../../src/scene/hitTest";

// Property tests: P5, P10, P11, P13, P14 (task 2a), P6 (task 2b), P1, P2, P3 (task 3), P9 (task 4) and P4 (task 5). `HAUNTMAP_FAST` (see .kiro/hooks/README.md) lowers the runs.
const RUNS = process.env["HAUNTMAP_FAST"] === undefined ? 200 : 50;
const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

const investigationArb: fc.Arbitrary<Investigation> = fc
  .record({
    wingCount: fc.integer({ min: 1, max: 6 }),
    modules: fc.integer({ min: 2, max: 60 }),
    relationsPerModule: fc.integer({ min: 0, max: 4 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })
  .map(({ wingCount, modules, relationsPerModule, seed }) => {
    const wings: Record<string, number> = {};
    for (let i = 0; i < wingCount; i++) wings[`src/w${i}`] = 0;
    for (let m = 0; m < modules; m++) wings[`src/w${m % wingCount}`] = (wings[`src/w${m % wingCount}`] ?? 0) + 1;
    return makeInvestigation({ wings, relationsPerModule: Math.min(relationsPerModule, modules - 1), seed });
  });

function newStore() {
  const layoutClient = createFakeLayoutClient();
  const store = createInvestigationStore({ analysisApi, layoutClient, prefs: createPrefsStore(null) });
  return { store, layoutClient };
}

describe("P5 selection agreement (store half; the scene, inspector and trail halves arrive with tasks 9 and 10)", () => {
  it("after any sequence of select actions, every derived surface sees the last selection", () => {
    fc.assert(
      fc.property(
        investigationArb,
        fc.array(fc.tuple(fc.nat(), fc.constantFrom("scene", "dom"), fc.constantFrom("module", "relation", "wing", "none")), { minLength: 1, maxLength: 20 }),
        (inv, picks) => {
          const { store } = newStore();
          store.actions.openInvestigation(inv, null, { demo: false });
          const styleStates: { selection: Selection }[] = [];
          store.subscribe(() => styleStates.push({ selection: store.getState().selection }));
          for (const [n, from, kind] of picks) {
            const module = inv.modules[n % inv.modules.length]!;
            const relation = inv.imports[n % Math.max(inv.imports.length, 1)];
            const selection: Selection =
              kind === "module"
                ? { kind: "module", id: module.id }
                : kind === "relation" && relation !== undefined
                  ? { kind: "relation", relationId: relation.relationId, occurrenceId: relation.occurrenceId }
                  : kind === "wing"
                    ? { kind: "wing", wing: "src/w0" }
                    : { kind: "none" };
            store.actions.select(selection, { from });
            expect(styleStates[styleStates.length - 1]!.selection).toEqual(selection);
            expect(store.getState().selection).toEqual(selection);
            expect(store.getState().selectionOrigin).toBe(from);
            expect(currentStepOf(store.getState().routeFilter, store.getState().selection)).toBeNull();
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("P10 camera invariance (4.6)", () => {
  it("select, focusModule, chooseLoop, chooseImporter, setView, openLoops and setStatus never change the camera", () => {
    fc.assert(
      fc.property(
        investigationArb,
        fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }), zoom: fc.double({ min: 0.25, max: 4, noNaN: true }) }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 8 }), fc.nat()), { minLength: 1, maxLength: 30 }),
        (inv, camera, steps) => {
          const { store, layoutClient } = newStore();
          store.actions.openInvestigation(inv, null, { demo: false });
          store.actions.setCamera(camera);
          const before = store.getState().camera;
          const requests = layoutClient.requests.length;
          for (const [action, n] of steps) {
            const id = inv.modules[n % inv.modules.length]!.id;
            if (action === 0) store.actions.select({ kind: "module", id }, { from: "dom" });
            else if (action === 1) store.actions.focusModule(id);
            else if (action === 2) store.actions.openLoops();
            else if (action === 3) store.actions.chooseLoop(n % 3);
            else if (action === 4) store.actions.openWhoImports(id);
            else if (action === 5) store.actions.chooseImporter(id);
            else if (action === 6) store.actions.setView(n % 2 === 0 ? "map" : "evidence");
            else if (action === 7) store.actions.setStatus(`status ${n}`);
            else store.actions.clearSelection();
            expect(store.getState().camera).toEqual(before);
          }
          expect(layoutClient.requests).toHaveLength(requests);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("P11 stale rejection (3.2)", () => {
  it("the applied layout is the last result whose revision equals layoutRevision", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 25 }),
        (extraRequests, revisions) => {
          const { store } = newStore();
          store.actions.openInvestigation(makeInvestigation({ wings: { "src/a": 3, "src/b": 3 }, relationsPerModule: 1, seed: 1 }), null, { demo: false });
          for (let i = 0; i < extraRequests; i++) store.actions.expandWing(i % 2 === 0 ? "src/a" : "src/b");
          const current = store.getState().layoutRevision;
          let expected: string | null = null;
          revisions.forEach((v, index) => {
            const key = `r${index}-v${v}`;
            const before = store.getState().layout?.layoutKey ?? null;
            store.actions.layoutResult(makeLayoutResult(key), v);
            const after = store.getState().layout?.layoutKey ?? null;
            if (v === current) expected = key;
            else expect(after).toBe(before);
          });
          expect(store.getState().layout?.layoutKey ?? null).toBe(expected);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("P13 route-filter shape (7.2, 7.5)", () => {
  it("witness filters close on their first module and trace filters end at the origin", () => {
    fc.assert(
      fc.property(investigationArb, fc.constantFrom(...PRESETS), fc.nat(), (inv, preset, n) => {
        const { store } = newStore();
        store.actions.openInvestigation(inv, null, { demo: false });
        store.actions.setPreset(preset);
        const byRelation = new Map(inv.imports.map((r) => [r.relationId, r]));

        store.actions.openLoops();
        const loops = store.getState().panel;
        if (loops.kind !== "loops" || loops.report === null) throw new Error("loops panel did not open");
        loops.report.components.forEach((_, index) => {
          store.actions.chooseLoop(index);
          const filter = store.getState().routeFilter;
          if (filter === null || filter.kind !== "witness") throw new Error("no witness filter");
          expect(filter.relationIds).toHaveLength(filter.modules.length);
          filter.relationIds.forEach((id, i) => {
            const record = byRelation.get(id)!;
            expect(record.from).toBe(filter.modules[i]);
            expect(record.to).toBe(filter.modules[(i + 1) % filter.modules.length]);
          });
        });

        const origin = inv.modules[n % inv.modules.length]!.id;
        store.actions.openWhoImports(origin);
        const who = store.getState().panel;
        if (who.kind !== "whoImports" || who.result === null) throw new Error("who-imports panel did not open");
        for (const chosen of [...who.result.direct, ...who.result.indirect]) {
          store.actions.chooseImporter(chosen);
          const filter = store.getState().routeFilter;
          if (filter === null || filter.kind !== "trace") throw new Error("no trace filter");
          expect(filter.modules[0]).toBe(chosen);
          expect(filter.modules[filter.modules.length - 1]).toBe(origin);
          expect(filter.relationIds).toHaveLength(filter.modules.length - 1);
          filter.relationIds.forEach((id, i) => {
            const record = byRelation.get(id)!;
            expect(record.from).toBe(filter.modules[i]);
            expect(record.to).toBe(filter.modules[i + 1]);
          });
          expect(filter.relationIds).toHaveLength(who.result.distance[chosen]!);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe("P14 preferences robustness (5.6)", () => {
  const validPrefs = (p: Prefs) =>
    p.version === 1 &&
    ["system", "reduce", "allow"].includes(p.motion) &&
    typeof p.legendOpen === "boolean" &&
    PRESETS.includes(p.preset);

  it("read() returns a valid Prefs for any stored string", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.string().map((s) => JSON.stringify({ version: 1, motion: s }))), (stored) => {
        const storage = { getItem: () => stored, setItem: () => undefined };
        expect(validPrefs(createPrefsStore(storage).read())).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it("write(p) followed by read() returns p", () => {
    fc.assert(
      fc.property(
        fc.record({
          version: fc.constant(1 as const),
          motion: fc.constantFrom("system", "reduce", "allow"),
          legendOpen: fc.boolean(),
          preset: fc.constantFrom(...PRESETS),
        }),
        (prefs) => {
          const data = new Map<string, string>();
          const store = createPrefsStore({
            getItem: (k) => data.get(k) ?? null,
            setItem: (k, v) => void data.set(k, v),
          });
          store.write(prefs);
          expect(data.has(PREFS_KEY)).toBe(true);
          expect(store.read()).toEqual(prefs);
        },
      ),
      { numRuns: RUNS },
    );
    expect(DEFAULT_PREFS.version).toBe(1);
  });
});

describe("P6 search (4.1, 4.3)", () => {
  it("shown is the sorted, case-insensitive substring matches truncated to 20, total counts them all, empty gives none", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ maxLength: 12 }), { maxLength: 80 }),
        fc.string({ maxLength: 4 }),
        (ids, query) => {
          const result = searchModules(ids, query);
          if (query === "") {
            expect(result).toEqual({ shown: [], total: 0 });
            return;
          }
          const matches = ids.filter((id) => id.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          expect(result.shown).toEqual(matches.slice(0, 20));
          expect(result.total).toBe(matches.length);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
// ---- P1, P2, P3: the layout engine ------------------------------------------------------------

/** Wing names carry characters that need escaping in markup, to show the layout treats IDs as opaque text. */
const SUFFIXES = ["", "<b>", "&amp;", "\"'"];

const layoutCaseArb = fc.record({
  wingCount: fc.integer({ min: 1, max: 6 }),
  modules: fc.integer({ min: 2, max: 80 }),
  relationsPerModule: fc.integer({ min: 0, max: 4 }),
  seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  suffix: fc.constantFrom(...SUFFIXES),
  preset: fc.constantFrom(...PRESETS),
  expandMask: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
});

type LayoutCase = typeof layoutCaseArb extends fc.Arbitrary<infer T> ? T : never;

function layoutCase(c: LayoutCase) {
  const wings: Record<string, number> = {};
  for (let i = 0; i < c.wingCount; i++) wings[`src/w${i}${c.suffix}`] = 0;
  const names = Object.keys(wings);
  for (let m = 0; m < c.modules; m++) wings[names[m % c.wingCount]!] = (wings[names[m % c.wingCount]!] ?? 0) + 1;
  const inv = makeInvestigation({
    wings,
    relationsPerModule: Math.min(c.relationsPerModule, c.modules - 1),
    seed: c.seed,
    boundaryRatio: 0.1,
  });
  const expanded = names.filter((_, i) => c.expandMask[i]);
  return { inv, names, expanded };
}

describe("P1 layout totality and determinism (2.1, 2.2, 2.3, 3.3, 3.6)", () => {
  it("every shown module has one 96 x 64 room inside its wing, every door and sealed doorway exists once, and two runs agree", async () => {
    await fc.assert(
      fc.asyncProperty(layoutCaseArb, async (c) => {
        const { inv, names, expanded } = layoutCase(c);
        const req = requestFor(inv, expanded, c.preset);
        const result = await layoutOf(req);

        const shown = new Set(req.expandedWings.flatMap((w) => w.shownIds));
        expect(result.rooms.map((r) => r.id).sort()).toEqual([...shown].sort());
        for (const room of result.rooms) {
          expect([room.w, room.h]).toEqual([96, 64]);
          expect(inside(room, result.wings.find((w) => w.wing === room.wing)!)).toBe(true);
        }
        for (const wing of result.wings) expect(inside(wing, result.bounds)).toBe(true);
        for (let i = 0; i < result.wings.length; i++) {
          for (let j = i + 1; j < result.wings.length; j++) expect(intersects(result.wings[i]!, result.wings[j]!)).toBe(false);
        }

        const drawnIds = new Set(result.rooms.map((r) => r.id));
        const wantedDoors = req.relations.filter((r) => drawnIds.has(r.from) && drawnIds.has(r.to)).map((r) => r.relationId).sort();
        expect(result.doors.map((d) => d.relationId).sort()).toEqual(wantedDoors);
        const wantedSealed = req.boundaries.filter((b) => drawnIds.has(b.from)).map((b) => b.relationId).sort();
        expect(result.sealed.map((s) => s.relationId).sort()).toEqual(wantedSealed);

        const again = await layoutOf(req);
        expect(again).toEqual(result);
        expect(again.layoutKey).toBe(result.layoutKey);
        expect(await layoutKey(req, result.engine)).toBe(result.layoutKey);

        const base = rankMap(await layoutOf(requestFor(inv, [], c.preset)));
        for (const wing of names) {
          expect(rankMap(await layoutOf(requestFor(inv, [wing], c.preset)))).toEqual(base);
        }
        expect(rankMap(result)).toEqual(base);
      }),
      { numRuns: RUNS },
    );
  }, 300_000);
});

describe("P2 cap (3.5)", () => {
  it("a wing draws at most 80 rooms, shownIds plus hiddenCount is the module count, and a brought module is shown", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 200 }), fc.nat(), fc.boolean(), async (count, pick, useBring) => {
        const inv = makeInvestigation({ wings: { "src/big": count, "src/other": 3 }, relationsPerModule: Math.min(2, count + 2), seed: count });
        const bring = `src/big/m${String(pick % count).padStart(3, "0")}.ts`;
        const brought = useBring ? new Map([["src/big", bring]]) : new Map<string, string>();
        const req = requestFor(inv, "all", "static-value", brought);
        const result = await layoutOf(req);
        for (const wing of result.wings) {
          expect(result.rooms.filter((r) => r.wing === wing.wing).length).toBeLessThanOrEqual(80);
          expect(wing.shownIds.length + wing.hiddenCount).toBe(wing.moduleCount);
        }
        const big = result.wings.find((w) => w.wing === "src/big")!;
        if (useBring) expect(big.shownIds).toContain(bring);
        expect(result.grouped.length).toBe(count > 80 ? 1 : 0);
      }),
      { numRuns: RUNS },
    );
  }, 300_000);
});

describe("P3 order independence (3.3)", () => {
  it("permuting modules, relations and boundaries leaves the result deep-equal", async () => {
    await fc.assert(
      fc.asyncProperty(layoutCaseArb, fc.integer({ min: 1, max: 1000 }), async (c, seed) => {
        const { inv, expanded } = layoutCase(c);
        const req = requestFor(inv, expanded, c.preset);
        const random = mulberry32(seed);
        const shuffle = <T,>(list: readonly T[]): T[] => {
          const copy = [...list];
          for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [copy[i], copy[j]] = [copy[j]!, copy[i]!];
          }
          return copy;
        };
        const permuted: LayoutRequest = {
          ...req,
          modules: shuffle(req.modules),
          relations: shuffle(req.relations),
          boundaries: shuffle(req.boundaries),
          expandedWings: shuffle(req.expandedWings).map((w) => ({ ...w, shownIds: shuffle(w.shownIds) })),
        };
        const a = await layoutOf(req);
        const b = await layoutOf(permuted);
        expect(b).toEqual(a);
        expect(b.layoutKey).toBe(a.layoutKey);
      }),
      { numRuns: RUNS },
    );
  }, 300_000);
});
describe("P9 reduced motion (11.5, 9.5)", () => {
  const ops = fc.array(
    fc.record({ duration: fc.constantFrom(0, 100, 300, 600), steps: fc.array(fc.integer({ min: 1, max: 400 }), { maxLength: 6 }) }),
    { minLength: 1, maxLength: 12 },
  );

  it("with reduced motion on, no sequence of tweens is ever active", () => {
    fc.assert(
      fc.property(ops, (list) => {
        const animator = createAnimator({ reduced: true });
        let finished = 0;
        for (const op of list) {
          animator.tween({ duration: op.duration, update: () => undefined, onDone: () => finished++ });
          expect(animator.activeTweens).toBe(0);
          for (const dt of op.steps) {
            animator.tick(dt);
            expect(animator.activeTweens).toBe(0);
          }
        }
        expect(finished).toBe(list.length);
      }),
      { numRuns: RUNS },
    );
  });

  it("with it off, every tween completes and the active count returns to 0", () => {
    fc.assert(
      fc.property(ops, (list) => {
        const animator = createAnimator({ reduced: false });
        let finished = 0;
        for (const op of list) {
          animator.tween({ duration: op.duration, update: () => undefined, onDone: () => finished++ });
          for (const dt of op.steps) animator.tick(dt);
        }
        animator.tick(10_000);
        expect(animator.activeTweens).toBe(0);
        expect(finished).toBe(list.length);
      }),
      { numRuns: RUNS },
    );
  });
});
describe("P4 hit targets (9.1, 9.2)", () => {
  it("every door and sealed hit is at least 24 x 24, disjoint per room, found at its center, and nothing outside the bounds hits", async () => {
    await fc.assert(
      fc.asyncProperty(investigationArb, async (inv) => {
        const layout = await layoutOf(requestFor(inv, "all"));
        const targets = buildHitTargets(layout);
        const perRoom = new Map<string, { x: number; y: number; w: number; h: number }[]>();
        for (const t of targets) {
          if (t.kind !== "door" && t.kind !== "sealed") continue;
          expect(t.rect.w).toBeGreaterThanOrEqual(24);
          expect(t.rect.h).toBeGreaterThanOrEqual(24);
          expect(hitTest(targets, { x: t.rect.x + t.rect.w / 2, y: t.rect.y + t.rect.h / 2 })).toMatchObject({ kind: t.kind, id: t.id });
          const from = t.kind === "door" ? layout.doors.find((d) => d.relationId === t.id)!.from : layout.sealed.find((s) => s.relationId === t.id)!.from;
          const list = perRoom.get(from) ?? [];
          for (const other of list) expect(intersects(other, t.rect)).toBe(false);
          list.push(t.rect);
          perRoom.set(from, list);
        }
        expect(hitTest(targets, { x: layout.bounds.x - 1, y: layout.bounds.y - 1 })).toBeNull();
        expect(hitTest(targets, { x: layout.bounds.x + layout.bounds.w + 1, y: layout.bounds.y + layout.bounds.h + 1 })).toBeNull();
      }),
      { numRuns: RUNS },
    );
  }, 300_000);
});