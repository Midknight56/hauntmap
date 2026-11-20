import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Investigation } from "../../src/contracts/types";

// public/demo/live.json is read only: it is the bare investigation that `pnpm hauntmap analyze` writes (6.1, 6.4).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function liveText(): string {
  return readFileSync(join(ROOT, "public", "demo", "live.json"), "utf8");
}

export function liveInvestigation(): Investigation {
  return JSON.parse(liveText()) as Investigation;
}

export function liveCounts(): { modules: number; relations: number } {
  const investigation = liveInvestigation();
  return { modules: investigation.modules.length, relations: new Set(investigation.imports.map((record) => record.relationId)).size };
}

export function graphFixture(name: "malformed.json" | "not-json.txt"): string {
  return readFileSync(join(ROOT, "tests", "intake", "fixtures", "graph", name), "utf8");
}
