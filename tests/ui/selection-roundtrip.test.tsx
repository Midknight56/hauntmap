import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceView } from "../../src/components/EvidenceView";
import { Inspector } from "../../src/components/Inspector";
import { MapView } from "../../src/components/MapView";
import { layoutInvestigation } from "../../src/scene/layout/engine";
import type { SceneInit, SceneOptions } from "../../src/scene/types";
import { flush } from "./fakeLayoutClient";
import { createFakeScene, type FakeScene } from "./fakeScene";
import { relationIdFor } from "./ids";
import { openedStore } from "./storeHarness";

afterEach(cleanup);

type Ctx = ReturnType<typeof openedStore> & { scene: FakeScene | null };

/** Answer the newest layout request with the real layout engine, as the worker would. */
async function settle(ctx: Ctx): Promise<void> {
  const pending = ctx.layoutClient.requests[ctx.layoutClient.requests.length - 1];
  if (pending === undefined) return;
  const result = await layoutInvestigation(pending.payload, undefined, () => 0);
  await act(async () => {
    pending.resolve(result);
    await flush();
  });
}

async function mount(name: Parameters<typeof openedStore>[0], opts: { sceneFails?: boolean; expand?: string } = {}): Promise<Ctx> {
  const base = openedStore(name, { "src/a.ts": 'import "./b";\n' });
  if (opts.expand !== undefined) base.store.actions.expandWing(opts.expand);
  const ctx: Ctx = { ...base, scene: null };
  const createScene = vi.fn<(options: SceneOptions) => Promise<SceneInit>>(async () => {
    if (opts.sceneFails === true) return { ok: false, reason: "forced", message: "no" };
    const fake = createFakeScene();
    ctx.scene = fake;
    return { ok: true, scene: fake.handle };
  });
  render(
    <>
      <MapView store={ctx.store} createScene={createScene} />
      <Inspector store={ctx.store} />
      <EvidenceView store={ctx.store} />
    </>,
  );
  await act(async () => {
    await flush();
  });
  await settle(ctx);
  return ctx;
}

const heading = () => within(screen.getByRole("complementary", { name: "Inspector" })).getAllByRole("heading")[0]!.textContent;
const focusCalls = (ctx: Ctx) => ctx.scene?.calls.filter((c) => c.name === "focusOn") ?? [];

describe("one selection, three views (6.1, 6.7)", () => {
  it("a click in the scene updates the highlight and the inspector, keeps focus on the map and does not move the camera", async () => {
    const ctx = await mount("triad", { expand: "src" });
    const door = ctx.scene!.lastLayout!.doors[0]!;
    act(() => ctx.scene!.emit("select", { kind: "door", id: door.relationId, rect: door.hit }));
    expect(ctx.scene!.lastStyleState?.selection).toEqual({ kind: "relation", relationId: door.relationId });
    expect(heading()).toBe(`${door.from} imports ${door.to}`);
    expect(document.activeElement).toBe(screen.getByRole("application", { name: "Haunted map" }));
    expect(focusCalls(ctx)).toHaveLength(0);
  });

  it("an Evidence-view item selects, shows in the inspector and the scene, and centers the camera", async () => {
    const ctx = await mount("triad");
    fireEvent.click(screen.getByRole("button", { name: /^src\/c\.ts \u00B7 ok$/ }));
    await settle(ctx);
    expect(ctx.store.getState().selection).toEqual({ kind: "module", id: "src/c.ts" });
    expect(ctx.scene!.lastStyleState?.selection).toEqual({ kind: "module", id: "src/c.ts" });
    expect(heading()).toBe("src/c.ts");
    expect(screen.getByRole("button", { name: /^src\/c\.ts \u00B7 ok$/ }).getAttribute("aria-current")).toBe("true");
    expect(focusCalls(ctx).at(-1)?.args).toEqual([{ kind: "room", id: "src/c.ts" }, 1]);
    expect(ctx.store.getState().expandedWings).toEqual(["src"]);
  });

  it("an inspector link and a trail step agree with the scene and the trail", async () => {
    const ctx = await mount("triad", { expand: "src" });
    act(() => ctx.store.actions.select({ kind: "module", id: "src/b.ts" }, { from: "dom" }));
    fireEvent.click(within(screen.getByRole("list", { name: "Imports (1)" })).getByRole("button"));
    const relation = relationIdFor("src/b.ts", "src/c.ts", "import", "value");
    expect(ctx.scene!.lastStyleState?.selection).toMatchObject({ kind: "relation", relationId: relation });
    expect(heading()).toBe("src/b.ts imports src/c.ts");
    expect(focusCalls(ctx).at(-1)?.args[0]).toEqual({ kind: "door", id: relation });
  });

  it("a trail step selects its relation, moves aria-current and the scene highlight", async () => {
    const ctx = await mount("cycle");
    act(() => {
      ctx.store.actions.openLoops();
      ctx.store.actions.chooseLoop(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Step 2: src/y.ts imports src/x.ts (line 1)" }));
    expect(ctx.scene!.lastStyleState?.selection).toMatchObject({ kind: "relation", relationId: relationIdFor("src/y.ts", "src/x.ts", "import", "value") });
    expect(ctx.scene!.lastStyleState?.routeFilter?.kind).toBe("witness");
    expect(heading()).toBe("src/y.ts imports src/x.ts");
    expect(screen.getByRole("button", { name: /^Step 2/ }).getAttribute("aria-current")).toBe("step");
  });

  it("a loops choice selects the first witness relation everywhere", async () => {
    const ctx = await mount("cycle");
    act(() => {
      ctx.store.actions.openLoops();
      ctx.store.actions.chooseLoop(0);
    });
    expect(heading()).toBe("src/x.ts imports src/y.ts");
    expect(ctx.scene!.lastStyleState?.selection).toMatchObject({ kind: "relation" });
  });

  it("a relation whose door is not drawn centers on the importer's room, or on its wing when collapsed", async () => {
    const ctx = await mount("two-wings");
    const cross = ctx.inv.imports.find((r) => r.from === "src/orders/a.ts")!;
    act(() => ctx.store.actions.select({ kind: "relation", relationId: cross.relationId }, { from: "dom" }));
    expect(focusCalls(ctx).at(-1)?.args[0]).toEqual({ kind: "wing", id: "src/orders" });
    act(() => ctx.store.actions.expandWing("src/orders"));
    await settle(ctx);
    act(() => ctx.store.actions.select({ kind: "relation", relationId: cross.relationId }, { from: "dom" }));
    expect(focusCalls(ctx).at(-1)?.args[0]).toEqual({ kind: "room", id: "src/orders/a.ts" });
  });
});

describe("the same actions with the scene stubbed out (6.8)", () => {
  it("keeps the inspector, the Evidence view and the trail working when createScene resolves { ok: false }", async () => {
    const ctx = await mount("triad", { sceneFails: true });
    expect(ctx.scene).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^src\/c\.ts \u00B7 ok$/ }));
    expect(heading()).toBe("src/c.ts");
    expect(screen.getByRole("button", { name: /^src\/c\.ts \u00B7 ok$/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(within(screen.getByRole("list", { name: "Imported by (1)" })).getByRole("button"));
    expect(heading()).toBe("src/b.ts imports src/c.ts");
  });
});
