import { expect, test, type Page } from "@playwright/test";

// Design pass 3, item 9 and the landing half of item 10: a living manor behind the title (a ghost drifting past, windows that
// flicker, a candle glow), which stops under reduced motion, and which never takes the contrast of the words under 4.5:1.

const SELECTOR = ".landing-manor";

interface Moving {
  running: number;
  ghost: { x: number; y: number } | null;
  glow: string;
  windows: string[];
}

/** What moves on the landing page now, read from the page. The ghost and the windows are found by their classes. */
async function moving(page: Page): Promise<Moving> {
  return page.evaluate((root) => {
    const manor = document.querySelector(root);
    const ghost = manor?.querySelector(".manor-ghost")?.getBoundingClientRect();
    const glow = manor?.querySelector(".landing-candle");
    const windows = [...(manor?.querySelectorAll(".manor-window") ?? [])].map((w) => getComputedStyle(w).opacity);
    return {
      running: document.getAnimations().filter((a) => a.playState === "running").length,
      ghost: ghost === undefined ? null : { x: Math.round(ghost.x * 10) / 10, y: Math.round(ghost.y * 10) / 10 },
      glow: glow === null || glow === undefined ? "" : getComputedStyle(glow).opacity,
      windows,
    };
  }, SELECTOR);
}

test.describe("the living manor of the landing page", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("moves with motion allowed: the ghost drifts, the windows and the candle glow flicker", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page.locator(SELECTOR)).toHaveCount(1);
    const a = await moving(page);
    await page.waitForTimeout(1500);
    const b = await moving(page);
    expect(a.running, "animations run").toBeGreaterThan(3);
    expect(a.ghost, "the ghost is there").not.toBeNull();
    expect(b.ghost, "the ghost drifts").not.toEqual(a.ghost);
    expect(a.windows.length).toBeGreaterThan(3);
    expect(b.windows.join(), "the windows flicker").not.toEqual(a.windows.join());
    expect(b.glow, "the candle glow breathes").not.toEqual(a.glow);
  });

  test("keeps the words and the two buttons exactly as they were", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "HauntMap" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explore the manor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explore the annex" })).toBeVisible();
    expect(await page.locator(SELECTOR).textContent()).toBe("");
    expect(await page.locator(SELECTOR).getAttribute("aria-hidden")).toBe("true");
  });

  test("with prefers-reduced-motion nothing on the page moves", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(SELECTOR)).toHaveCount(1);
    const a = await moving(page);
    await page.waitForTimeout(1500);
    const b = await moving(page);
    expect(a.running).toBe(0);
    expect(b).toEqual(a);
    expect(a.ghost, "the ghost stands somewhere on the page").not.toBeNull();
  });

  test("with the Motion toggle on Reduce nothing on the page moves either", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => localStorage.setItem("hauntmap.prefs.v1", JSON.stringify({ version: 1, motion: "reduce", legendOpen: true, preset: "static-value" })));
    await page.goto("/");
    await expect(page.locator(SELECTOR)).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset["motion"])).toBe("reduce");
    const a = await moving(page);
    await page.waitForTimeout(1500);
    const b = await moving(page);
    expect(a.running).toBe(0);
    expect(b).toEqual(a);
  });

  test("the words stay at 4.5 to 1 or better over every frame of the effect", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page.locator(SELECTOR)).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // The ink of each text and the box it sits in, read before the text is made invisible.
    const targets = await page.evaluate(() => {
      const out: { name: string; color: string; box: { x: number; y: number; width: number; height: number } }[] = [];
      for (const [name, sel] of [["title", ".landing h1"], ["sentence", ".landing p"], ["primary", ".landing-actions button.primary"], ["secondary", ".landing-actions button:not(.primary)"]] as const) {
        const el = document.querySelector(sel) as HTMLElement;
        const r = el.getBoundingClientRect();
        // A button keeps its own border; the words lie inside it.
        const inset = el.tagName === "BUTTON" ? 6 : 0;
        out.push({ name, color: getComputedStyle(el).color, box: { x: r.x + inset, y: r.y + inset, width: r.width - 2 * inset, height: r.height - 2 * inset } });
      }
      return out;
    });
    await page.addStyleTag({ content: ".landing h1, .landing p, .landing-actions button { color: transparent !important; text-shadow: none !important; }" });
    const parse = (c: string): [number, number, number] => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c) as RegExpExecArray;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const lin = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (rgb: [number, number, number]): number => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    // Seek every animation to a time, for a sweep that covers the longest period (the ghost's drift) in steps.
    const worst = new Map<string, number>();
    for (let step = 0; step < 24; step++) {
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
      }, step * 2500 + step * 37);
      for (const target of targets) {
        const png = await page.screenshot({ clip: target.box });
        const luminance = await page.evaluate(
          async ([b64]) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext("2d") as CanvasRenderingContext2D;
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const lin2 = (v: number): number => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            };
            let max = 0;
            for (let i = 0; i < d.length; i += 4) max = Math.max(max, 0.2126 * lin2(d[i] as number) + 0.7152 * lin2(d[i + 1] as number) + 0.0722 * lin2(d[i + 2] as number));
            return max;
          },
          [png.toString("base64")] as const,
        );
        worst.set(target.name, Math.max(worst.get(target.name) ?? 0, luminance));
      }
    }
    for (const target of targets) {
      const ink = lum(parse(target.color));
      const bg = worst.get(target.name) as number;
      const ratio = (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05);
      expect(ratio, `${target.name}: ink ${target.color}, brightest background pixel ${bg.toFixed(4)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
