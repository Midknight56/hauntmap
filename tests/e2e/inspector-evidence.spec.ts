import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { expected, inspectorHeading, openFixture, openManor, readStatus } from "./helpers";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manor = expected();

function sourceOf(path: string): string {
  const sources = JSON.parse(readFileSync(join(REPO, "public", "demo", "manor", "before", "sources.json"), "utf8")) as { files: { path: string; text: string }[] };
  const file = sources.files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`no source for ${path}`);
  return file.text;
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });

async function showEvidence(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Evidence" }).click();
}

/** Under static-value: import and re-export syntax with value or mixed dependency (the oracle of this spec, read from expected.json). */
function inStaticValue(r: { syntaxKind: string; dependencyKind: string }): boolean {
  return (r.syntaxKind === "import" || r.syntaxKind === "re-export") && (r.dependencyKind === "value" || r.dependencyKind === "mixed");
}

function relationKey(r: { from: string; to: string | null; specifier: string; resolution: string; syntaxKind: string; dependencyKind: string }): string {
  return JSON.stringify([r.from, r.resolution === "local" ? ["local", r.to] : [r.resolution, r.specifier], r.syntaxKind, r.dependencyKind]);
}

test.describe("inspector and evidence view", () => {
  test("6.2 a module card shows its wing, language, parse status and its imports and importers", async ({ page }) => {
    await openManor(page);
    await showEvidence(page);
    await page.getByRole("button", { name: /^src\/orders\/checkout\.ts \u00B7 ok$/ }).click();
    await expect(inspectorHeading(page)).toHaveText("src/orders/checkout.ts");
    await expect(inspector(page).getByText("Wing: src/orders")).toBeVisible();
    await expect(inspector(page).getByText("Language: TypeScript")).toBeVisible();
    await expect(inspector(page).getByText("Parse status: ok")).toBeVisible();
    const outgoing = new Set(
      manor.imports.filter((r) => r.from === "src/orders/checkout.ts" && inStaticValue(r)).map((r) => `${r.to ?? `"${r.specifier}"`} \u00B7 ${r.syntaxKind} \u00B7 ${r.dependencyKind}`),
    );
    const list = inspector(page).getByRole("list", { name: `Imports (${outgoing.size})` });
    const labels = await list.getByRole("button").allTextContents();
    expect(new Set(labels)).toEqual(outgoing);
    const incoming = manor.imports.filter((r) => r.to === "src/orders/checkout.ts" && inStaticValue(r));
    await expect(inspector(page).getByRole("list", { name: new RegExp(`^Imported by \\(${new Set(incoming.map(relationKey)).size}\\)$`) })).toBeVisible();
    for (const name of ["Focus", "Who imports this?", /expand wing|collapse wing/i]) {
      await expect(inspector(page).getByRole("button", { name })).toBeVisible();
    }
  });

  test("6.3 a relation card shows the import line of receipt.ts with two lines before and after", async ({ page }) => {
    await openManor(page);
    await showEvidence(page);
    const { specifier, importLine } = manor.receiptToCheckout;
    await page.getByRole("button", { name: "src/notifications/receipt.ts imports src/orders/checkout.ts \u00B7 import \u00B7 value \u00B7 local \u00B7 in preset" }).click();
    await expect(inspectorHeading(page)).toHaveText("src/notifications/receipt.ts imports src/orders/checkout.ts");
    await expect(inspector(page).getByText("Syntax: import")).toBeVisible();
    await expect(inspector(page).getByText("Dependency: value")).toBeVisible();
    await expect(inspector(page).getByText("Resolution: local")).toBeVisible();
    await expect(inspector(page).getByText("Preset: in static-value")).toBeVisible();
    await inspector(page).getByRole("button", { name: new RegExp(`^line ${importLine}, column \\d+: ${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
    const excerpt = inspector(page).getByRole("region", { name: "Source excerpt" });
    const lines = sourceOf("src/notifications/receipt.ts").split(/\r?\n/);
    await expect(excerpt).toContainText(`${importLine} ${lines[importLine - 1]}`);
    const items = await excerpt.getByRole("listitem").allTextContents();
    expect(items).toEqual(
      [importLine - 2, importLine - 1, importLine, importLine + 1, importLine + 2]
        .filter((n) => n >= 1 && n <= lines.length)
        .map((n) => `${n} ${lines[n - 1]}`),
    );
  });

  test("6.5 the Evidence view counts equal expected.json, and every item is a button", async ({ page }) => {
    await openManor(page);
    await showEvidence(page);
    await expect(page.getByRole("heading", { name: "Evidence (static-value)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Modules (${manor.modules.length})`, level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Wings (${Object.keys(manor.wings).length})`, level: 3 })).toBeVisible();
    const relations = new Set(manor.imports.map(relationKey));
    await expect(page.getByRole("heading", { name: `Relations (${relations.size})`, level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Diagnostics (${manor.diagnostics.length})`, level: 3 })).toBeVisible();
    for (const [wing, count] of Object.entries(manor.wings)) {
      await expect(page.getByRole("button", { name: `${wing} \u00B7 ${count} modules` })).toBeVisible();
    }
    const moduleButtons = await page.locator("[data-module-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-module-id")));
    expect([...moduleButtons].sort()).toEqual(manor.modules.map((m) => m.id).sort());
    const relationButtons = await page.locator("[data-relation-id]").count();
    expect(relationButtons).toBe(relations.size);
  });

  test("6.7 an Evidence-view selection centers the room; a scene click keeps focus on the map; I moves focus to the inspector heading", async ({ page }) => {
    await openManor(page);
    await showEvidence(page);
    await page.getByRole("button", { name: /^src\/orders\/checkout\.ts \u00B7 ok$/ }).click();
    await page.getByRole("tab", { name: "Map" }).click();
    const center = async (id: string) =>
      page.evaluate((moduleId) => {
        const hook = (window as Window & { __hauntmap?: { scene(): { screenRectOf(t: { kind: string; id: string }): DOMRect | null } | null } }).__hauntmap;
        const rect = hook?.scene()?.screenRectOf({ kind: "room", id: moduleId });
        const box = document.querySelector(".map-wrapper")?.getBoundingClientRect();
        if (!rect || !box) return null;
        return { dx: rect.x + rect.width / 2 - (box.left + box.width / 2), dy: rect.y + rect.height / 2 - (box.top + box.height / 2) };
      }, id);
    await expect.poll(async () => Math.abs((await center("src/orders/checkout.ts"))?.dx ?? 9999), { timeout: 5000 }).toBeLessThan(4);
    expect(Math.abs((await center("src/orders/checkout.ts"))?.dy ?? 9999)).toBeLessThan(4);

    // A scene click selects without taking focus away from the map wrapper.
    // Find a point of the room that hits the room itself, not one of its doors.
    const point = await page.evaluate(() => {
      type Scene = { screenRectOf(t: { kind: string; id: string }): DOMRect | null; hitTest(x: number, y: number): { kind: string; id: string } | null };
      const scene = (window as Window & { __hauntmap?: { scene(): Scene | null } }).__hauntmap?.scene();
      const r = scene?.screenRectOf({ kind: "room", id: "src/orders/order.ts" });
      if (!scene || !r) return null;
      for (let fy = 0.1; fy < 1; fy += 0.1) {
        for (let fx = 0.1; fx < 1; fx += 0.1) {
          const x = r.x + r.width * fx;
          const y = r.y + r.height * fy;
          const hit = scene.hitTest(x, y);
          if (hit?.kind === "room" && hit.id === "src/orders/order.ts") return { x, y };
        }
      }
      return null;
    });
    expect(point).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await expect(inspectorHeading(page)).toHaveText("src/orders/order.ts");
    await expect(page.getByRole("application", { name: "Haunted map" })).toBeFocused();

    await page.keyboard.press("I");
    await expect(inspectorHeading(page)).toBeFocused();
  });

  test("6.4 the trail of the manor loop lists its steps, marks the current one and walks with the arrow keys", async ({ page }) => {
    await openManor(page);
    const trail = page.getByRole("region", { name: "Evidence trail" });
    await expect(trail.getByText("Select a loop or a module to build an evidence trail.")).toBeVisible();
    await page.getByRole("button", { name: "Dependency loops" }).click();
    await page.getByRole("list", { name: "Loops" }).getByRole("button").first().click();
    const witness = manor.cycles["static-value"]![0]!.witness;
    const lineOf = (from: string, to: string) => manor.imports.find((r) => r.from === from && r.to === to && r.resolution === "local")!.line;
    const wanted = witness.modules.map((from, i) => {
      const to = witness.modules[(i + 1) % witness.modules.length]!;
      return `Step ${i + 1}: ${from} imports ${to} (line ${lineOf(from, to)})`;
    });
    const buttons = trail.getByRole("button");
    expect(await buttons.allTextContents()).toEqual(wanted);
    await expect(buttons.nth(0)).toHaveAttribute("aria-current", "step");
    await buttons.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await expect(buttons.nth(1)).toBeFocused();
    await expect(buttons.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(buttons.nth(0)).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("Enter");
    await expect(buttons.nth(1)).toHaveAttribute("aria-current", "step");
    await expect(inspectorHeading(page)).toHaveText(`${witness.modules[1]} imports ${witness.modules[2]}`);
    await page.keyboard.press("End");
    await expect(buttons.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(buttons.nth(0)).toBeFocused();
  });
  test("6.6 escaped.json: the id and the specifier are text, no image is created and no dialog opens", async ({ page }) => {
    await openFixture(page, "escaped");
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByRole("button", { name: /^src\/a&b\.ts \u00B7 ok$/ })).toBeVisible();
    await page.getByRole("button", { name: /^src\/a&b\.ts \u00B7 ok$/ }).click();
    await expect(inspectorHeading(page)).toHaveText("src/a&b.ts");
    await page.getByRole("button", { name: 'src/a&b.ts imports "./<img src=x onerror=alert(1)>" \u00B7 import \u00B7 value \u00B7 unresolved \u00B7 in preset' }).click();
    await expect(inspectorHeading(page)).toHaveText('src/a&b.ts \u2192 "./<img src=x onerror=alert(1)>"');
    await expect(inspector(page).getByText("Reason: absent-file")).toBeVisible();
    await inspector(page).getByRole("button", { name: 'line 1, column 1: ./<img src=x onerror=alert(1)>' }).click();
    await expect(inspector(page).getByText("Source not included in this snapshot; evidence is path, line and specifier.")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector("img"))).toBeNull();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    expect(await readStatus(page)).not.toContain("alert");
  });
});
