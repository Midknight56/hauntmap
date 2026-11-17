import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Investigation } from "../../src/contracts/types";

const HERE = dirname(fileURLToPath(import.meta.url));

export type FixtureName = "triad" | "escaped" | "boundary" | "cycle" | "two-wings" | "mixed-presets" | "long-name";

/** A fresh copy of `tests/ui/fixtures/<name>.json`. */
export function fixture(name: FixtureName): Investigation {
  return JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.json`), "utf8")) as Investigation;
}
