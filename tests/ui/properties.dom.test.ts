import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceView } from "../../src/components/EvidenceView";
import { Inspector } from "../../src/components/Inspector";
import type { Investigation, Preset } from "../../src/contracts/types";
import { fixture } from "./fixtureFiles";
import { makeInvestigation } from "./generators";
import { occurrenceId, relationId } from "./ids";
import { openedStore } from "./storeHarness";

// Properties that need a DOM: P7 (task 9) and P12 (task 9). `HAUNTMAP_FAST` lowers the runs.
const RUNS = process.env["HAUNTMAP_FAST"] === undefined ? 200 : 50;
const PRESETS: Preset[] = ["static-value", "type-inclusive", "dynamic-inclusive"];

afterEach(cleanup);

/** Tags the interface may create; an element made from a string would add an `img`, `script` or similar. */
const ALLOWED = new Set(["DIV", "ASIDE", "H2", "H3", "P", "UL", "OL", "LI", "BUTTON", "SECTION", "SPAN", "PRE", "CODE"]);

const nasty = fc
  .array(fc.constantFrom("a", "b", "<", ">", "&", '"', "'", "img", " src=x ", "onerror=alert(1)", "/", "."), { minLength: 1, maxLength: 8 })
  .map((parts) => parts.join(""));

function withStrings(name: string, spec: string): Investigation {
  const inv = fixture("escaped");
  const id = `src/${name}.ts`;
  const record = inv.imports[0]!;
  inv.modules[0]!.id = id;
  record.from = id;
  record.specifier = spec;
  record.occurrenceId = occurrenceId(id, 1, 1, spec);
  record.relationId = relationId(id, ["unresolved", spec], "import", "value");
  inv.diagnostics[0]!.module = id;
  inv.diagnostics[0]!.specifier = spec;
  inv.diagnostics[0]!.message = `Cannot resolve "${spec}" from ${id}: absent-file.`;
  return inv;
}

describe("P7 text safety (5.3, 6.6)", () => {
  it("every surface shows any id or specifier verbatim and creates no element from it", () => {
    fc.assert(
      fc.property(nasty, nasty, (name, spec) => {
        const inv = withStrings(name, spec);
        const id = inv.modules[0]!.id;
        const { store } = openedStore(inv, { [id]: `import "${spec}";\n` });
        const surfaces: string[] = [];
        const check = (container: HTMLElement) => {
          for (const el of Array.from(container.querySelectorAll("*"))) expect(ALLOWED.has(el.tagName)).toBe(true);
          surfaces.push(container.textContent ?? "");
        };
        act(() => store.actions.select({ kind: "module", id }, { from: "dom" }));
        const inspector = render(createElement(Inspector, { store }));
        check(inspector.container);
        act(() => store.actions.select({ kind: "relation", relationId: inv.imports[0]!.relationId, occurrenceId: inv.imports[0]!.occurrenceId }, { from: "dom" }));
        check(inspector.container);
        const evidence = render(createElement(EvidenceView, { store }));
        check(evidence.container);
        const [moduleCard, relationCard, list] = surfaces as [string, string, string];
        expect(moduleCard).toContain(id);
        expect(relationCard).toContain(`"${spec}"`);
        expect(list).toContain(id);
        expect(list).toContain(`"${spec}"`);
        cleanup();
      }),
      { numRuns: RUNS },
    );
  });
});

const investigationArb: fc.Arbitrary<Investigation> = fc
  .record({
    wingCount: fc.integer({ min: 1, max: 5 }),
    modules: fc.integer({ min: 2, max: 40 }),
    relationsPerModule: fc.integer({ min: 0, max: 4 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })
  .map(({ wingCount, modules, relationsPerModule, seed }) => {
    const wings: Record<string, number> = {};
    for (let i = 0; i < wingCount; i++) wings[`src/w${i}`] = 0;
    for (let m = 0; m < modules; m++) wings[`src/w${m % wingCount}`] = (wings[`src/w${m % wingCount}`] ?? 0) + 1;
    return makeInvestigation({ wings, relationsPerModule: Math.min(relationsPerModule, modules - 1), seed, boundaryRatio: 0.1 });
  });

describe("P12 evidence completeness (6.5)", () => {
  it("the module and relation ids rendered equal those of the investigation, for every preset", () => {
    fc.assert(
      fc.property(investigationArb, (inv) => {
        const { store } = openedStore(inv);
        const expectedModules = [...inv.modules.map((m) => m.id)].sort();
        const expectedRelations = [...new Set(inv.imports.map((r) => r.relationId))].sort();
        for (const preset of PRESETS) {
          act(() => store.actions.setPreset(preset));
          const view = render(createElement(EvidenceView, { store }));
          const modules = Array.from(view.container.querySelectorAll("[data-module-id]")).map((el) => el.getAttribute("data-module-id")!);
          const relations = Array.from(view.container.querySelectorAll("[data-relation-id]")).map((el) => el.getAttribute("data-relation-id")!);
          expect([...modules].sort()).toEqual(expectedModules);
          expect([...relations].sort()).toEqual(expectedRelations);
          expect(view.container.textContent).toContain(`Modules (${inv.modules.length})`);
          expect(view.container.textContent).toContain(`Relations (${expectedRelations.length})`);
          cleanup();
        }
      }),
      { numRuns: RUNS },
    );
  }, 300_000);
});
