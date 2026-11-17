import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComparisonDock } from "../../src/features/compare/ComparisonDock";
import { place } from "../../src/features/compare/placement";
import { registerCompare } from "../../src/features/compare/register";
import { createCompareStore } from "../../src/features/compare/store";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createRegistry } from "../../src/features/investigation/registry";
import { nodeSha256 } from "./loadFolder";
import { createHarness, openManorBefore } from "./storeHarness";

afterEach(cleanup);

const READY = "Comparison ready: 1 removed, 1 added, 2 changed modules; loops 1 \u2192 0. Showing the newer snapshot.";

async function active() {
  const h = createHarness();
  await openManorBefore(h);
  const cs = createCompareStore({ store: h.store, analysisApi, analysisClient: h.analysisClient, loadSample: h.loadSample, base: h.base, place, sha256Hex: nodeSha256 });
  registerCompare(createRegistry(), cs);
  return { h, cs };
}

describe("the dock block of a comparison (design 4e and 4f)", () => {
  it("renders nothing while no comparison is active", async () => {
    const { cs } = await active();
    const { container } = render(<ComparisonDock />);
    expect(cs.getState().status).toBe("idle");
    expect(container.textContent).toBe("");
  });

  it("is headed Compare revisions and holds the comparison sentence in one element with the counts in bold", async () => {
    const { cs } = await active();
    render(<ComparisonDock />);
    await act(async () => {
      await cs.actions.compareWithSample();
    });
    expect(screen.getByRole("heading", { name: "Compare revisions" })).toBeTruthy();
    // The popover panel is the region named `Compare revisions`; the dock block must not take the same name.
    expect(screen.getByRole("region", { name: "Comparison summary" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Compare revisions" })).toBeNull();
    const sentence = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === READY);
    expect(sentence.className).toContain("comparison-sentence");
    expect([...sentence.querySelectorAll("strong")].map((s) => s.textContent)).toEqual(["1 removed", "1 added", "2 changed", "1 \u2192 0"]);
    expect([...sentence.querySelectorAll("strong")].map((s) => s.className)).toEqual(["count-removed", "count-added", "count-changed", "count-loops"]);
  });

  it("says which snapshot is shown when the reader toggles it", async () => {
    const { cs } = await active();
    render(<ComparisonDock />);
    await act(async () => {
      await cs.actions.compareWithSample();
    });
    act(() => cs.actions.show("before"));
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === READY.replace("newer", "earlier"))).toBeTruthy();
  });
});