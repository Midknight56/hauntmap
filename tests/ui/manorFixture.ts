import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ANALYSIS_OPTIONS, analyze } from "../../src/analysis";
import type { Investigation } from "../../src/contracts/types";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The bundled manor, analyzed by the real analysis (the files are the `manor/before` sources). */
export async function manorInvestigation(): Promise<Investigation> {
  const body = JSON.parse(readFileSync(join(REPO, "public", "demo", "manor", "before", "sources.json"), "utf8")) as {
    files: { path: string; text: string }[];
  };
  const files = body.files.map((f) => ({ ...f, bytes: Buffer.byteLength(f.text) }));
  return analyze(
    { rootLabel: "manor/before", files, skipped: [] },
    DEFAULT_ANALYSIS_OPTIONS,
    async (text) => createHash("sha256").update(text, "utf8").digest("hex"),
  );
}
