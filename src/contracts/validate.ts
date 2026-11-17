// Validators of the two JSON documents that leave the analysis: an Investigation (the `analyze`
// output, `public/demo/live.json`) and a ComparisonResult. Plain TypeScript, no schema library, no DOM
// or worker globals, so that the app, the CLI and the MCP server share this one file. Every check
// collects its errors in document order; the first one is the message shown to users.

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const LANGUAGES = ["js", "jsx", "ts", "tsx"];
const PARSE_STATUSES = ["ok", "partial", "failed"];
const SYNTAX_KINDS = ["import", "re-export", "dynamic-literal"];
const DEPENDENCY_KINDS = ["value", "type", "mixed"];
const RESOLUTIONS = ["local", "external", "unresolved", "unsupported"];
const REASONS = ["absent-file", "alias-not-configured", "nonliteral-dynamic", "unsupported-construct", "ambiguous-candidate"];
const PRESETS = ["static-value", "type-inclusive", "dynamic-inclusive"];
const SHA256_HEX = /^[0-9a-f]{64}$/;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function found(object: Obj, key: string): string {
  return key in object && object[key] !== undefined ? (JSON.stringify(object[key]) ?? "missing") : "missing";
}
function oneOf(list: string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}
function listOf(list: string[]): string {
  return list.map((item) => `"${item}"`).join(", ");
}
function result(errors: string[]): ValidationResult {
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function checkModules(modules: unknown[], errors: string[]): Set<string> {
  const ids = new Set<string>();
  const firstIndex = new Map<string, number>();
  modules.forEach((entry, i) => {
    const at = `modules[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof entry.id !== "string") errors.push(`${at}.id must be a string`);
    else if (firstIndex.has(entry.id)) errors.push(`${at}.id duplicates modules[${String(firstIndex.get(entry.id))}].id`);
    else {
      firstIndex.set(entry.id, i);
      ids.add(entry.id);
    }
    if (typeof entry.sourceHash !== "string" || !SHA256_HEX.test(entry.sourceHash)) errors.push(`${at}.sourceHash must be 64 lowercase hexadecimal characters`);
    if (!oneOf(LANGUAGES, entry.language)) errors.push(`${at}.language must be one of ${listOf(LANGUAGES)}`);
    if (!oneOf(PARSE_STATUSES, entry.parseStatus)) errors.push(`${at}.parseStatus must be one of ${listOf(PARSE_STATUSES)}`);
    if ("text" in entry) errors.push(`${at} must not carry source text`);
  });
  return ids;
}

function idParts(value: unknown): unknown[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 4 ? parsed : null;
  } catch {
    return null;
  }
}

function checkImports(imports: unknown[], moduleIds: Set<string>, errors: string[]): void {
  imports.forEach((entry, i) => {
    const at = `imports[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const fromOk = typeof entry.from === "string" && moduleIds.has(entry.from);
    if (!fromOk) errors.push(`${at}.from must be a module ID of this investigation`);
    if (entry.to !== null && !(typeof entry.to === "string" && moduleIds.has(entry.to))) errors.push(`${at}.to must be null or a module ID of this investigation`);
    for (const field of ["occurrenceId", "relationId"] as const) {
      const parts = idParts(entry[field]);
      if (parts === null || (typeof entry.from === "string" && parts[0] !== entry.from)) {
        errors.push(`${at}.${field} must be a JSON array of 4 elements whose first element is from`);
      }
    }
    if (typeof entry.specifier !== "string") errors.push(`${at}.specifier must be a string`);
    if (!oneOf(SYNTAX_KINDS, entry.syntaxKind)) errors.push(`${at}.syntaxKind must be one of ${listOf(SYNTAX_KINDS)}`);
    if (!oneOf(DEPENDENCY_KINDS, entry.dependencyKind)) errors.push(`${at}.dependencyKind must be one of ${listOf(DEPENDENCY_KINDS)}`);
    if (!oneOf(RESOLUTIONS, entry.resolution)) errors.push(`${at}.resolution must be one of ${listOf(RESOLUTIONS)}`);
    else if ((entry.resolution === "local") !== (entry.to !== null)) errors.push(`${at}.resolution must be "local" exactly when to is not null`);
    if (!isPositiveInteger(entry.line)) errors.push(`${at}.line must be an integer of at least 1`);
    if (!isPositiveInteger(entry.column)) errors.push(`${at}.column must be an integer of at least 1`);
    if (entry.reason !== undefined && !oneOf(REASONS, entry.reason)) errors.push(`${at}.reason must be absent or one of ${listOf(REASONS)}`);
    if ("text" in entry) errors.push(`${at} must not carry source text`);
  });
}

function checkOptions(options: unknown, errors: string[]): void {
  if (!isObject(options)) {
    errors.push("options must be an object");
    return;
  }
  if (!oneOf(PRESETS, options.preset)) errors.push(`options.preset must be one of ${listOf(PRESETS)}`);
  for (const field of ["includeExtensions", "excludeDirectories", "excludeFilePatterns"]) {
    const list = options[field];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) errors.push(`options.${field} must be an array of strings`);
  }
  for (const field of ["maxFiles", "maxFileBytes", "maxTotalBytes"]) {
    if (!isPositiveInteger(options[field])) errors.push(`options.${field} must be a positive integer`);
  }
  if (options.jsToTsFallback !== true) errors.push("options.jsToTsFallback must be true");
}

export function validateInvestigation(value: unknown): ValidationResult {
  if (!isObject(value)) return { ok: false, errors: ["document must be a JSON object"] };
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push(`schemaVersion must be 1 (found ${found(value, "schemaVersion")})`);
  if (value.resolverMode !== "documented-source-subset") errors.push(`resolverMode must be "documented-source-subset" (found ${found(value, "resolverMode")})`);
  if (typeof value.sourceLabel !== "string") errors.push("sourceLabel must be a string");
  for (const field of ["modules", "imports", "diagnostics"]) {
    if (!Array.isArray(value[field])) errors.push(`${field} must be an array`);
  }
  const moduleIds = Array.isArray(value.modules) ? checkModules(value.modules, errors) : new Set<string>();
  if (Array.isArray(value.imports)) checkImports(value.imports, moduleIds, errors);
  checkOptions(value.options, errors);
  return result(errors);
}

function checkSide(value: unknown, field: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (typeof value.label !== "string") errors.push(`${field}.label must be a string`);
  if (!isCount(value.moduleCount)) errors.push(`${field}.moduleCount must be a non-negative integer`);
  if (!isCount(value.relationCount)) errors.push(`${field}.relationCount must be a non-negative integer`);
}

function sortedBy(list: unknown[], key: (item: unknown) => string): boolean {
  for (let i = 1; i < list.length; i += 1) if (key(list[i - 1]) > key(list[i])) return false;
  return true;
}

function checkModuleList(value: Obj, field: string, errors: string[]): void {
  const list = value[field];
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
    errors.push(`${field} must be an array of strings`);
    return;
  }
  if (!sortedBy(list, (item) => item as string)) errors.push(`${field} must be sorted in ascending order`);
}

