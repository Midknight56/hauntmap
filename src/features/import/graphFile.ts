import type { Investigation } from "../../contracts/types";
import type { ValidationResult } from "../../contracts/validate";
import { GRAPH_TOO_LARGE, graphInvalid, graphNotJson } from "./messages";

// Graph file import (Requirement 6): a bare investigation, as `pnpm hauntmap analyze <root> --out <file>` writes it.

const MAX_BYTES = 26_214_400;

export type GraphFileResult = { ok: true; investigation: Investigation; label: string } | { ok: false; message: string };

export async function readGraphFile(file: Blob, validate: (value: unknown) => ValidationResult, maxBytes: number = MAX_BYTES): Promise<GraphFileResult> {
  if (file.size > maxBytes) return { ok: false, message: GRAPH_TOO_LARGE };
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch (error) {
    return { ok: false, message: graphNotJson(error instanceof Error ? error.message : String(error)) };
  }
  const checked = validate(value);
  if (!checked.ok) return { ok: false, message: graphInvalid(checked.errors[0] ?? "unknown error") };
  const investigation = value as Investigation;
  return { ok: true, investigation, label: investigation.sourceLabel };
}
