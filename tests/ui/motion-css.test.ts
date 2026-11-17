import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { easeNextCamera, takeCameraEase } from "../../src/components/cameraEase";

const css = readFileSync("src/styles/app.css", "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `a rule for ${selector}`).not.toBeNull();
  return (match as RegExpExecArray)[1] as string;
}

describe("panels slide in 200 ms, the inspector fades in 150 ms (design pass 3, item 7)", () => {
  it("the loops, who imports, steps, compare, comparison and legend panels slide in over 200 ms", () => {
    const block = /((?:\.[a-z-]+,\s*)+\.legend)\s*\{\s*animation:\s*panel-slide 200ms/.exec(css);
    expect(block, "one rule for the panels").not.toBeNull();
    for (const name of [".loops-panel", ".who-panel", ".steps-panel", ".compare-panel", ".comparison-dock", ".legend"]) expect(block?.[1]).toContain(name);
    expect(css).toMatch(/@keyframes panel-slide\s*\{\s*from\s*\{[^}]*translateY/);
  });

  it("the phone More menu and the evidence sheet slide in over 200 ms", () => {
    const phone = css.slice(css.lastIndexOf("@media (max-width: 720px)"));
    expect(phone).toMatch(/\.toolbar-more\s*\{\s*animation:\s*panel-slide 200ms/);
    expect(phone).toMatch(/\.inspector\[data-fade="a"\]\s*\{\s*animation:\s*panel-slide 200ms ease-out,\s*inspector-fade-a 150ms/);
  });

  it("the inspector fades in over 150 ms", () => {
    expect(rule('.inspector[data-fade="a"]')).toMatch(/inspector-fade-a 150ms/);
    expect(rule('.inspector[data-fade="b"]')).toMatch(/inspector-fade-b 150ms/);
  });
});

describe("reduced motion beats every animation of the page", () => {
  it("the reduced-motion blocks use !important, so that no class rule keeps a slide or a flicker alive", () => {
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n)\}/.exec(css);
    expect(media?.[1]).toMatch(/animation:\s*none !important/);
    expect(media?.[1]).toMatch(/transition:\s*none !important/);
    const toggle = /\[data-motion="reduce"\][^{]*\{([^}]*)\}/.exec(css);
    expect(toggle?.[1]).toMatch(/animation:\s*none !important/);
    expect(toggle?.[1]).toMatch(/transition:\s*none !important/);
  });
});

describe("only zoom and fit ease the camera", () => {
  it("a mark is read once and only while fresh", () => {
    expect(takeCameraEase(1000)).toBe(false);
    easeNextCamera(1000);
    expect(takeCameraEase(1100)).toBe(true);
    expect(takeCameraEase(1100)).toBe(false);
    easeNextCamera(1000);
    expect(takeCameraEase(1400)).toBe(false);
  });
});