function checkRelationList(value: Obj, field: string, errors: string[]): void {
  const list = value[field];
  if (!Array.isArray(list)) {
    errors.push(`${field} must be an array`);
    return;
  }
  let valid = true;
  list.forEach((entry, i) => {
    const at = `${field}[${i}]`;
    if (!isObject(entry)) {
      valid = false;
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof entry.relationId !== "string") errors.push(`${at}.relationId must be a string`);
    if (typeof entry.from !== "string") errors.push(`${at}.from must be a string`);
    if (entry.to !== null && typeof entry.to !== "string") errors.push(`${at}.to must be null or a string`);
    if (typeof entry.specifier !== "string") errors.push(`${at}.specifier must be a string`);
    if (!oneOf(SYNTAX_KINDS, entry.syntaxKind)) errors.push(`${at}.syntaxKind must be one of ${listOf(SYNTAX_KINDS)}`);
    if (!oneOf(DEPENDENCY_KINDS, entry.dependencyKind)) errors.push(`${at}.dependencyKind must be one of ${listOf(DEPENDENCY_KINDS)}`);
    if (!oneOf(RESOLUTIONS, entry.resolution)) errors.push(`${at}.resolution must be one of ${listOf(RESOLUTIONS)}`);
  });
  if (valid && !sortedBy(list, (item) => String((item as Obj).relationId))) errors.push(`${field} must be sorted by relationId in ascending order`);
}

export function validateComparison(value: unknown): ValidationResult {
  if (!isObject(value)) return { ok: false, errors: ["document must be a JSON object"] };
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push(`schemaVersion must be 1 (found ${found(value, "schemaVersion")})`);
  if (value.preset !== "static-value") errors.push(`preset must be "static-value" (found ${found(value, "preset")})`);
  checkSide(value.before, "before", errors);
  checkSide(value.after, "after", errors);
  for (const field of ["addedModules", "removedModules", "changedModules"]) checkModuleList(value, field, errors);
  for (const field of ["addedRelations", "removedRelations"]) checkRelationList(value, field, errors);
  if (!isCount(value.cyclicComponentsBefore)) errors.push("cyclicComponentsBefore must be a non-negative integer");
  if (!isCount(value.cyclicComponentsAfter)) errors.push("cyclicComponentsAfter must be a non-negative integer");
  return result(errors);
}
