import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inspector } from "../../src/components/Inspector";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { place } from "../../src/features/compare/placement";
import { createCompareStore } from "../../src/features/compare/store";
import { buildHitTargets, hitTest } from "../../src/scene/hitTest";
import { loadFixture } from "./expected";
import { relationIdFor } from "./ids";
import { nodeSha256 } from "./loadFolder";
import { createHarness, flush, layoutSettled } from "./storeHarness";

afterEach(cleanup);

async function activeRename() {
  const h = createHarness();
  const { before, after } = loadFixture("rename");
  h.store.actions.openInvestigation(before, null, { expandWing: "src/util", demo: false });
  await layoutSettled(h.store);
  h.store.actions.expandWing("src");
  await layoutSettled(h.store);
  const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base, place, sha256Hex: nodeSha256 });
  await cs.actions.compareWith({ kind: "investigation", snapshot: { label: after.sourceLabel, investigation: after, sourceText: null } }, h.store.getState().layout?.layoutKey ?? null);
  return { h, cs };
}

describe("ghosts stay selectable (5.6)", () => {
  it("the removed module's room and the removed relation's door are hit targets of the extended layout", async () => {
    const { h, cs } = await activeRename();
    expect(cs.getState().layoutPath).toBe("extended");
    const layout = h.store.getState().layout;
    if (layout === null) throw new Error("no layout");
    const targets = buildHitTargets(layout);
    const removedDoor = relationIdFor("src/app.ts", "src/util/format.ts", "import", "value");
    const ghostRoom = targets.find((t) => t.kind === "room" && t.id === "src/util/format.ts");
    const ghostDoor = targets.find((t) => t.kind === "door" && t.id === removedDoor);
    expect(ghostRoom).toBeDefined();
    expect(ghostDoor).toBeDefined();
    const r = ghostDoor?.rect as { x: number; y: number; w: number; h: number };
    expect(hitTest(targets, { x: r.x + r.w / 2, y: r.y + r.h / 2 })).toEqual(ghostDoor);
    expect(targets.some((t) => t.kind === "room" && t.id === "src/util/formatMoney.ts")).toBe(true);
  });

  it("the fleet inspector shows a ghost room and a ghost door without throwing (gate G4 not needed)", async () => {
    const { h } = await activeRename();
    render(<Inspector store={h.store} />);
    await act(async () => {
      await flush();
    });
    act(() => h.store.actions.select({ kind: "module", id: "src/util/format.ts" }, { from: "scene" }));
    expect(screen.getByLabelText("Inspector").textContent).toContain("src/util/format.ts");
    act(() => h.store.actions.select({ kind: "relation", relationId: relationIdFor("src/app.ts", "src/util/format.ts", "import", "value") }, { from: "scene" }));
    expect(screen.getByLabelText("Inspector")).toBeTruthy();
  });
});