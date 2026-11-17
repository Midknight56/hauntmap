import type { AnalysisOptions, Investigation, SourceSet } from "../../contracts/types";
import type { AnalysisClient } from "../../workers/client";

// Where the newer snapshot comes from: the bundled `manor/after` sample, analyzed here, or an
// investigation handed over by code (the live snapshot). Nothing here writes to the screen.

export interface Snapshot {
  label: string;
  investigation: Investigation;
  sourceText: ReadonlyMap<string, string> | null;
}

export type AfterSource = { kind: "sample"; id: "manor/after" } | { kind: "investigation"; snapshot: Snapshot };

export type SampleLoader = (
  id: "manor/before" | "manor/after",
  base: string,
) => Promise<{ ok: true; sourceSet: SourceSet } | { ok: false; message: string }>;

export interface AcquireDeps {
  analysisClient: Pick<AnalysisClient, "analyze">;
  loadSample: SampleLoader;
  base: string;
}

export type AcquireResult = { ok: true; snapshot: Snapshot } | { ok: false; message: string; error?: unknown };

export const UNCHANGED = "The current investigation is unchanged.";

/** The first parenthesized text of a message, or `unknown error`. */
export function detailOf(message: string): string {
  const match = /\(([^()]*)\)/.exec(message);
  return match === null || match[1] === undefined || match[1] === "" ? "unknown error" : match[1];
}

/**
 * The newer snapshot. A sample is analyzed with the options of the earlier snapshot, never with the
 * toolbar preset, which is a view setting. `tail` ends every failure message.
 */
export async function acquireSnapshot(source: AfterSource, deps: AcquireDeps, options: AnalysisOptions, tail = UNCHANGED): Promise<AcquireResult> {
  if (source.kind === "investigation") return { ok: true, snapshot: source.snapshot };
  const loaded = await deps.loadSample(source.id, deps.base);
  if (!loaded.ok) return { ok: false, message: `The revised manor sample could not be loaded (${detailOf(loaded.message)}). ${tail}` };
  let investigation: Investigation;
  try {
    investigation = await deps.analysisClient.analyze({ files: loaded.sourceSet.files, rootLabel: loaded.sourceSet.rootLabel, options });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `The newer snapshot could not be analyzed (${message}). ${tail}`, error };
  }
  return {
    ok: true,
    snapshot: {
      label: loaded.sourceSet.rootLabel,
      investigation,
      sourceText: new Map(loaded.sourceSet.files.map((f) => [f.path, f.text] as const)),
    },
  };
}
