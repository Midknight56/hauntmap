import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANDING_SENTENCE, Landing } from "../../src/components/Landing";

afterEach(cleanup);

describe("landing (1.1, 1.2)", () => {
  it("shows the heading, the sentence and the two buttons in order, all enabled", () => {
    const { container } = render(<Landing onSample={() => undefined} />);
    expect(screen.getByRole("heading", { name: "HauntMap" })).toBeTruthy();
    expect(LANDING_SENTENCE).toBe(
      "Find how the modules of a JavaScript or TypeScript project import each other: rooms are files, doors are imports, and a corridor that returns to its start is a dependency cycle.",
    );
    expect(container.textContent).toContain(LANDING_SENTENCE);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Explore the manor", "Explore the annex"]);
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(container.querySelector('[role="dialog"], [aria-modal]')).toBeNull();
  });

  it("calls onSample with the sample ID", () => {
    const onSample = vi.fn();
    render(<Landing onSample={onSample} />);
    fireEvent.click(screen.getByRole("button", { name: "Explore the manor" }));
    fireEvent.click(screen.getByRole("button", { name: "Explore the annex" }));
    expect(onSample.mock.calls).toEqual([["manor/before"], ["annex"]]);
  });
});