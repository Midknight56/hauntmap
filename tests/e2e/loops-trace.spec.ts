import { expect, test, type Page } from "@playwright/test";
import { expected, inStaticValue, inspectorHeading, offsetFromMapCenter, openManor, readStatus, settled, snapshot, storeAction } from "./helpers";

const manor = expected();
const loops = (page: Page) => page.getByRole("region", { name: /^Dependency loops/ });
const who = (page: Page) => page.getByRole("region", { name: /^Who imports/ });
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });

const LOOP = "3 modules: src/notifications/receipt.ts, src/orders/checkout.ts, src/payments/charge.ts";

/** Reverse breadth-first search over the static-value local imports of expected.json: the oracle of 7.4 to 7.6. */
function importersOf(origin: string): Map<string, number> {
  const edges = manor.imports.filter((r) => r.resolution === "local" && r.to !== null && inStaticValue(r));
  const distance = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.to === current && !distance.has(edge.from)) {
        distance.set(edge.from, (distance.get(current) ?? 0) + 1);
        queue.push(edge.from);
      }
    }
  }
  distance.delete(origin);
  return distance;
}

const stepsText = (d: number): string => `${d} ${d === 1 ? "step" : "steps"}`;

async function openLoops(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Dependency loops" }).click();
  await expect(loops(page)).toBeVisible();
}

