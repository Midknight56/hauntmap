import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Folders that cannot live as source files (a binary, a 1 MiB file, .env, secret.pem, node_modules) are listed in a
// manifest and written to a temporary folder here. Nothing in tests/fixtures or public/demo is touched.

export interface ManifestEntry {
  path: string;
  /** UTF-8 text. */
  text?: string;
  /** Hex bytes written before `text`. */
  prefixHex?: string;
  /** One character repeated `size` times (ASCII). */
  fill?: string;
  size?: number;
}

export interface Manifest {
  folder: string;
  files: ManifestEntry[];
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function readManifest(name: "folder" | "folder-exec"): Manifest {
  return JSON.parse(readFileSync(join(FIXTURES, name, "manifest.json"), "utf8")) as Manifest;
}

export function entryBytes(entry: ManifestEntry): Uint8Array {
  if (entry.fill !== undefined) return new Uint8Array(Buffer.alloc(entry.size ?? 0, entry.fill));
  const prefix = entry.prefixHex === undefined ? new Uint8Array(0) : new Uint8Array(Buffer.from(entry.prefixHex, "hex"));
  const body = new TextEncoder().encode(entry.text ?? "");
  const out = new Uint8Array(prefix.byteLength + body.byteLength);
  out.set(prefix, 0);
  out.set(body, prefix.byteLength);
  return out;
}

/** Writes `manifest` to `<parent>/<folderName>/…` and returns that folder's path. */
export function writeManifest(manifest: Manifest, parent: string, folderName: string = manifest.folder): string {
  const root = join(parent, folderName);
  mkdirSync(root, { recursive: true });
  for (const entry of manifest.files) {
    const target = join(root, ...entry.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entryBytes(entry));
  }
  return root;
}

/** `File` objects for a manifest, as a folder input would give them: `webkitRelativePath` is `<folder>/<path>`. */
export function filesOfManifest(manifest: Manifest, folderName: string = manifest.folder): File[] {
  return manifest.files.map((entry) => {
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const file = new File([entryBytes(entry) as BlobPart], name);
    Object.defineProperty(file, "webkitRelativePath", { value: `${folderName}/${entry.path}`, configurable: true });
    return file;
  });
}
