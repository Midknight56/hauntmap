/** Compares two strings by UTF-16 code unit order, never by locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalizes a path to forward slashes, relative to the root, with no leading `./`,
 * no leading slash and no empty or `.` segments. Letter case is kept.
 */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/** The directory segments of a normalized path, without the file name. */
export function directorySegments(path: string): string[] {
  const segments = path.split("/");
  segments.pop();
  return segments;
}

/** The file name of a normalized path. */
export function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** The extension of a normalized path including the dot, or "" when the file name has none after its first character. */
export function extensionOf(path: string): string {
  const name = fileName(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}

/** Matches a file name against a pattern in which `*` stands for any run of characters. */
export function matchesFilePattern(name: string, pattern: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(name);
}

/** Groups of two or more paths that differ only in letter case. Each group and the list are sorted. */
export function findCaseGroups(paths: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [path]);
    else if (!group.includes(path)) group.push(path);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort(compareStrings))
    .sort((a, b) => compareStrings(a[0] ?? "", b[0] ?? ""));
}