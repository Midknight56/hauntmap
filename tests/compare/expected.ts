import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Investigation, RelationRef } from "../../src/contracts/types";
import { boundaryRelationIdFor, relationIdFor } from "./ids";
import { FIXTURES } from "./loadFolder";

export const FIXTURE_NAMES = [
  "comment-shift",
  "duplicate-occurrence",
  "rename",
  "cycle-closes",
  "boundary-change",
  "identical",
  "options-mismatch",
  "parse-failure",
  "escaped",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface ExpectedRef {
  from: string;
  to: string | null;
  specifier: string;
  syntaxKind: "import" | "re-export" | "dynamic-literal";
  dependencyKind: "value" | "type" | "mixed";
  resolution: "local" | "external" | "unresolved" | "unsupported";
}

export interface Expected {
  expectedVersion: 1;
  addedModules: string[];
  removedModules: string[];
  changedModules: string[];
  addedRelations: ExpectedRef[];
  removedRelations: ExpectedRef[];
  before: { moduleCount: number; relationCount: number };
  after: { moduleCount: number; relationCount: number };
  cyclicComponentsBefore: number;
  cyclicComponentsAfter: number;
  occurrenceCounts: Record<string, { before: number; after: number }>;
  relationChangesByModule: Record<string, { removed: number; added: number }>;
  optionsDiffer: string[];
  parseFailed: { id: string; side: "before" | "after" }[];
  identical: boolean;
}

export const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(FIXTURES, ...parts), "utf8")) as T;

/** The relation ID a hand-written expected relation must have: the plan's identity rule applied to its fields. */
export function relationIdOfExpected(r: ExpectedRef): string {
  return r.resolution === "local" && r.to !== null
    ? relationIdFor(r.from, r.to, r.syntaxKind, r.dependencyKind)
    : boundaryRelationIdFor(r.from, r.resolution as "external", r.specifier, r.syntaxKind, r.dependencyKind);
}

export function expectedRefs(list: ExpectedRef[]): RelationRef[] {
  return list.map((r) => ({ ...r, relationId: relationIdOfExpected(r) })).sort((a, b) => codeUnit(a.relationId, b.relationId));
}

export function loadFixture(name: string): { before: Investigation; after: Investigation; expected: Expected } {
  return {
    before: readJson<Investigation>(name, "before.json"),
    after: readJson<Investigation>(name, "after.json"),
    expected: readJson<Expected>(name, "expected.json"),
  };
}