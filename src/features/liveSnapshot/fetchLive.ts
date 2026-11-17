import type { Investigation } from "../../contracts/types";
import type { ValidationResult } from "../../contracts/validate";
import { LIVE_PATH } from "./messages";

export type LiveFetch =
  | { kind: "missing" }
  | { kind: "fetch-failed"; reason: string }
  | { kind: "malformed"; firstError: string }
  | { kind: "valid"; investigation: Investigation };

function nameOf(thrown: unknown): string {
  return thrown instanceof Error && thrown.name !== "" ? thrown.name : "network error";
}

/**
 * GET `<base>demo/live.json?t=<now>` with no cache and no credentials and classify the answer:
 * 404, or a 200 whose body is not JSON and whose content type is not JSON (a hosting fallback page),
 * is `missing`; a rejection or another status is `fetch-failed`; unparsable JSON that looks like JSON
 * or a validator error is `malformed`.
 */
export async function fetchLive(
  base: string,
  fetchImpl: typeof fetch,
  now: () => number,
  validate: (value: unknown) => ValidationResult,
): Promise<LiveFetch> {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(`${prefix}${LIVE_PATH}?t=${now()}`, { cache: "no-store", credentials: "omit" });
    if (response.status === 404) return { kind: "missing" };
    if (response.status !== 200) return { kind: "fetch-failed", reason: String(response.status) };
    text = await response.text();
  } catch (thrown) {
    return { kind: "fetch-failed", reason: nameOf(thrown) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (thrown) {
    const jsonType = (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
    if (!jsonType && !text.trimStart().startsWith("{")) return { kind: "missing" };
    return { kind: "malformed", firstError: `file is not JSON (${thrown instanceof Error ? thrown.message : "parse error"})` };
  }
  const outcome = validate(parsed);
  if (!outcome.ok) return { kind: "malformed", firstError: outcome.errors[0] ?? "unknown error" };
  return { kind: "valid", investigation: parsed as Investigation };
}