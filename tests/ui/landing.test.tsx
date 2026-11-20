import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANDING_SENTENCE, Landing } from "../../src/components/Landing";

afterEach(cleanup);

describe("landing (1.1, 1.2)", () => {
  it("shows the heading, the sentence and the four buttons in order, all enabled (gate I1 of intake)", () => {
    const { container } = render(<Landing onSample={() => undefined} intakeKinds={["local", "github"]} onIntake={() => undefined} />);
    expect(screen.getByRole("heading", { name: "HauntMap" })).toBeTruthy();
    expect(LANDING_SENTENCE).toBe(
      "Find how the modules of a JavaScript or TypeScript project import each other: rooms are files, doors are imports, and a corridor that returns to its start is a dependency cycle.",
    );
    expect(container.textContent).toContain(LANDING_SENTENCE);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Explore the manor", "Explore the annex", "Analyze a local folder", "Load a GitHub repository"]);
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(container.querySelector('[role="dialog"], [aria-modal]')).toBeNull();
  });

  it("shows only the two sample buttons when no intake kind is given (intake 10.1)", () => {
    const { rerender } = render(<Landing onSample={() => undefined} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Explore the manor", "Explore the annex"]);
    rerender(<Landing onSample={() => undefined} intakeKinds={[]} onIntake={() => undefined} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Explore the manor", "Explore the annex"]);
  });

  it("keeps Explore the manor the one primary button and puts the intake button after Explore the annex, inside .landing-actions", () => {
    const { container } = render(<Landing onSample={() => undefined} intakeKinds={["local"]} onIntake={() => undefined} />);
    const actions = container.querySelector(".landing-actions");
    const buttons = Array.from(actions?.querySelectorAll("button") ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(["Explore the manor", "Explore the annex", "Analyze a local folder"]);
    expect(buttons.map((b) => b.classList.contains("primary"))).toEqual([true, false, false]);
  });

  it("calls onIntake with the kind when Analyze a local folder is activated, and onSample is not called", () => {
    const onIntake = vi.fn();
    const onSample = vi.fn();
    render(<Landing onSample={onSample} intakeKinds={["local"]} onIntake={onIntake} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze a local folder" }));
    expect(onIntake.mock.calls).toEqual([["local"]]);
    expect(onSample).not.toHaveBeenCalled();
  });

  it("puts Load a GitHub repository after Analyze a local folder when kinds includes github, and not when it does not", () => {
    const { container, rerender } = render(<Landing onSample={() => undefined} intakeKinds={["local", "github"]} onIntake={() => undefined} />);
    const names = () => Array.from(container.querySelectorAll(".landing-actions button")).map((b) => b.textContent);
    expect(names()).toEqual(["Explore the manor", "Explore the annex", "Analyze a local folder", "Load a GitHub repository"]);
    expect(Array.from(container.querySelectorAll(".landing-actions button")).map((b) => b.classList.contains("primary"))).toEqual([true, false, false, false]);
    rerender(<Landing onSample={() => undefined} intakeKinds={["local"]} onIntake={() => undefined} />);
    expect(names()).toEqual(["Explore the manor", "Explore the annex", "Analyze a local folder"]);
  });

  it("calls onIntake with github when Load a GitHub repository is activated", () => {
    const onIntake = vi.fn();
    render(<Landing onSample={() => undefined} intakeKinds={["local", "github"]} onIntake={onIntake} />);
    fireEvent.click(screen.getByRole("button", { name: "Load a GitHub repository" }));
    expect(onIntake.mock.calls).toEqual([["github"]]);
  });

  it("calls onSample with the sample ID", () => {
    const onSample = vi.fn();
    render(<Landing onSample={onSample} />);
    fireEvent.click(screen.getByRole("button", { name: "Explore the manor" }));
    fireEvent.click(screen.getByRole("button", { name: "Explore the annex" }));
    expect(onSample.mock.calls).toEqual([["manor/before"], ["annex"]]);
  });
});