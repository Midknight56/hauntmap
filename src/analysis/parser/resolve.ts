import type { ImportRecord } from "../../contracts/types";

export type Resolution =
  | { resolution: "local"; to: string }
  | { resolution: "external"; to: null }
  | { resolution: "unresolved"; to: null; reason: "absent-file" | "alias-not-configured" | "ambiguous-candidate" };

export interface ModuleIndex {
  /** Module ids, matched case sensitively. */
  ids: ReadonlySet<string>;
  /** Module ids grouped by their lower case form, to find paths that differ only in case. */
  byLowerCase: ReadonlyMap<string, readonly string[]>;
}

export function buildModuleIndex(ids: readonly string[]): ModuleIndex {
  const byLowerCase = new Map<string, string[]>();
  for (const id of ids) {
    const key = id.toLowerCase();
    const group = byLowerCase.get(key);
    if (group === undefined) byLowerCase.set(key, [id]);
    else group.push(id);
  }
  return { ids: new Set(ids), byLowerCase };
}

const SUFFIXES = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx"];
const JS_TO_TS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".mjs": [".mts"] };

// An npm package name: an optional @scope/, then a name that starts with a letter or digit,
// then optional subpath segments. Names may use letters, digits and . _ ~ -.
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[^/\s]+)*$/;

// A Node built-in module specifier: the node: prefix, then a non empty name that may have subpath segments.
const NODE_BUILTIN = /^node:[A-Za-z0-9_/-]+$/;

// A remote URL specifier: lower case http:// or https://, a non empty host, then an optional path, query or hash; no whitespace.
const REMOTE_URL = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/;

export function isValidPackageName(specifier: string): boolean {
  return PACKAGE_NAME.test(specifier);
}

function isRelative(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

/** Joins a relative specifier to the directory of `from`. Returns null when the path leaves the root. */
function joinRelative(from: string, specifier: string): string | null {
  const segments = from.split("/");
  segments.pop();
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join("/");
}

type Step = { kind: "found"; id: string } | { kind: "ambiguous" } | { kind: "none" };

/** One candidate path, matched case sensitively; two or more paths that differ only in case are ambiguous. */
function tryCandidate(candidate: string, index: ModuleIndex): Step {
  const matches = index.byLowerCase.get(candidate.toLowerCase());
  if (matches === undefined) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return index.ids.has(candidate) ? { kind: "found", id: candidate } : { kind: "none" };
}

function candidatesFor(base: string): string[] {
  if (base === "") return [...INDEX_FILES];
  const candidates = [base];
  const extension = base.slice(base.lastIndexOf("."));
  const stem = base.slice(0, base.length - extension.length);
  const mapped = base.includes(".") ? JS_TO_TS[extension] : undefined;
  if (mapped !== undefined) for (const target of mapped) candidates.push(stem + target);
  for (const suffix of SUFFIXES) candidates.push(base + suffix);
  for (const file of INDEX_FILES) candidates.push(`${base}/${file}`);
  return candidates;
}

/**
 * Resolves one specifier of module `from` by the documented rules:
 * relative specifiers inside the root (exact file, the JS to TS fallback, the suffixes, the directory
 * index); `node:` followed by one or more of A-Z, a-z, 0-9, `_`, `/` or `-` is external (the name is
 * not checked against a list of Node modules, so `node:nothing` is external); a valid npm package name
 * is external; an `http://` or `https://` URL with a non empty host and no whitespace is external
 * (the text only is classified: the URL is never fetched, parsed or normalized); any other bare
 * specifier is an unconfigured alias, including a malformed `node:` form such as `node:`, `node: fs`
 * or `Node:fs`, `HTTPS://` in capitals, a URL with a missing or empty host or with whitespace, and
 * other schemes such as `file:`, `data:`, `jsr:` and `npm:`.
 * An absolute path or a path above the root is an absent file.
 */
export function resolveSpecifier(from: string, specifier: string, index: ModuleIndex): Resolution {
  if (isRelative(specifier)) {
    const base = joinRelative(from, specifier);
    if (base === null) return { resolution: "unresolved", to: null, reason: "absent-file" };
    for (const candidate of candidatesFor(base)) {
      const step = tryCandidate(candidate, index);
      if (step.kind === "found") return { resolution: "local", to: step.id };
      if (step.kind === "ambiguous") return { resolution: "unresolved", to: null, reason: "ambiguous-candidate" };
    }
    return { resolution: "unresolved", to: null, reason: "absent-file" };
  }
  if (specifier.startsWith("/")) return { resolution: "unresolved", to: null, reason: "absent-file" };
  if (NODE_BUILTIN.test(specifier)) return { resolution: "external", to: null };
  if (REMOTE_URL.test(specifier)) return { resolution: "external", to: null };
  if (isValidPackageName(specifier)) return { resolution: "external", to: null };
  return { resolution: "unresolved", to: null, reason: "alias-not-configured" };
}

/** The diagnostic message for an import that was not resolved. */
export function describeUnresolved(reason: NonNullable<ImportRecord["reason"]>, specifier: string): string {
  switch (reason) {
    case "absent-file":
      return `The import "${specifier}" points to a file that is not in the analyzed folder.`;
    case "alias-not-configured":
      return `The import "${specifier}" looks like a path alias. Path aliases are not configured, so it was not resolved.`;
    case "ambiguous-candidate":
      return `The import "${specifier}" matches two files whose paths differ only in letter case, so it was not resolved.`;
    case "nonliteral-dynamic":
      return `The dynamic import of ${specifier} does not use a string literal, so its target is unknown.`;
    case "unsupported-construct":
      return `The import "${specifier}" uses a construct that this analysis does not support.`;
  }
}