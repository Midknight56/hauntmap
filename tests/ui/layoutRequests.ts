import type { Investigation, Preset } from "../../src/contracts/types";
import { analysisApi } from "../../src/features/investigation/analysisApi";
import { buildLayoutRequest } from "../../src/features/investigation/layoutRequest";
import { wingsOf } from "../../src/features/investigation/wings";
import type { LayoutRequest, LayoutResult, Rect } from "../../src/scene/layout/types";
import { layoutInvestigation } from "../../src/scene/layout/engine";

/** A layout request for an investigation with the given wings expanded (`"all"` expands every wing). */
export function requestFor(
  inv: Investigation,
  expanded: readonly string[] | "all" = [],
  preset: Preset = "static-value",
  brought: ReadonlyMap<string, string> = new Map(),
): LayoutRequest {
  const wings = expanded === "all" ? wingsOf(inv).map((w) => w.wing) : [...expanded];
  return buildLayoutRequest(inv, preset, wings, brought, analysisApi);
}

/** Lay out with a fixed clock so that two runs can be compared with deep equality. */
export function layoutOf(req: LayoutRequest): Promise<LayoutResult> {
  return layoutInvestigation(req, undefined, () => 0);
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function rankMap(result: LayoutResult): Record<string, number> {
  return Object.fromEntries(result.wings.map((w) => [w.wing, w.rank]));
}

export function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
