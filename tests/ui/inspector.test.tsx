import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inspector } from "../../src/components/Inspector";
import { excerpt, NO_SOURCE_TEXT } from "../../src/components/SourceExcerpt";
import type { InvestigationStore } from "../../src/features/investigation/store";
import { relationIdFor } from "./ids";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { tooltipLines } from "../../src/components/Tooltip";
import { fixture } from "./fixtureFiles";
import { openedStore } from "./storeHarness";

afterEach(cleanup);

function mount(store: InvestigationStore) {
  return render(<Inspector store={store} />);
}

function select(store: InvestigationStore, sel: Parameters<InvestigationStore["actions"]["select"]>[0]) {
  act(() => store.actions.select(sel, { from: "dom" }));
}

const SOURCE = { "src/a.ts": 'import { b } from "./b";\nline 2\nline 3\nline 4\nline 5\nline 6\n' };

describe("inspector, module card (6.2)", () => {
  it("shows the hint and the heading `Inspector` while nothing is selected", () => {
    const { store } = openedStore("triad");
    mount(store);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Inspector");
  });

  it("shows the id, wing, language, parse status and the sorted lists", () => {
    const { store } = openedStore("triad");
    select(store, { kind: "module", id: "src/b.ts" });
    mount(store);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("src/b.ts");
    expect(screen.getByText("Wing: src")).toBeTruthy();
    expect(screen.getByText("Language: TypeScript")).toBeTruthy();
    expect(screen.getByText("Parse status: ok")).toBeTruthy();
    const imports = screen.getByRole("list", { name: "Imports (1)" });
    expect(within(imports).getAllByRole("button").map((b) => b.textContent)).toEqual(["src/c.ts \u00B7 import \u00B7 value"]);
    const importedBy = screen.getByRole("list", { name: "Imported by (2)" });
    expect(within(importedBy).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "src/a.ts \u00B7 import \u00B7 value",
      "src/d.ts \u00B7 import \u00B7 value",
    ]);
    expect(screen.getByRole("button", { name: "Focus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Who imports this?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand wing" })).toBeTruthy();
  });

  it("offers Collapse wing once the wing is expanded and wires Focus and Who imports this?", () => {
    const { store } = openedStore("triad");
    select(store, { kind: "module", id: "src/b.ts" });
    mount(store);
    fireEvent.click(screen.getByRole("button", { name: "Expand wing" }));
    expect(store.getState().expandedWings).toEqual(["src"]);
    expect(screen.getByRole("button", { name: "Collapse wing" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(store.getState().routeFilter?.kind).toBe("focus");
    expect(store.getState().status).toBe("Focused on src/b.ts: 2 importers, 1 imports.");
    fireEvent.click(screen.getByRole("button", { name: "Who imports this?" }));
    expect(store.getState().panel).toMatchObject({ kind: "whoImports", origin: "src/b.ts" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse wing" }));
    expect(store.getState().expandedWings).toEqual([]);
  });

  it("an Imports button selects that relation", () => {
    const { store } = openedStore("triad", SOURCE);
    select(store, { kind: "module", id: "src/b.ts" });
    mount(store);
    fireEvent.click(within(screen.getByRole("list", { name: "Imports (1)" })).getByRole("button"));
    expect(store.getState().selection).toMatchObject({ kind: "relation", relationId: relationIdFor("src/b.ts", "src/c.ts", "import", "value") });
    expect(store.getState().selectionOrigin).toBe("dom");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("src/b.ts imports src/c.ts");
  });

  it("lists the diagnostics of the module as `<code>: <message>`", () => {
    const { store } = openedStore("boundary");
    select(store, { kind: "module", id: "src/app.ts" });
    mount(store);
    const list = screen.getByRole("list", { name: "Diagnostics (2)" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toBe('unresolved: Cannot resolve "./ghosts/missing" from src/app.ts: absent-file.');
    expect(screen.getByRole("list", { name: "Imports (3)" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Imports (3)" })).getAllByRole("button").map((b) => b.textContent)).toContain(
      '"zod" \u00B7 import \u00B7 value',
    );
  });

  it("shows a wing card with the module count and the expand button", () => {
    const { store } = openedStore("two-wings");
    select(store, { kind: "wing", wing: "src/orders" });
    mount(store);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("src/orders");
    expect(screen.getByText("Modules: 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand wing" })).toBeTruthy();
  });
});

describe("inspector, relation card (6.3)", () => {
  it("shows the heading, kinds, resolution, preset line and occurrences", () => {
    const { store } = openedStore("triad", SOURCE);
    select(store, { kind: "relation", relationId: relationIdFor("src/a.ts", "src/b.ts", "import", "value") });
    mount(store);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("src/a.ts imports src/b.ts");
    expect(screen.getByText("Syntax: import")).toBeTruthy();
    expect(screen.getByText("Dependency: value")).toBeTruthy();
    expect(screen.getByText("Resolution: local")).toBeTruthy();
    expect(screen.getByText("Preset: in static-value")).toBeTruthy();
    expect(screen.queryByText(/^Reason:/)).toBeNull();
    const list = screen.getByRole("list", { name: "Occurrences (1)" });
    expect(within(list).getByRole("button").textContent).toBe("line 1, column 1: ./b");
  });

  it("activating an occurrence shows two lines before and after with one-based numbers", () => {
    const { store } = openedStore("triad", SOURCE);
    select(store, { kind: "relation", relationId: relationIdFor("src/a.ts", "src/b.ts", "import", "value") });
    mount(store);
    fireEvent.click(screen.getByRole("button", { name: "line 1, column 1: ./b" }));
    const region = screen.getByRole("region", { name: "Source excerpt" });
    expect(region.textContent).toContain('1 import { b } from "./b";');
    expect(region.textContent).toContain("3 line 3");
    expect(region.textContent).not.toContain("line 4");
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
  });

  it("says so when the investigation has no source text", () => {
    const { store } = openedStore("triad", null);
    select(store, { kind: "relation", relationId: relationIdFor("src/a.ts", "src/b.ts", "import", "value") });
    mount(store);
    fireEvent.click(screen.getByRole("button", { name: "line 1, column 1: ./b" }));
    expect(screen.getByText(NO_SOURCE_TEXT)).toBeTruthy();
    expect(NO_SOURCE_TEXT).toBe("Source not included in this snapshot; evidence is path, line and specifier.");
  });

  it("says so when the line is beyond the source text", () => {
    const inv = fixture("triad");
    inv.imports[0]!.line = 9;
    const { store } = openedStore(inv, { "src/a.ts": "only one line" });
    select(store, { kind: "relation", relationId: inv.imports[0]!.relationId });
    mount(store);
    fireEvent.click(screen.getByRole("button", { name: "line 9, column 1: ./b" }));
    expect(screen.getByText("Line 9 is not in the current source text.")).toBeTruthy();
  });
  it("reports Reason for a boundary and names it by its specifier", () => {
    const { store } = openedStore("boundary");
    select(store, {
      kind: "relation",
      relationId: store.getState().investigation!.imports.find((r) => r.specifier === "@/lib/format")!.relationId,
    });
    mount(store);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe('src/app.ts \u2192 "@/lib/format"');
    expect(screen.getByText("Resolution: unresolved")).toBeTruthy();
    expect(screen.getByText("Reason: alias-not-configured")).toBeTruthy();
  });

  it("states the preset that admits a relation (mixed-presets.json)", () => {
    const { store, inv } = openedStore("mixed-presets");
    const byKind = (syntax: string) => inv.imports.find((r) => r.syntaxKind === syntax)!.relationId;
    select(store, { kind: "relation", relationId: byKind("re-export") });
    const view = mount(store);
    expect(screen.getByText("Preset: type-inclusive only")).toBeTruthy();
    select(store, { kind: "relation", relationId: byKind("dynamic-literal") });
    view.rerender(<Inspector store={store} />);
    expect(screen.getByText("Preset: dynamic-inclusive only")).toBeTruthy();
    select(store, { kind: "relation", relationId: inv.imports.find((r) => r.dependencyKind === "mixed")!.relationId });
    expect(screen.getByText("Preset: in static-value")).toBeTruthy();
  });
});

describe("inspector text safety (6.6)", () => {
  it("shows an id and a specifier with markup characters verbatim and creates no element from them", () => {
    const { store, inv } = openedStore("escaped");
    const record = inv.imports[0]!;
    select(store, { kind: "module", id: "src/a&b.ts" });
    const view = mount(store);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("src/a&b.ts");
    expect(view.container.textContent).toContain('"./<img src=x onerror=alert(1)>"');
    select(store, { kind: "relation", relationId: record.relationId });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe('src/a&b.ts \u2192 "./<img src=x onerror=alert(1)>"');
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("excerpt (6.3)", () => {
  const text = "one\ntwo\nthree\nfour\nfive\nsix\nseven";
  it("returns two lines before and after, one-based", () => {
    expect(excerpt(text, 4)).toEqual([
      { line: 2, text: "two" },
      { line: 3, text: "three" },
      { line: 4, text: "four" },
      { line: 5, text: "five" },
      { line: 6, text: "six" },
    ]);
  });
  it("clips at the start and the end of the file", () => {
    expect(excerpt(text, 1).map((l) => l.line)).toEqual([1, 2, 3]);
    expect(excerpt(text, 7).map((l) => l.line)).toEqual([5, 6, 7]);
  });
  it("returns nothing for a line outside the file", () => {
    expect(excerpt(text, 0)).toEqual([]);
    expect(excerpt(text, 8)).toEqual([]);
  });
  it("splits on CRLF as well", () => {
    expect(excerpt("a\r\nb\r\nc", 2).map((l) => l.text)).toEqual(["a", "b", "c"]);
  });
});

describe("tooltipLines (5.2, 2.5)", () => {
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  it("describes a room with its language and parse status", () => {
    const inv = fixture("triad");
    expect(tooltipLines({ kind: "room", id: "src/b.ts", rect }, inv, analysisApi)).toEqual(["Module \u2014 room", "src/b.ts \u00B7 TypeScript \u00B7 parsed"]);
    inv.modules[0]!.parseStatus = "partial";
    inv.modules[1]!.parseStatus = "failed";
    expect(tooltipLines({ kind: "room", id: "src/a.ts", rect }, inv, analysisApi)[1]).toBe("src/a.ts \u00B7 TypeScript \u00B7 partially parsed");
    expect(tooltipLines({ kind: "room", id: "src/b.ts", rect }, inv, analysisApi)[1]).toBe("src/b.ts \u00B7 TypeScript \u00B7 parse failed");
  });

  it("describes a door with its kinds and the line of its first occurrence", () => {
    const inv = fixture("triad");
    const id = relationIdFor("src/a.ts", "src/b.ts", "import", "value");
    expect(tooltipLines({ kind: "door", id, rect }, inv, analysisApi)).toEqual([
      "Import or re-export \u2014 door and arrow",
      "src/a.ts imports src/b.ts \u00B7 import \u00B7 value \u00B7 line 1",
    ]);
  });

  it("describes a sealed doorway with its resolution and reason, and keeps markup characters as text", () => {
    const inv = fixture("escaped");
    expect(tooltipLines({ kind: "sealed", id: inv.imports[0]!.relationId, rect }, inv, analysisApi)).toEqual([
      "Unresolved or external import \u2014 sealed doorway with ?",
      'src/a&b.ts \u2192 "./<img src=x onerror=alert(1)>" \u00B7 unresolved \u00B7 absent-file',
    ]);
    const boundary = fixture("boundary");
    const zod = boundary.imports.find((r) => r.specifier === "zod")!;
    expect(tooltipLines({ kind: "sealed", id: zod.relationId, rect }, boundary, analysisApi)[1]).toBe('src/app.ts \u2192 "zod" \u00B7 external');
  });

  it("describes a wing with its module count", () => {
    expect(tooltipLines({ kind: "wing", id: "src/orders", rect }, fixture("two-wings"), analysisApi)).toEqual(["Folder \u2014 wing", "src/orders \u00B7 3 modules"]);
  });

  it("calls a room outside the route filter `Not in this traversal`", () => {
    const inv = fixture("triad");
    const filter = { kind: "focus" as const, modules: ["src/b.ts"], relationIds: [], label: "Focus: src/b.ts" };
    expect(tooltipLines({ kind: "room", id: "src/d.ts", rect }, inv, analysisApi, filter)[0]).toBe("Not in this traversal \u2014 subdued room");
    expect(tooltipLines({ kind: "room", id: "src/b.ts", rect }, inv, analysisApi, filter)[0]).toBe("Module \u2014 room");
  });
});