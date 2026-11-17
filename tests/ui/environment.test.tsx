import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("jsdom project", () => {
  it("renders a React element with React Testing Library", () => {
    render(<button type="button">Explore the manor</button>);
    expect(screen.getByRole("button", { name: "Explore the manor" })).toBeTruthy();
    expect(typeof document).toBe("object");
  });
});
