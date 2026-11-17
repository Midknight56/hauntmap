import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapView } from "../../src/components/MapView";
import type { Investigation } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { CompareControl } from "../../src/features/compare/CompareControl";
import { LIMITS_NOTE, RENAME_NOTE } from "../../src/features/compare/Notes";
import { NO_SOURCE_NOTE } from "../../src/features/compare/SelectedChange";
import { place } from "../../src/features/compare/placement";
import { registerCompare } from "../../src/features/compare/register";
import { createCompareStore, type CompareStore } from "../../src/features/compare/store";
import type { SceneInit } from "../../src/scene/types";
import { FIXTURE_NAMES, expectedRefs, loadFixture, type FixtureName } from "./expected";
import { relationIdFor } from "./ids";
import { FIXTURES, nodeSha256, readFolder, sourceMapOf } from "./loadFolder";
import { createHarness, flush, layoutSettled, openManorBefore, type Harness } from "./storeHarness";
import { itemLabel } from "../../src/features/compare/labels";

afterEach(cleanup);

function compareStore(h: Harness): CompareStore {
  const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base, place, sha256Hex: nodeSha256 });
  registerCompare(h.registry, cs);
  return cs;
}

async function mountControl(h: Harness) {
  render(
    <div role="toolbar" aria-label="Investigation tools">
      <CompareControl store={h.store} />
      <button type="button">Next control</button>
    </div>,
  );
  await act(async () => {
    await flush();
  });
}

const button = (name: string) => screen.getByRole("button", { name });
const panel = () => screen.getByRole("region", { name: "Compare revisions" });

async function openFixturePair(name: FixtureName, sources?: { before?: Map<string, string>; after?: Map<string, string> }) {
  const h = createHarness();
  const { before, after } = loadFixture(name);
  h.store.actions.openInvestigation(before, sources?.before ?? null, { demo: false });
  await layoutSettled(h.store);
  for (const wing of new Set(before.modules.map((m) => m.id.slice(0, m.id.lastIndexOf("/"))))) {
    h.store.actions.expandWing(wing);
    await layoutSettled(h.store);
  }
  const cs = compareStore(h);
  await mountControl(h);
  await act(async () => {
    await cs.actions.compareWith({ kind: "investigation", snapshot: { label: after.sourceLabel, investigation: after, sourceText: sources?.after ?? null } }, h.store.getState().layout?.layoutKey ?? null).catch(() => undefined);
  });
  act(() => cs.actions.openPanel());
  return { h, cs, before, after };
}

