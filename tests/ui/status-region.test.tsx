import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { StatusRegion } from "../../src/components/StatusRegion";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { createPrefsStore } from "../../src/features/investigation/prefs";
import { createInvestigationStore } from "../../src/features/investigation/store";
import { createFakeLayoutClient } from "./fakeLayoutClient";

afterEach(cleanup);

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const newStore = () => createInvestigationStore({ analysisApi, layoutClient: createFakeLayoutClient(), prefs: createPrefsStore(null) });

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(tsx?|css|html)$/.test(name) ? [path] : [];
  });
}

describe("status region (10.2, 10.3)", () => {
  it("is one role=status element that shows the latest message and replaces the previous one", () => {
    const store = newStore();
    const { container } = render(<StatusRegion store={store} />);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    act(() => store.actions.setStatus("first"));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("first");
    act(() => store.actions.setStatus("second"));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("second");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("renders a backtick segment in <code> and the live-snapshot message verbatim", () => {
    const store = newStore();
    const { container } = render(<StatusRegion store={store} />);
    act(() =>
      store.actions.setStatus(
        "No live snapshot yet. Run `pnpm hauntmap analyze samples/manor --out public/demo/live.json`, or let the Kiro hook write it.",
      ),
    );
    const region = container.querySelector('[role="status"]')!;
    expect(region.textContent).toBe(
      "No live snapshot yet. Run pnpm hauntmap analyze samples/manor --out public/demo/live.json, or let the Kiro hook write it.",
    );
    expect(region.querySelectorAll("code")).toHaveLength(1);
    expect(region.querySelector("code")?.textContent).toBe("pnpm hauntmap analyze samples/manor --out public/demo/live.json");
  });

  it("renders markup in a message as text, never as elements", () => {
    const store = newStore();
    const { container } = render(<StatusRegion store={store} />);
    act(() => store.actions.setStatus('No module matches "<img src=x onerror=alert(1)>".'));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe('No module matches "<img src=x onerror=alert(1)>".');
  });

  it("is the only element in src with aria-live or role=status", () => {
    const offenders = sources(SRC)
      .filter((file) => !file.endsWith("StatusRegion.tsx"))
      .filter((file) => /aria-live|role=["'{ ]*["']?status/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});