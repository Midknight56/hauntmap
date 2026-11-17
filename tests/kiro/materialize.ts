import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Writes a manifest of files into a directory. Directory links are junctions on Windows (no
// administrator right needed) and symbolic links elsewhere.

export type ManifestEntry = string | { base64: string } | { bytes: number; fill: string };
export interface TreeManifest {
  files: Record<string, ManifestEntry>;
}
export interface LoaderRootManifest extends TreeManifest {
  /** Written by hand from the files above, never produced by the analyzer. */
  expected: { files: string[]; skipped: Record<string, "excluded-dir" | "extension" | "oversized" | "secret-pattern" | "binary"> };
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "fixtures");
export const LIVE_FIXTURES = join(FIXTURES, "live");

export function loadLoaderRoot(): LoaderRootManifest {
  return JSON.parse(readFileSync(join(FIXTURES, "loader-root.json"), "utf8")) as LoaderRootManifest;
}

export function entryBytes(entry: ManifestEntry): Buffer {
  if (typeof entry === "string") return Buffer.from(entry, "utf8");
  if ("base64" in entry) return Buffer.from(entry.base64, "base64");
  return Buffer.alloc(entry.bytes, entry.fill);
}

/** Creates every file of the manifest under `dir`, in `order` (default: manifest order). */
export function materialize(manifest: TreeManifest, dir: string, order: string[] = Object.keys(manifest.files)): void {
  for (const path of order) {
    const entry = manifest.files[path];
    if (entry === undefined) throw new Error(`materialize: ${path} is not in the manifest`);
    const target = join(dir, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entryBytes(entry));
  }
}

/** A directory link at `path` pointing to `target`: a junction on Windows, a symbolic link elsewhere. */
export function symlinkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}
