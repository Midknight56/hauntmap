export type SyntaxKind = "import" | "re-export" | "dynamic-literal";
export type DependencyKind = "value" | "type" | "mixed";
export type Preset = "static-value" | "type-inclusive" | "dynamic-inclusive";

export interface SourceFile {
  path: string;
  text: string;
  bytes: number;
}

export interface SourceSet {
  rootLabel: string;
  files: SourceFile[];
  skipped: {
    path: string;
    reason: "excluded-dir" | "extension" | "oversized" | "secret-pattern" | "binary";
  }[];
}

export interface AnalysisOptions {
  preset: Preset;
  includeExtensions: string[]; // [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"]
  excludeDirectories: string[]; // [".git", "node_modules", "dist", "build", "out", ".next", "coverage"]
  excludeFilePatterns: string[]; // [".env", ".env.*", "*.pem", "*.key", "id_rsa*"]
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number; // 1000 local or 400 GitHub; 1 MiB; 25 MiB
  jsToTsFallback: true;
}

export interface ModuleRecord {
  id: string;
  sourceHash: string;
  language: "js" | "jsx" | "ts" | "tsx";
  parseStatus: "ok" | "partial" | "failed";
}

export interface ImportRecord {
  occurrenceId: string;
  relationId: string;
  from: string;
  to: string | null;
  specifier: string;
  syntaxKind: SyntaxKind;
  dependencyKind: DependencyKind;
  resolution: "local" | "external" | "unresolved" | "unsupported";
  line: number;
  column: number;
  reason?:
    | "absent-file"
    | "alias-not-configured"
    | "nonliteral-dynamic"
    | "unsupported-construct"
    | "ambiguous-candidate";
}

export interface Diagnostic {
  code:
    | "parse-failed"
    | "unresolved"
    | "unsupported"
    | "case-collision"
    | "duplicate-path"
    | "oversized"
    | "cap-reached";
  module?: string;
  line?: number;
  column?: number;
  specifier?: string;
  message: string;
}

export interface Investigation {
  schemaVersion: 1;
  resolverMode: "documented-source-subset";
  sourceLabel: string;
  modules: ModuleRecord[];
  imports: ImportRecord[];
  diagnostics: Diagnostic[];
  options: AnalysisOptions;
}

export interface TraceResult {
  origin: string;
  direction: "imports" | "imported-by";
  preset: Preset;
  visited: string[];
  direct: string[];
  indirect: string[];
  predecessor: Record<string, string>;
  distance: Record<string, number>;
}

export interface CyclicComponent {
  members: string[];
  witness: { modules: string[]; relationIds: string[] };
}

export interface CycleReport {
  preset: Preset;
  components: CyclicComponent[];
}

export interface RelationRef {
  relationId: string;
  from: string;
  to: string | null;
  specifier: string;
  syntaxKind: SyntaxKind;
  dependencyKind: DependencyKind;
  resolution: ImportRecord["resolution"];
}

export interface ComparisonResult {
  schemaVersion: 1;
  preset: "static-value";
  before: { label: string; moduleCount: number; relationCount: number };
  after: { label: string; moduleCount: number; relationCount: number };
  addedModules: string[];
  removedModules: string[];
  changedModules: string[];
  addedRelations: RelationRef[];
  removedRelations: RelationRef[];
  cyclicComponentsBefore: number;
  cyclicComponentsAfter: number;
}