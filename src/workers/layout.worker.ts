import type { LayoutReply, LayoutRequestMessage } from "../features/investigation/layoutClient";
import { layoutInvestigation } from "../scene/layout/engine";
import type { LayoutRequest } from "../scene/layout/types";

const PRESETS = ["static-value", "type-inclusive", "dynamic-inclusive"];

function isStringField(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[key] === "string";
}

/** The reason a payload is not a layout request, or null when it is one. */
function problemWith(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return "The layout request is not an object.";
  const p = payload as Partial<Record<keyof LayoutRequest, unknown>>;
  if (p.layoutVersion !== 1) return "The layout request has an unsupported layoutVersion.";
  if (p.engine !== "dagre") return `The layout engine "${String(p.engine)}" is not available.`;
  if (!Array.isArray(p.modules) || !p.modules.every((m) => isStringField(m, "id") && isStringField(m, "wing"))) {
    return "The layout request has no valid modules list.";
  }
  if (!Array.isArray(p.relations) || !p.relations.every((r) => isStringField(r, "relationId") && isStringField(r, "from") && isStringField(r, "to"))) {
    return "The layout request has no valid relations list.";
  }
  if (!Array.isArray(p.boundaries) || !p.boundaries.every((b) => isStringField(b, "relationId") && isStringField(b, "from"))) {
    return "The layout request has no valid boundaries list.";
  }
  if (
    !Array.isArray(p.expandedWings) ||
    !p.expandedWings.every(
      (w) =>
        isStringField(w, "wing") &&
        Array.isArray((w as { shownIds?: unknown }).shownIds) &&
        typeof (w as { hiddenCount?: unknown }).hiddenCount === "number",
    )
  ) {
    return "The layout request has no valid expandedWings list.";
  }
  if (typeof p.preset !== "string" || !PRESETS.includes(p.preset)) return "The layout request has an unknown preset.";
  const room = p.room as { w?: unknown; h?: unknown } | undefined;
  if (room?.w !== 96 || room?.h !== 64) return "The layout request has an unsupported room size.";
  return null;
}

/**
 * Runs one request and posts every reply through `post`. It never throws: any problem becomes an
 * `error` reply, so the client can keep its last good layout. Each reply echoes the `requestId`
 * and the `revision` of the request.
 */
export async function runLayoutRequest(request: LayoutRequestMessage, post: (reply: LayoutReply) => void): Promise<void> {
  const requestId = typeof request?.requestId === "string" ? request.requestId : "";
  const revision = typeof request?.revision === "number" ? request.revision : 0;
  try {
    if (typeof request !== "object" || request === null) {
      post({ requestId, revision, kind: "error", message: "The layout message is not an object." });
      return;
    }
    if (request.kind !== "layout") {
      post({ requestId, revision, kind: "error", message: `Unknown request kind: ${String(request.kind)}` });
      return;
    }
    const problem = problemWith(request.payload);
    if (problem !== null) {
      post({ requestId, revision, kind: "error", message: problem });
      return;
    }
    const result = await layoutInvestigation(request.payload as LayoutRequest);
    post({ requestId, revision, kind: "result", result });
  } catch (error) {
    post({ requestId, revision, kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

// Register the entry only inside a real worker; importing this file in Node or in a test does nothing.
interface WorkerScope {
  onmessage: ((event: { data: LayoutRequestMessage }) => void) | null;
  postMessage(reply: LayoutReply): void;
}

if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event) => {
    void runLayoutRequest(event.data, (reply) => scope.postMessage(reply));
  };
}
