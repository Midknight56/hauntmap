import type { SourceFile } from "../../contracts/types";
import type { Candidate } from "../import/review";

// The jsDelivr half of the GitHub route (Requirements 7.3, 7.4, 7.6, 8.1, 8.3, 8.4, 8.8). Endpoint forms and field names were
// observed on this PC on 2026-11-19 (docs/limitations.md, ## Intake). Every request is a plain GET with
// `credentials: "omit"`, the abort signal and no other option, so no cookie or header leaves the browser.

export const resolveUrl = (owner: string, repo: string) => `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}/resolved`;
// A ref typed in the Branch or tag field may hold characters (a slash) that are not a path step, so it is encoded as one segment.
// A ref from the address or from jsDelivr is made of letters, digits, dots, hyphens and underscores, which encoding leaves as they are.
export const listingUrl = (owner: string, repo: string, ref: string) => `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${encodeURIComponent(ref)}?structure=flat`;
export const fileUrl = (owner: string, repo: string, ref: string, path: string) =>
  `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;

export interface ListingEntry {
  path: string;
  size: number;
}

export type Failure = { ok: false; status: string };

const errorName = (error: unknown): string => {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && name !== "" ? name : "Error";
};

async function getJson(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<{ ok: true; value: unknown } | Failure> {
  try {
    const response = await fetchImpl(url, { credentials: "omit", signal });
    if (response.status !== 200) return { ok: false, status: String(response.status) };
    return { ok: true, value: (await response.json()) as unknown };
  } catch (error) {
    return { ok: false, status: errorName(error) };
  }
}

const INVALID: Failure = { ok: false, status: "InvalidResponse" };

/** Which version jsDelivr resolves for the repository: the newest tag, or `null` when the repository has none. */
export async function resolveVersion(owner: string, repo: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<{ ok: true; version: string | null } | Failure> {
  const got = await getJson(resolveUrl(owner, repo), fetchImpl, signal);
  if (!got.ok) return got;
  const version = (got.value as { version?: unknown } | null)?.version;
  if (version === null) return { ok: true, version: null };
  return typeof version === "string" && version !== "" ? { ok: true, version } : INVALID;
}

/** The flat listing of one version: `files[].name` (with a leading `/`) and `files[].size`. */
export async function listRepository(owner: string, repo: string, ref: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<{ ok: true; entries: ListingEntry[] } | Failure> {
  const got = await getJson(listingUrl(owner, repo, ref), fetchImpl, signal);
  if (!got.ok) return got;
  const files = (got.value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return INVALID;
  const entries: ListingEntry[] = [];
  for (const file of files as unknown[]) {
    const name = (file as { name?: unknown } | null)?.name;
    const size = (file as { size?: unknown } | null)?.size;
    if (typeof name !== "string" || typeof size !== "number" || !Number.isInteger(size) || size < 0) return INVALID;
    entries.push({ path: name.startsWith("/") ? name.slice(1) : name, size });
  }
  return { ok: true, entries };
}

const NUL_SCAN_LENGTH = 8192;
const abortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError");

export type FetchResult = { ok: true; files: SourceFile[]; binary: string[] } | { ok: false; path: string; status: string };

/**
 * Fetches the included files with at most `concurrency` requests in flight, in path order, under the caller's signal.
 * A status other than 200, or a rejection other than the abort, returns `{ ok: false, path, status }` at once and
 * starts no further file; the caller aborts the controller to stop the ones in flight. An abort rejects with `AbortError`.
 * A body with a NUL in its first 8,192 characters is listed in `binary`; `bytes` is the body's byte length.
 */
export function fetchFiles(
  owner: string,
  repo: string,
  ref: string,
  included: Candidate[],
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  concurrency = 6,
): Promise<FetchResult> {
  const total = included.length;
  const files: SourceFile[] = [];
  const binary: string[] = [];
  return new Promise<FetchResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let next = 0;
    let active = 0;
    let done = 0;
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    function onAbort(): void {
      finish(() => reject(abortError()));
    }
    signal.addEventListener("abort", onAbort);

    const one = async (entry: Candidate): Promise<void> => {
      try {
        const response = await fetchImpl(fileUrl(owner, repo, ref, entry.path), { credentials: "omit", signal });
        if (response.status !== 200) {
          finish(() => resolve({ ok: false, path: entry.path, status: String(response.status) }));
          return;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const text = new TextDecoder("utf-8").decode(bytes);
        if (text.slice(0, NUL_SCAN_LENGTH).includes("\u0000")) binary.push(entry.path);
        else files.push({ path: entry.path, text, bytes: bytes.byteLength });
      } catch (error) {
        if (!signal.aborted) finish(() => resolve({ ok: false, path: entry.path, status: errorName(error) }));
        return;
      }
      if (settled) return;
      done += 1;
      onProgress(done, total);
    };

    const launch = (): void => {
      while (!settled && active < concurrency && next < total) {
        const entry = included[next] as Candidate;
        next += 1;
        active += 1;
        void one(entry).then(() => {
          active -= 1;
          launch();
        });
      }
      if (!settled && active === 0 && next >= total) {
        finish(() => resolve({ ok: true, files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), binary: binary.sort() }));
      }
    };
    launch();
  });
}