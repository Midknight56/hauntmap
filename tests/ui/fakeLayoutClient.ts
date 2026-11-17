import type { LayoutClient } from "../../src/features/investigation/layoutClient";
import type { LayoutRequest, LayoutResult } from "../../src/scene/layout/types";

export function makeLayoutResult(layoutKey: string): LayoutResult {
  return {
    layoutVersion: 1,
    layoutKey,
    engine: { name: "dagre", version: "test" },
    wings: [],
    rooms: [],
    grouped: [],
    doors: [],
    sealed: [],
    corridors: [],
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    stats: { ms: 0, nodeCount: 0, edgeCount: 0 },
  };
}

export interface PendingLayout {
  payload: LayoutRequest;
  revision: number;
  resolve(result: LayoutResult): void;
  reject(error: Error): void;
}

export interface FakeLayoutClient extends LayoutClient {
  requests: PendingLayout[];
  cancelCount: number;
}

/** A layout client whose requests stay pending until the test settles them, in any order. */
export function createFakeLayoutClient(): FakeLayoutClient {
  const fake: FakeLayoutClient = {
    requests: [],
    cancelCount: 0,
    lastResult: null,
    request(payload, revision) {
      return new Promise<LayoutResult>((resolve, reject) => {
        fake.requests.push({ payload, revision, resolve, reject });
      });
    },
    cancel() {
      fake.cancelCount++;
    },
  };
  return fake;
}

/** Let promise continuations run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
