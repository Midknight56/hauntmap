import type { Dirent, Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { resolve } from "node:path";

// A file system over real temp directories that records every path it is asked about. Tests use
// it to assert that nothing is listed under node_modules, nothing is read outside the workspace
// and nothing is written by an analysis. It has the read methods of the loader's FsLike (task 3)
// and the write methods that the CLI uses (task 4c).

export class RecordingFs {
  /** Directories listed with readdir. */
  readonly readdirs: string[] = [];
  /** Files whose bytes were read. */
  readonly reads: string[] = [];
  /** stat and lstat calls. */
  readonly stats: string[] = [];
  /** realpath calls. */
  readonly realpaths: string[] = [];
  /** Files written, renamed to or removed. */
  readonly writes: string[] = [];

  async readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]> {
    this.readdirs.push(resolve(path));
    return nodeFs.readdir(path, options);
  }

  async stat(path: string): Promise<Stats> {
    this.stats.push(resolve(path));
    return nodeFs.stat(path);
  }

  async lstat(path: string): Promise<Stats> {
    this.stats.push(resolve(path));
    return nodeFs.lstat(path);
  }

  async realpath(path: string): Promise<string> {
    this.realpaths.push(resolve(path));
    return nodeFs.realpath(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.reads.push(resolve(path));
    return nodeFs.readFile(path);
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    this.writes.push(resolve(path));
    await nodeFs.writeFile(path, data);
  }

  async rename(from: string, to: string): Promise<void> {
    this.writes.push(resolve(to));
    await nodeFs.rename(from, to);
  }

  async rm(path: string): Promise<void> {
    this.writes.push(resolve(path));
    await nodeFs.rm(path, { force: true });
  }

  /** Every path listed, read, stat-ed or written, in no particular order. */
  touched(): string[] {
    return [...this.readdirs, ...this.reads, ...this.stats, ...this.writes];
  }
}
