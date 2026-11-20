import { SUBFOLDER_REJECTED, URL_FORMAT } from "./messages";

// The address of a public repository (Requirement 7.2). Pure: a rejection makes no request.

export type ParsedUrl =
  | { ok: true; owner: string; repo: string; ref: string | null }
  | { ok: false; message: string; showRefField: boolean };

const PREFIX = "https://github.com/";
const PART = /^[A-Za-z0-9_.-]+$/;

/** A part made only of dots would turn into a path step (`..`) in the jsDelivr URLs, so it is not a name. */
const isName = (part: string): boolean => PART.test(part) && !/^\.+$/.test(part);

const formatError: ParsedUrl = { ok: false, message: URL_FORMAT, showRefField: false };
const subfolder = (showRefField: boolean): ParsedUrl => ({ ok: false, message: SUBFOLDER_REJECTED, showRefField });

/**
 * Accepts `https://github.com/{owner}/{repo}`, with an optional trailing `/` or `.git` and an optional `/tree/{ref}`.
 * A path after `/tree/{ref}` and a ref that contains `/` cannot be told apart, so both ask for the ref in its own field.
 */
export function parseGithubUrl(input: string): ParsedUrl {
  const text = input.trim();
  if (!text.startsWith(PREFIX)) return formatError;
  const segments = text.slice(PREFIX.length).split("/");
  if (segments.length > 2 && segments[segments.length - 1] === "") segments.pop();
  if (segments.some((segment) => segment === "")) return formatError;
  const [owner = "", repoPart = ""] = segments;
  if (!isName(owner) || !PART.test(repoPart)) return formatError;

  if (segments.length === 2) {
    const repo = repoPart.endsWith(".git") ? repoPart.slice(0, -4) : repoPart;
    return isName(repo) ? { ok: true, owner, repo, ref: null } : formatError;
  }
  if (!isName(repoPart)) return formatError;
  if (segments[2] !== "tree" || segments.length === 3) return subfolder(false);
  if (segments.length > 4) return subfolder(true);
  const ref = segments[3] ?? "";
  return isName(ref) ? { ok: true, owner, repo: repoPart, ref } : formatError;
}
