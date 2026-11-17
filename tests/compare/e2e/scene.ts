import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

// Hook access for the comparison specs: the compare store and `compareWith` that App.tsx installs (gate G2).

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function fixtureJson(name: string, side: "before" | "after"): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name, `${side}.json`), "utf8"));
}

export interface CompareView {
  status: string;
  shown: string;
  layoutPath: string | null;
  closingRelationIds: string[];
  removed: string[];
  added: string[];
}

export async function compareView(page: Page): Promise<CompareView> {
  return page.evaluate(() => {
    type S = { status: string; shown: string; layoutPath: string | null; closingRelationIds: string[]; result: { removedRelations: { relationId: string }[]; addedRelations: { relationId: string }[] } | null };
    const hook = (window as unknown as { __hauntmap?: { compareStore?: { getState(): S } } }).__hauntmap;
    const s = hook?.compareStore?.getState();
    if (s === undefined) throw new Error("compareStore is missing from window.__hauntmap");
    return {
      status: s.status,
      shown: s.shown,
      layoutPath: s.layoutPath,
      closingRelationIds: s.closingRelationIds,
      removed: s.result?.removedRelations.map((r) => r.relationId) ?? [],
      added: s.result?.addedRelations.map((r) => r.relationId) ?? [],
    };
  });
}

/** Call a compare store action through the hook. */
export async function compareAction(page: Page, name: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    async ([action, params]) => {
      const hook = (window as unknown as { __hauntmap?: { compareStore?: { actions: Record<string, (...a: unknown[]) => unknown> } } }).__hauntmap;
      const fn = hook?.compareStore?.actions[action as string];
      if (fn === undefined) throw new Error(`no compare action ${String(action)}`);
      await fn(...(params as unknown[]));
      return null;
    },
    [name, args] as const,
  );
}

/** `window.__hauntmap.compareWith(after, layoutKey?)`; resolves to the error message when it rejects. */
export async function hookCompareWith(page: Page, after: unknown): Promise<string | null> {
  return page.evaluate(async (inv) => {
    const hook = (window as unknown as { __hauntmap?: { compareWith(a: unknown): Promise<void> } }).__hauntmap;
    if (hook === undefined) throw new Error("window.__hauntmap is missing");
    try {
      await hook.compareWith(inv);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, after);
}

/** The newer snapshot of the active comparison, relabelled, as a hand-built live snapshot. */
export async function liveFromNewer(page: Page, label: string): Promise<unknown> {
  return page.evaluate((l) => {
    const hook = (window as unknown as { __hauntmap?: { compareStore?: { getState(): { after: { investigation: Record<string, unknown> } | null } } } }).__hauntmap;
    const after = hook?.compareStore?.getState().after;
    if (after === null || after === undefined) throw new Error("no newer snapshot");
    return { ...after.investigation, sourceLabel: l };
  }, label);
}

export async function camera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __hauntmap?: { store: { getState(): { camera: { x: number; y: number; zoom: number } } } } }).__hauntmap;
    if (hook === undefined) throw new Error("window.__hauntmap is missing");
    return hook.store.getState().camera;
  });
}

/** Sample `activeTweens` every `stepMs` for `totalMs`, starting now. */
export async function sampleTweens(page: Page, totalMs: number, stepMs: number): Promise<number[]> {
  return page.evaluate(
    ([total, step]) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const started = performance.now();
        const read = (): void => {
          const scene = (window as unknown as { __hauntmap?: { scene(): { debug(): { activeTweens: number } } | null } }).__hauntmap?.scene();
          out.push(scene?.debug().activeTweens ?? -1);
          // A busy main thread (a comparison being computed) delays a timer; keep taking samples until the count a quiet page gives in `totalMs` is reached, so a stall cannot shorten the run.
          if (performance.now() - started >= (total as number) && out.length >= Math.floor((total as number) / (step as number)) + 1) resolve(out);
          else setTimeout(read, step as number);
        };
        read();
      }),
    [totalMs, stepMs] as const,
  );
}
