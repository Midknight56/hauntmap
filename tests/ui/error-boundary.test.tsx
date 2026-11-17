import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

afterEach(cleanup);

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error("forced render error at D:/secret/path.ts");
  return <p>fine</p>;
}

describe("error boundary (12.4)", () => {
  it("shows the message and Reload view, logs only the error name and stack, and remounts on reload", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong drawing the map. Your investigation is still loaded.")).toBeTruthy();
    const reload = screen.getByRole("button", { name: "Reload view" });
    expect(document.activeElement).toBe(reload);
    // React reports a caught error itself in development; the app turns that off in main.tsx (onCaughtError),
    // so what the boundary writes is the part under test.
    const logged = spy.mock.calls.map((c) => c.map(String).join(" ")).filter((line) => line.startsWith("hauntmap:")).join("\n");
    expect(logged).toContain("hauntmap: Error");
    expect(logged).not.toContain("D:/secret/path.ts");
    shouldThrow = false;
    fireEvent.click(reload);
    expect(screen.getByText("fine")).toBeTruthy();
    spy.mockRestore();
  });
});