import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inspector } from "../../src/components/Inspector";
import { Landing } from "../../src/components/Landing";
import { STEP_COPY } from "../../src/features/demo/steps";
import { relationIdFor } from "./ids";
import { openedStore } from "./storeHarness";

// The faults in words that three first-time testers found on 20 November 2026 (docs/acceptance/blind-test-fixes-2026-11-20.md).

afterEach(cleanup);

/** True when the text joins two words with a hyphen or a dash. */
const dashed = (text: string): boolean => /\p{L}[-\u2010-\u2015]\p{L}|\d-\p{L}/u.test(text);

describe("the words of the tour", () => {
  it("step 1 says what a door is", () => {
    expect(STEP_COPY.follow.instruction).toBe("Select src/orders/checkout.ts and open one of its doors. A door is one import from that file to another file.");
  });

  it("no step joins two words with a hyphen (step 2 said `the 3-module loop`)", () => {
    for (const { title, instruction } of Object.values(STEP_COPY)) {
      expect(dashed(title), title).toBe(false);
      // A module path is a name, not words: leave it out.
      expect(dashed(instruction.replace(/src\/\S+/g, "")), instruction).toBe(false);
    }
  });
});

describe("the landing page", () => {
  it("says under each button what it opens, and the button is described by it", () => {
    render(<Landing onSample={() => undefined} intakeKinds={["local", "github"]} onIntake={() => undefined} />);
    const expected: Record<string, string> = {
      "Explore the manor": "A small shop project with a guided tour: find its one import loop, then see the fix. Start here.",
      "Explore the annex": "A second sample with three separate loops and two imports HauntMap cannot follow. No tour.",
      "Analyze a local folder": "Choose a project folder on this computer. Its files are read in this browser and are not uploaded.",
      "Load a GitHub repository": "Enter the address of a public GitHub repository. Its name and file paths are sent to the jsDelivr CDN.",
    };
    for (const [name, words] of Object.entries(expected)) {
      const button = screen.getByRole("button", { name });
      const id = button.getAttribute("aria-describedby");
      expect(id, name).not.toBeNull();
      expect(document.getElementById(id as string)?.textContent, name).toBe(words);
    }
  });
});

describe("the relation card", () => {
  it("says in one plain sentence what the import is, before the technical lines", () => {
    const { store } = openedStore("triad");
    act(() => store.actions.select({ kind: "relation", relationId: relationIdFor("src/a.ts", "src/b.ts", "import", "value") }, { from: "dom" }));
    render(<Inspector store={store} />);
    expect(screen.getByText("src/a.ts uses code from src/b.ts, a file in this project. The import is written once in the source, listed under Occurrences.")).toBeTruthy();
    expect(screen.getByText("Resolution: local")).toBeTruthy();
  });

  it("names a boundary in plain words: a package from outside the project, or a file HauntMap could not find", () => {
    const { store, inv } = openedStore("boundary");
    const external = inv.imports.find((r) => r.resolution === "external");
    const unresolved = inv.imports.find((r) => r.resolution === "unresolved");
    expect(external).toBeDefined();
    expect(unresolved).toBeDefined();
    act(() => store.actions.select({ kind: "relation", relationId: (external as NonNullable<typeof external>).relationId }, { from: "dom" }));
    const view = render(<Inspector store={store} />);
    expect(view.container.textContent).toContain("a package from outside this project");
    act(() => store.actions.select({ kind: "relation", relationId: (unresolved as NonNullable<typeof unresolved>).relationId }, { from: "dom" }));
    expect(view.container.textContent).toContain("a file HauntMap could not find");
  });
});

describe("the evidence trail", () => {
  it("says what its steps are once a loop is chosen", () => {
    const { store } = openedStore("cycle");
    act(() => store.actions.openLoops());
    act(() => store.actions.chooseLoop(0));
    render(<Inspector store={store} />);
    expect(screen.getByText("Each step is one import on the path, in order. Choose a step to see it on the map.")).toBeTruthy();
  });
});
