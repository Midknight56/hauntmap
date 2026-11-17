import type { ImportRecord, ModuleRecord, Preset } from "../../contracts/types";

// Small pure helpers that turn records into the words the interface shows. No rule of the analysis lives here.

const LANGUAGES: Record<ModuleRecord["language"], string> = { ts: "TypeScript", js: "JavaScript", jsx: "JSX", tsx: "TSX" };

export function languageLabel(language: ModuleRecord["language"]): string {
  return LANGUAGES[language];
}

/** The target of a relation as the lists show it: the module ID, or the specifier in quotes for a boundary. */
export function targetText(record: Pick<ImportRecord, "to" | "specifier">): string {
  return record.to ?? `"${record.specifier}"`;
}

/** `<from> imports <to>` for a local relation, `<from> → "<specifier>"` for a boundary. */
export function relationHeading(record: Pick<ImportRecord, "from" | "to" | "specifier">): string {
  return record.to === null ? `${record.from} \u2192 "${record.specifier}"` : `${record.from} imports ${record.to}`;
}

/** The `Preset:` line of the relation card from the first preset that admits the record. */
export function presetLine(membership: Preset): string {
  return membership === "static-value" ? "Preset: in static-value" : `Preset: ${membership} only`;
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Occurrences of a relation, first by line and then by column. */
export function occurrencesOf(imports: readonly ImportRecord[], relationId: string): ImportRecord[] {
  return imports.filter((r) => r.relationId === relationId).sort((a, b) => a.line - b.line || a.column - b.column);
}