describe("the idle panel (1.1)", () => {
  it("on manor/before: the sentence and only Revised manor sample; aria-expanded follows the panel", async () => {
    const h = createHarness();
    await openManorBefore(h);
    compareStore(h);
    await mountControl(h);
    const control = button("Compare revisions");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(within(panel()).getByRole("heading", { name: "Compare revisions" })).toBeTruthy();
    expect(within(panel()).getByText("Compare manor/before with a newer snapshot.")).toBeTruthy();
    expect(within(panel()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Revised manor sample"]);
    expect(within(panel()).queryByText(/folder|GitHub/i)).toBeNull();
  });

  it("on another investigation: Bundled manor pair and its sentence", async () => {
    const h = createHarness();
    h.store.actions.openInvestigation({ ...loadFixture("comment-shift").before, sourceLabel: "annex" }, null, { demo: false });
    compareStore(h);
    await mountControl(h);
    fireEvent.click(button("Compare revisions"));
    expect(within(panel()).getByText("Compare annex with a newer snapshot.")).toBeTruthy();
    expect(within(panel()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Bundled manor pair"]);
    expect(within(panel()).getByText("Replaces the current investigation with manor/before and compares it with manor/after.")).toBeTruthy();
  });

  it("1.7, 10.8 the button is aria-disabled while busy, keeps focus on failure and is enabled again", async () => {
    const h = createHarness();
    await openManorBefore(h);
    compareStore(h);
    await mountControl(h);
    fireEvent.click(button("Compare revisions"));
    h.fetcher.failWith("manor/after", 500);
    const sample = button("Revised manor sample");
    sample.focus();
    fireEvent.click(sample);
    expect(sample.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(sample);
    await act(async () => {
      await flush();
      await flush();
    });
    expect(h.fetcher.urls.filter((u) => u.endsWith("manor/after/sources.json"))).toHaveLength(1);
    expect(h.store.getState().status).toBe("The revised manor sample could not be loaded (500). The current investigation is unchanged.");
    expect(document.activeElement).toBe(sample);
    expect(sample.getAttribute("aria-disabled")).toBe("false");
    expect(panel()).toBeTruthy();
  });
});

describe("the active panel on every fixture (7.1, 7.2, 7.4, 2.3, 2.4, 2.5, 3.7)", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: the lines, the Show group, the five named lists, the notes and End comparison in order`, async () => {
      const { cs, before, after } = await openFixturePair(name);
      const { expected } = loadFixture(name);
      const state = cs.getState();
      expect(state.status).toBe("active");
      const p = panel();
      const text = p.textContent ?? "";
      const lines = [
        `Earlier: ${before.sourceLabel} \u00b7 ${expected.before.moduleCount} modules \u00b7 ${expected.before.relationCount} relations`,
        `Newer: ${after.sourceLabel} \u00b7 ${expected.after.moduleCount} modules \u00b7 ${expected.after.relationCount} relations`,
        `Loops under static-value: ${expected.cyclicComponentsBefore} \u2192 ${expected.cyclicComponentsAfter}`,
      ];
      for (const line of lines) expect(within(p).getByText(line)).toBeTruthy();
      const group = within(p).getByRole("radiogroup", { name: "Show" });
      expect(within(group).getAllByRole("radio").map((r) => r.parentElement?.textContent)).toEqual([`Earlier (${before.sourceLabel})`, `Newer (${after.sourceLabel})`]);

      const lists: [string, string[]][] = [
        ["Removed relations", expectedRefs(expected.removedRelations).map((r) => itemLabel(r, null))],
        ["Added relations", expectedRefs(expected.addedRelations).map((r) => itemLabel(r, null))],
        ["Changed modules", expected.changedModules.map((id) => itemLabel(id, state.detail))],
        ["Removed modules", expected.removedModules],
        ["Added modules", expected.addedModules],
      ];
      let last = text.indexOf(lines[2] as string);
      for (const [heading, items] of lists) {
        const title = `${heading} (${items.length})`;
        expect(within(p).getByRole("heading", { name: title })).toBeTruthy();
        const at = text.indexOf(title);
        expect(at).toBeGreaterThan(last);
        last = at;
        if (items.length === 0) {
          expect(within(p).queryByRole("list", { name: title })).toBeNull();
        } else {
          const list = within(p).getByRole("list", { name: title });
          expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(items);
        }
      }
      expect(text.split("None.").length - 1).toBe(lists.filter(([, items]) => items.length === 0).length);

      const notes: string[] = [];
      if (expected.removedModules.length > 0 && expected.addedModules.length > 0) notes.push(RENAME_NOTE);
      if (expected.optionsDiffer.length > 0) notes.push(`The snapshots were analyzed with different options (${expected.optionsDiffer.join(", ")}); some differences may come from the options.`);
      for (const f of expected.parseFailed) {
        notes.push(`${f.id} could not be parsed in the ${f.side === "before" ? "earlier" : "newer"} snapshot; its relations there are unknown and appear as ${f.side === "before" ? "added" : "removed"}.`);
      }
      notes.push(LIMITS_NOTE);
      const notesAt = text.indexOf("Notes");
      expect(notesAt).toBeGreaterThan(last);
      let previous = notesAt;
      for (const note of notes) {
        const at = text.indexOf(note);
        expect(at, note).toBeGreaterThan(previous);
        previous = at;
      }
      const buttons = within(p).getAllByRole("button");
      expect(buttons.at(-1)?.textContent).toBe("End comparison");
      if (expected.identical) expect(within(p).getByText("No differences: the snapshots have the same modules, relations and source hashes.")).toBeTruthy();
      if (name === "rename") expect(text).not.toMatch(/renamed|rename detected/i);
    });
  }

  it("the manor pair: the item labels of design.md", async () => {
    const h = createHarness();
    await openManorBefore(h);
    const cs = compareStore(h);
    await mountControl(h);
    await act(async () => {
      await cs.actions.compareWithSample();
    });
    fireEvent.click(button("Compare revisions"));
    const changed = within(panel()).getByRole("list", { name: "Changed modules (2)" });
    expect(within(changed).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "src/notifications/receipt.ts \u00b7 import statements 4 \u2192 4 \u00b7 1 relations removed, 1 added",
      "src/orders/checkout.ts \u00b7 import statements 6 \u2192 6",
    ]);
    const removed = within(panel()).getByRole("list", { name: "Removed relations (1)" });
    expect(within(removed).getByRole("button").textContent).toBe("src/notifications/receipt.ts imports src/orders/checkout.ts \u00b7 import \u00b7 value");
  });
});

describe("the Show group and the cards (6.2, 7.3)", () => {
  it("arrow keys move the checked option and toggle the shown snapshot", async () => {
    const { h, cs } = await openFixturePair("comment-shift");
    const newer = screen.getByRole("radio", { name: "Newer (comment-shift/after)" });
    const earlier = screen.getByRole("radio", { name: "Earlier (comment-shift/before)" });
    expect((newer as HTMLInputElement).checked).toBe(true);
    act(() => {
      newer.focus();
      fireEvent.click(earlier);
    });
    expect(cs.getState().shown).toBe("before");
    expect(h.store.getState().status).toBe("Showing the earlier snapshot (comment-shift/before).");
    act(() => {
      fireEvent.keyDown(earlier, { key: "ArrowRight" });
    });
    expect(cs.getState().shown).toBe("after");
    expect(document.activeElement).toBe(newer);
    act(() => {
      fireEvent.keyDown(newer, { key: "ArrowUp" });
    });
    expect(cs.getState().shown).toBe("before");
  });

  it("a removed relation: the card, the selection from the DOM, focus kept, occurrences with the earlier excerpt", async () => {
    const dir = (side: string) => join(FIXTURES, "rename", "src", side);
    const sources = { before: sourceMapOf(readFolder(dir("before"), ".txt")), after: sourceMapOf(readFolder(dir("after"), ".txt")) };
    const { h } = await openFixturePair("rename", sources);
    const id = relationIdFor("src/app.ts", "src/util/format.ts", "import", "value");
    const item = within(screen.getByRole("list", { name: "Removed relations (1)" })).getByRole("button");
    item.focus();
    act(() => fireEvent.click(item));
    expect(document.activeElement).toBe(item);
    expect(h.store.getState().selection).toEqual({ kind: "relation", relationId: id });
    expect(h.store.getState().selectionOrigin).toBe("dom");
    const card = screen.getByRole("region", { name: "Selected change" });
    expect(within(card).getByRole("heading", { name: "src/app.ts imports src/util/format.ts" })).toBeTruthy();
    for (const line of ["Removed in rename/after", "Syntax: import", "Dependency: value", "Resolution: local", "Occurrences in rename/before (1)"]) {
      expect(within(card).getByText(line)).toBeTruthy();
    }
    expect(within(card).queryByText(/^Not drawn under/)).toBeNull();
    act(() => fireEvent.click(within(card).getByRole("button", { name: "line 1, column 1: ./util/format" })));
    expect(within(card).getByText('1 import { format } from "./util/format";')).toBeTruthy();
    expect(within(card).getByText("2 export const app = format(1);")).toBeTruthy();
  });

  it("an added relation with no source map and no door: the no-source sentence and Not drawn under the preset", async () => {
    const { h } = await openFixturePair("escaped");
    h.store.actions.setPreset("static-value");
    const item = within(screen.getByRole("list", { name: "Added relations (1)" })).getByRole("button");
    act(() => fireEvent.click(item));
    const card = screen.getByRole("region", { name: "Selected change" });
    expect(within(card).getByText("Added in local:escaped")).toBeTruthy();
    expect(within(card).getByText("Reason: absent-file")).toBeTruthy();
    expect(within(card).getByText("Not drawn under static-value")).toBeTruthy();
    act(() => fireEvent.click(within(card).getByRole("button", { name: "line 1, column 1: ./<img src=x onerror=alert(1)>" })));
    expect(within(card).getByText(NO_SOURCE_NOTE)).toBeTruthy();
  });

  it("an occurrence line beyond the source text says so", async () => {
    const { before, after } = loadFixture("comment-shift");
    const shortText = new Map([["src/a.ts", "only one line\n"]]);
    const h = createHarness();
    h.store.actions.openInvestigation(before, null, { demo: false });
    await layoutSettled(h.store);
    const cs = compareStore(h);
    await mountControl(h);
    const moved: Investigation = { ...after, imports: after.imports.map((r) => ({ ...r, relationId: relationIdFor("src/a.ts", "src/b.ts", "import", "mixed") })) };
    await act(async () => {
      await cs.actions.compareWith({ kind: "investigation", snapshot: { label: "short", investigation: moved, sourceText: shortText } }, null);
    });
    act(() => cs.actions.openPanel());
    act(() => fireEvent.click(within(screen.getByRole("list", { name: "Added relations (1)" })).getByRole("button")));
    act(() => fireEvent.click(screen.getByRole("button", { name: "line 3, column 1: ./b" })));
    expect(screen.getByText("Line 3 is not in the current source text.")).toBeTruthy();
  });

  it("a changed module and a removed or added module card", async () => {
    const { h } = await openFixturePair("rename");
    act(() => fireEvent.click(within(screen.getByRole("list", { name: "Changed modules (1)" })).getByRole("button")));
    let card = screen.getByRole("region", { name: "Selected change" });
    expect(within(card).getByText("Hash in rename/before: 1984e12f78e75c4f6d76dd8a0cbe102d238fa4890492c36f7e55bc01aa9a97cb")).toBeTruthy();
    expect(within(card).getByText("Hash in rename/after: 7b6050c79fd136330e8bb663edd569fd451127cb1ae00d698a1f8cedb243a29e")).toBeTruthy();
    expect(within(card).getByText("Import statements: 1 \u2192 1")).toBeTruthy();
    expect(h.store.getState().selection).toEqual({ kind: "module", id: "src/app.ts" });
    act(() => fireEvent.click(within(screen.getByRole("list", { name: "Removed modules (1)" })).getByRole("button")));
    card = screen.getByRole("region", { name: "Selected change" });
    expect(within(card).getByText("Only in rename/before \u00b7 TypeScript \u00b7 parsed")).toBeTruthy();
    act(() => fireEvent.click(within(screen.getByRole("list", { name: "Added modules (1)" })).getByRole("button")));
    card = screen.getByRole("region", { name: "Selected change" });
    expect(within(card).getByText("Only in rename/after \u00b7 TypeScript \u00b7 parsed")).toBeTruthy();
  });
});

describe("closing and ending (7.5, 6.6)", () => {
  it("Escape inside the panel closes it, returns focus to Compare revisions and keeps the comparison", async () => {
    const { cs } = await openFixturePair("cycle-closes");
    const end = button("End comparison");
    end.focus();
    act(() => fireEvent.keyDown(end, { key: "Escape" }));
    expect(screen.queryByRole("region", { name: "Compare revisions" })).toBeNull();
    const control = button("Compare revisions");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(control);
    expect(cs.getState().status).toBe("active");
  });

  it("Escape on the Compare revisions button closes the open popover too, keeps focus on the button and keeps the comparison", async () => {
    const { cs } = await openFixturePair("cycle-closes");
    const control = button("Compare revisions");
    control.focus();
    expect(control.getAttribute("aria-expanded")).toBe("true");
    act(() => fireEvent.keyDown(control, { key: "Escape" }));
    expect(screen.queryByRole("region", { name: "Compare revisions" })).toBeNull();
    expect(button("Compare revisions").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button("Compare revisions"));
    expect(cs.getState().status).toBe("active");
  });

  it("End comparison ends it, writes the status and moves focus to Compare revisions", async () => {
    const { h, cs } = await openFixturePair("cycle-closes");
    act(() => fireEvent.click(button("End comparison")));
    expect(cs.getState().status).toBe("idle");
    expect(h.store.getState().status).toBe("Comparison ended. Showing cycle-closes/before.");
    expect(document.activeElement).toBe(button("Compare revisions"));
  });
});

describe("text only (7.7) and no renderer (7.8)", () => {
  it("the escaped fixture appears verbatim and no img element exists", async () => {
    await openFixturePair("escaped");
    const p = panel();
    expect(p.textContent).toContain("src/a&b.ts");
    expect(p.textContent).toContain('src/a&b.ts \u2192 "./<img src=x onerror=alert(1)>" \u00b7 unresolved');
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("with the scene stubbed to fail, the lists, toggle, cards and notes work and nothing throws", async () => {
    const { h, cs } = await openFixturePair("rename");
    const createScene = vi.fn(async (): Promise<SceneInit> => ({ ok: false, reason: "forced", message: "off" }));
    render(<MapView store={h.store} createScene={createScene} />);
    await act(async () => {
      await flush();
    });
    expect(h.store.getState().renderer.status).toBe("unavailable");
    act(() => fireEvent.click(screen.getByRole("radio", { name: "Earlier (rename/before)" })));
    expect(cs.getState().shown).toBe("before");
    act(() => fireEvent.click(within(screen.getByRole("list", { name: "Removed relations (1)" })).getByRole("button")));
    expect(screen.getByRole("region", { name: "Selected change" })).toBeTruthy();
    expect(screen.getByText(LIMITS_NOTE)).toBeTruthy();
  });
});