test.describe("dependency loops and who-imports", () => {
  test("7.1 the manor panel lists the one 3-module loop, and takes focus", async ({ page }) => {
    await openManor(page);
    await openLoops(page);
    await expect(page.getByRole("heading", { name: "Dependency loops (static-value)" })).toBeFocused();
    await expect(loops(page).getByText("1 loops", { exact: true })).toBeVisible();
    const members = manor.cycles["static-value"]?.[0]?.members ?? [];
    expect(`3 modules: ${members.join(", ")}`).toBe(LOOP);
    expect(await loops(page).getByRole("list", { name: "Loops" }).getByRole("button").allTextContents()).toEqual([LOOP]);
  });

  test("7.2 and 2.4 choosing the loop sets the witness route, fills the trail, selects the first relation and centers its door", async ({ page }) => {
    await openManor(page);
    await openLoops(page);
    const button = loops(page).getByRole("button", { name: LOOP });
    await button.click();
    await expect(button).toBeFocused();
    const witness = manor.cycles["static-value"]![0]!.witness;
    const state = await snapshot(page);
    expect(state.routeFilter).toMatchObject({ kind: "witness", modules: witness.modules });
    // The step numbers 1, 2, 3 are drawn from this order (src/scene/stateMap.ts, tests/ui/state-map.test.ts).
    expect(state.routeFilter?.relationIds).toEqual(witness.relationIds);
    expect(witness.relationIds).toHaveLength(3);
    expect(state.selection).toMatchObject({ kind: "relation", relationId: witness.relationIds[0] });
    const trail = page.getByRole("region", { name: "Evidence trail" });
    const steps = await trail.getByRole("button").allTextContents();
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.slice(0, 7))).toEqual(["Step 1:", "Step 2:", "Step 3:"]);
    await expect(inspectorHeading(page)).toContainText(" imports ");
    await settled(page);
    await expect
      .poll(async () => {
        const offset = await offsetFromMapCenter(page, { kind: "door", id: witness.relationIds[0]! });
        return offset === null ? 9999 : Math.max(Math.abs(offset.dx), Math.abs(offset.dy));
      })
      .toBeLessThan(4);
  });

  test("7.3 and 5.4 the preset sentences, the loops of each preset, and the recompute with the same index", async ({ page }) => {
    await openManor(page);
    await openLoops(page);
    await expect(loops(page).getByText(/type-only/)).toHaveCount(0);
    await loops(page).getByRole("button", { name: LOOP }).click();
    await page.getByRole("combobox", { name: "Relation preset" }).selectOption("type-inclusive");
    await expect(page.getByRole("heading", { name: "Dependency loops (type-inclusive)" })).toBeVisible();
    await expect(loops(page).getByText("This preset includes type-only relations, which the static-value preset leaves out; a loop that exists only here is not a runtime import cycle.")).toBeVisible();
    const wanted = (manor.cycles["type-inclusive"] ?? []).map((c) => (c.members.length === 1 ? `Self-import: ${c.members[0]}` : `${c.members.length} modules: ${c.members.join(", ")}`));
    expect(wanted.length).toBe(2);
    expect(await loops(page).getByRole("list", { name: "Loops" }).getByRole("button").allTextContents()).toEqual(wanted);
    expect((await snapshot(page)).panelKind).toBe("loops");
    await expect(loops(page).getByRole("button").first()).toHaveAttribute("aria-current", "true");
    await page.getByRole("combobox", { name: "Relation preset" }).selectOption("dynamic-inclusive");
    await expect(loops(page).getByText("This preset also includes literal dynamic imports.")).toBeVisible();
  });

  test("7.4 to 7.6 Who imports checkout.ts: lists, distances and prose equal a breadth-first search over expected.json", async ({ page }) => {
    await openManor(page);
    await page.getByRole("tab", { name: "Evidence" }).click();
    await page.getByRole("button", { name: /^src\/orders\/checkout\.ts \u00B7 ok$/ }).click();
    await inspector(page).getByRole("button", { name: "Who imports this?" }).click();
    await expect(page.getByRole("heading", { name: "Who imports src/orders/checkout.ts (static-value)" })).toBeVisible();
    const distance = importersOf("src/orders/checkout.ts");
    const direct = [...distance].filter(([, d]) => d === 1).map(([id]) => id).sort();
    const indirect = [...distance].filter(([, d]) => d > 1).map(([id]) => id).sort();
    expect(direct).toEqual(["src/notifications/receipt.ts"]);
    expect(indirect).toEqual(["src/payments/charge.ts"]);
    const label = (id: string) => `${id} \u00B7 ${stepsText(distance.get(id) ?? 0)}`;
    expect(await who(page).getByRole("list", { name: `Direct importers (${direct.length})` }).getByRole("button").allTextContents()).toEqual(direct.map(label));
    expect(await who(page).getByRole("list", { name: `Indirect (${indirect.length})` }).getByRole("button").allTextContents()).toEqual(indirect.map(label));
    await expect(
      who(page).getByText("These modules reach src/orders/checkout.ts through imports under this preset. They are places to inspect, not modules that will fail."),
    ).toBeVisible();
    const choice = who(page).getByRole("button", { name: "src/payments/charge.ts \u00B7 2 steps" });
    await choice.click();
    await expect(choice).toBeFocused();
    await expect(
      who(page).getByText(
        "src/payments/charge.ts reaches src/orders/checkout.ts in 2 steps: src/payments/charge.ts imports src/notifications/receipt.ts, src/notifications/receipt.ts imports src/orders/checkout.ts.",
      ),
    ).toBeVisible();
    const state = await snapshot(page);
    expect(state.routeFilter).toMatchObject({ kind: "trace", modules: ["src/payments/charge.ts", "src/notifications/receipt.ts", "src/orders/checkout.ts"] });
    expect(state.routeFilter?.relationIds).toHaveLength(2);
    expect(state.selection).toMatchObject({ kind: "relation", relationId: state.routeFilter?.relationIds[0] });
  });

  test("7.8 a computation that throws shows the message and keeps the filter and selection", async ({ page }) => {
    await openManor(page);
    await storeAction(page, "select", { kind: "module", id: "src/orders/checkout.ts" }, { from: "dom" });
    await inspector(page).getByRole("button", { name: "Focus" }).click();
    const before = await snapshot(page);
    await page.evaluate(() => window.__hauntmap!.failAnalysis("cycles"));
    await page.getByRole("button", { name: "Dependency loops" }).click();
    await expect(loops(page).getByText("Could not compute loops for this preset: forced.")).toBeVisible();
    let after = await snapshot(page);
    expect(after.routeFilter).toEqual(before.routeFilter);
    expect(after.selection).toEqual(before.selection);
    await page.evaluate(() => window.__hauntmap!.failAnalysis("trace"));
    await inspector(page).getByRole("button", { name: "Who imports this?" }).click();
    await expect(who(page).getByText("Could not compute importers for this preset: forced.")).toBeVisible();
    after = await snapshot(page);
    expect(after.routeFilter).toEqual(before.routeFilter);
    expect(after.selection).toEqual(before.selection);
    expect(await readStatus(page)).toContain("Focused on");
  });
});