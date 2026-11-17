import { describe, expect, it } from "vitest";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { layoutInvestigation } from "../../src/scene/layout/engine";
import type { LayoutRequest } from "../../src/scene/layout/types";
import { wide } from "./generators";
import { layoutOf, requestFor } from "./layoutRequests";

describe("wing cap on the 120-module wing (3.5)", () => {
  it("draws the 80 smallest modules and one grouped room", async () => {
    const result = await layoutOf(requestFor(wide, ["src/big"]));
    const big = result.wings.find((w) => w.wing === "src/big")!;
    const ids = result.rooms.filter((r) => r.wing === "src/big").map((r) => r.id);
    expect(ids).toHaveLength(80);
    expect(ids[0]).toBe("src/big/m000.ts");
    expect(ids[79]).toBe("src/big/m079.ts");
    expect(big.shownIds).toEqual(ids);
    expect(big.hiddenCount).toBe(40);
    expect(big.shownIds.length + big.hiddenCount).toBe(120);
    expect(result.grouped).toHaveLength(1);
    expect(result.grouped[0]).toMatchObject({ wing: "src/big", hiddenCount: 40, label: "+40 more modules" });
    expect(result.grouped[0]!.w).toBeGreaterThan(0);
  });

  it("swaps a brought module into the last slot and hides m079", async () => {
    const result = await layoutOf(requestFor(wide, ["src/big"], "static-value", new Map([["src/big", "src/big/m119.ts"]])));
    const big = result.wings.find((w) => w.wing === "src/big")!;
    expect(big.shownIds).toHaveLength(80);
    expect(big.shownIds).toContain("src/big/m119.ts");
    expect(big.shownIds).not.toContain("src/big/m079.ts");
    expect(big.shownIds).toContain("src/big/m078.ts");
    expect(big.shownIds.length + big.hiddenCount).toBe(120);
    expect(result.rooms.filter((r) => r.wing === "src/big")).toHaveLength(80);
  });

  it("draws the grouped room inside its wing and clear of every room", async () => {
    const result = await layoutOf(requestFor(wide, ["src/big"]));
    const wing = result.wings.find((w) => w.wing === "src/big")!;
    const grouped = result.grouped[0]!;
    expect(grouped.x).toBeGreaterThanOrEqual(wing.x);
    expect(grouped.x + grouped.w).toBeLessThanOrEqual(wing.x + wing.w);
    expect(grouped.y + grouped.h).toBeLessThanOrEqual(wing.y + wing.h);
    for (const room of result.rooms) {
      const overlap = grouped.x < room.x + room.w && room.x < grouped.x + grouped.w && grouped.y < room.y + room.h && room.y < grouped.y + grouped.h;
      expect(overlap).toBe(false);
    }
  });

  it("a wing of at most 80 modules has no grouped room", async () => {
    const result = await layoutOf(requestFor(wide, ["src/small"]));
    expect(result.grouped).toEqual([]);
  });

  it("the store writes the 3.5 status text when the real engine answers", async () => {
    const store = createInvestigationStore({
      analysisApi,
      layoutClient: {
        lastResult: null,
        request: (payload: LayoutRequest) => layoutInvestigation(payload),
        cancel: () => undefined,
      },
      prefs: createPrefsStore(null),
    });
    store.actions.openInvestigation(wide, null, { demo: false });
    store.actions.expandWing("src/big");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(store.getState().layout?.rooms.filter((r) => r.wing === "src/big")).toHaveLength(80);
    expect(store.getState().status).toBe(
      "Showing 80 of 120 modules in src/big. Search to bring another module into view, or use the Evidence view for the full list.",
    );
  });
});
