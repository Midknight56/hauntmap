import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze, DEFAULT_ANALYSIS_OPTIONS } from "../../src/analysis/index";
import type { LiveDeps } from "../../src/features/liveSnapshot/openLiveSnapshot";
import { loadSourceSet, resolveRoot, sha256Hex } from "../../packages/hauntmap-mcp/src/loader";
import { webCryptoHash } from "./appPath";
import { RecordingFs } from "./fakeFs";
import { beforeInvestigation, jsonResponse, liveInvestigation, makeFakeRegistry, makeFakeStore, makeFetch, sampleSet } from "./fakes";
import { arbArgs, arbInvestigation, arbMutation, arbPath, arbTree } from "./generators";
import { materialize, symlinkDirectory } from "./materialize";

// P1 to P8 of design.md, "Correctness Properties". 200 runs each, the seed is printed on failure.
// P1 to P4 belong to task 3, P7 to task 4a, P5 and P6 to task 5 and P8 to task 10. The modules of the later
// tasks are imported inside their own properties, so that a module that does not exist yet fails only its own
// property and the file still loads.

const RUNS = { numRuns: 200 };
const temporary: string[] = [];
function makeWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hauntmap-props-")));
  temporary.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const EXCLUDED_DIRECTORIES = [".git", "node_modules", "dist", "build", "out", ".next", "coverage"];
const INCLUDED_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"];

/** The exclude patterns of the plan as a plain matcher, written here independently of the loader. */
function matchesSecret(name: string): boolean {
  return name === ".env" || name.startsWith(".env.") || name.endsWith(".pem") || name.endsWith(".key") || name.startsWith("id_rsa");
}

describe("P1 loader determinism and order independence", () => {
  it("two creation orders give deep-equal SourceSets and Investigations", async () => {
    await fc.assert(
      fc.asyncProperty(arbTree, async (tree) => {
        const paths = Object.keys(tree.files);
        const a = makeWorkspace();
        const b = makeWorkspace();
        mkdirSync(join(a, "root"));
        mkdirSync(join(b, "root"));
        materialize(tree, join(a, "root"), paths);
        materialize(tree, join(b, "root"), [...paths].reverse());
        const [ra, rb] = [await resolveRoot(a, "root"), await resolveRoot(b, "root")];
        if (!ra.ok || !rb.ok) throw new Error("resolveRoot failed");
        const [la, lb] = [await loadSourceSet(ra.root, DEFAULT_ANALYSIS_OPTIONS), await loadSourceSet(rb.root, DEFAULT_ANALYSIS_OPTIONS)];
        expect(la).toEqual(lb);
        if (la.ok && lb.ok) {
          const [ia, ib] = [
            await analyze(la.sourceSet, DEFAULT_ANALYSIS_OPTIONS, sha256Hex, undefined, la.diagnostics),
            await analyze(lb.sourceSet, DEFAULT_ANALYSIS_OPTIONS, sha256Hex, undefined, lb.diagnostics),
          ];
          expect(ia).toEqual(ib);
        }
        rmSync(a, { recursive: true, force: true });
        rmSync(b, { recursive: true, force: true });
      }),
      RUNS,
    );
  });
});

describe("P2 loader classification totality", () => {
  it("every file is included or covered by exactly one skipped entry, and the caps hold", async () => {
    await fc.assert(
      fc.asyncProperty(arbTree, async (tree) => {
        const workspace = makeWorkspace();
        mkdirSync(join(workspace, "root"));
        materialize(tree, join(workspace, "root"));
        const resolved = await resolveRoot(workspace, "root");
        if (!resolved.ok) throw new Error("resolveRoot failed");
        const loaded = await loadSourceSet(resolved.root, DEFAULT_ANALYSIS_OPTIONS);
        if (!loaded.ok) {
          expect(loaded.error.code).toBe("cap-reached");
          rmSync(workspace, { recursive: true, force: true });
          return;
        }
        const included = new Set(loaded.sourceSet.files.map((f) => f.path));
        const skipped = new Set(loaded.sourceSet.skipped.map((s) => s.path));
        for (const path of Object.keys(tree.files)) {
          const segments = path.split("/");
          const excludedAt = segments.slice(0, -1).findIndex((segment) => EXCLUDED_DIRECTORIES.includes(segment));
          const covering = [
            ...(excludedAt >= 0 ? [`${segments.slice(0, excludedAt + 1).join("/")}/`] : []),
            ...(excludedAt < 0 && skipped.has(path) ? [path] : []),
          ];
          if (excludedAt >= 0) {
            expect(included.has(path), path).toBe(false);
            expect(skipped.has(covering[0] as string), path).toBe(true);
          } else if (included.has(path)) {
            expect(skipped.has(path), path).toBe(false);
          } else {
            expect(covering, path).toEqual([path]);
          }
        }
        const total = loaded.sourceSet.files.reduce((sum, f) => sum + f.bytes, 0);
        for (const file of loaded.sourceSet.files) {
          const name = file.path.split("/").pop() as string;
          expect(INCLUDED_EXTENSIONS.some((e) => name.endsWith(e)), file.path).toBe(true);
          expect(matchesSecret(name), file.path).toBe(false);
          expect(file.bytes, file.path).toBeLessThanOrEqual(1_048_576);
          expect(file.text.slice(0, 8192).includes("\u0000"), file.path).toBe(false);
          expect(file.path.split("/").slice(0, -1).some((s) => EXCLUDED_DIRECTORIES.includes(s)), file.path).toBe(false);
        }
        expect(loaded.sourceSet.files.length).toBeLessThanOrEqual(1000);
        expect(total).toBeLessThanOrEqual(26_214_400);
        rmSync(workspace, { recursive: true, force: true });
      }),
      RUNS,
    );
  });
});

describe("P3 hash agreement", () => {
  it("node:crypto over the decoded text equals Web Crypto over Blob.text()", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: "grapheme", maxLength: 200 }), fc.boolean(), async (text, withBom) => {
        const encoded = new TextEncoder().encode(text);
        const bytes = withBom ? new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]) : encoded;
        const nodeHash = await sha256Hex(new TextDecoder("utf-8").decode(bytes));
        const appHash = await webCryptoHash(await new Blob([bytes]).text());
        expect(nodeHash).toBe(appHash);
      }),
      RUNS,
    );
  });
});

describe("P4 root containment", () => {
  let workspace = "";
  let outside = "";
  beforeAll(() => {
    workspace = makeWorkspace();
    outside = makeWorkspace();
    mkdirSync(join(workspace, "src"));
    mkdirSync(join(workspace, "haunts", "manor"), { recursive: true });
    writeFileSync(join(workspace, "x.ts"), "export {};\n");
    writeFileSync(join(outside, "x.ts"), "export {};\n");
    mkdirSync(join(outside, "haunts"));
    symlinkDirectory(outside, join(workspace, "link"));
    symlinkDirectory(outside, join(workspace, "src", "outside"));
  });

  it("resolveRoot is ok only for a directory whose realpath is the workspace or below it, and rejected paths read nothing outside", async () => {
    const outsideReal = realpathSync(outside);
    await fc.assert(
      fc.asyncProperty(arbPath, async (given) => {
        const fs = new RecordingFs();
        const result = await resolveRoot(workspace, given, fs);
        const absolute = resolve(workspace, given);
        let real: string | undefined;
        try {
          real = realpathSync(absolute);
        } catch {
          real = undefined;
        }
        const inside = (path: string): boolean => path === workspace || path.startsWith(workspace + sep);
        const expectOk = real !== undefined && inside(real) && statSync(real).isDirectory();
        expect(result.ok, given).toBe(expectOk);
        if (result.ok) expect(inside(realpathSync(result.root.absolute))).toBe(true);
        else {
          const outsideCode = real !== undefined ? !inside(real) : !inside(absolute);
          expect(result.error.code, given).toBe(outsideCode ? "root-outside-workspace" : "root-not-found");
          expect(fs.reads).toEqual([]);
          expect(fs.readdirs.filter((p) => p.startsWith(outsideReal))).toEqual([]);
        }
      }),
      RUNS,
    );
  });
});

describe("P5 tool error totality", () => {
  it("any arguments give a validated value or one of the seven error codes, never a throw, never a write", async () => {
    const { analyzeTool, compareTool, createContext, cyclesTool, whoImportsTool } = await import("../../packages/hauntmap-mcp/src/tools");
    const { validateComparison, validateInvestigation } = await import("../../src/contracts/validate");
    const workspace = makeWorkspace();
    for (const base of ["haunts/manor", "public/demo/manor/before"]) {
      mkdirSync(join(workspace, ...base.split("/"), "src", "orders"), { recursive: true });
      mkdirSync(join(workspace, ...base.split("/"), "src", "notifications"), { recursive: true });
      writeFileSync(join(workspace, ...base.split("/"), "src", "orders", "checkout.ts"), "export const describeOrder = 1;\n");
      writeFileSync(join(workspace, ...base.split("/"), "src", "notifications", "receipt.ts"), 'import { describeOrder } from "../orders/checkout";\nexport const r = describeOrder;\n');
    }
    const codes = ["invalid-arguments", "invalid-preset", "root-outside-workspace", "root-not-found", "cap-reached", "module-not-found", "analysis-failed"];
    const fs = new RecordingFs();
    const ctx = createContext(workspace, { fs });
    await fc.assert(
      fc.asyncProperty(arbArgs, fc.constantFrom("analyze", "cycles", "who_imports", "compare"), async (args, tool) => {
        const run = { analyze: analyzeTool, cycles: cyclesTool, who_imports: whoImportsTool, compare: compareTool }[tool] as typeof analyzeTool;
        const result = await run(ctx, args);
        if (result.ok) {
          if (tool === "analyze") expect(validateInvestigation(result.value)).toEqual({ ok: true });
          if (tool === "compare") expect(validateComparison(result.value)).toEqual({ ok: true });
          if (tool === "cycles") expect(Array.isArray((result.value as unknown as { components: unknown[] }).components)).toBe(true);
          if (tool === "who_imports") expect((result.value as unknown as { direction: string }).direction).toBe("imported-by");
        } else {
          expect(codes).toContain(result.error.code);
          expect(result.error.message.length).toBeGreaterThan(0);
        }
        expect(fs.writes).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe("P6 JSON round trip", () => {
  it("an investigation and a comparison survive JSON.stringify and JSON.parse and still validate", async () => {
    const { compareInvestigations } = await import("../../src/analysis/graph/compare");
    const { validateComparison, validateInvestigation } = await import("../../src/contracts/validate");
    fc.assert(
      fc.property(arbInvestigation, arbInvestigation, (a, b) => {
        expect(JSON.parse(JSON.stringify(a))).toEqual(a);
        expect(validateInvestigation(JSON.parse(JSON.stringify(a)))).toEqual({ ok: true });
        const compared = compareInvestigations(a, b);
        if (compared.ok) {
          expect(JSON.parse(JSON.stringify(compared.result))).toEqual(compared.result);
          expect(validateComparison(JSON.parse(JSON.stringify(compared.result)))).toEqual({ ok: true });
        }
      }),
      RUNS,
    );
  });
});

describe("P7 validator soundness", () => {
  it("accepts every generated investigation", async () => {
    const { validateInvestigation } = await import("../../src/contracts/validate");
    fc.assert(
      fc.property(arbInvestigation, (inv) => {
        expect(validateInvestigation(inv)).toEqual({ ok: true });
      }),
      RUNS,
    );
  });

  it("rejects every mutation with a first error that starts with the mutated path", async () => {
    const { validateInvestigation } = await import("../../src/contracts/validate");
    fc.assert(
      fc.property(arbInvestigation.chain((inv) => arbMutation(inv)), (mutation) => {
        const result = validateInvestigation(mutation.value);
        expect(result.ok, mutation.field).toBe(false);
        if (!result.ok) expect(result.errors[0]?.startsWith(mutation.prefix), `${mutation.field}: ${result.errors[0] ?? ""}`).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("P8 view preservation", () => {
  type Kind = "missing" | "fallback" | "reject" | "status500" | "malformed" | "not-json" | "valid-no-handoff" | "valid-handoff" | "analyze-rejects" | "handoff-rejects";
  const KINDS: Kind[] = ["missing", "fallback", "reject", "status500", "malformed", "not-json", "valid-no-handoff", "valid-handoff", "analyze-rejects", "handoff-rejects"];

  function responseFor(kind: Kind): () => Response {
    switch (kind) {
      case "missing":
        return () => new Response("not found", { status: 404 });
      case "fallback":
        return () => new Response("<!doctype html><title>HauntMap</title>", { status: 200, headers: { "content-type": "text/html" } });
      case "reject":
        return () => {
          throw new TypeError("Failed to fetch");
        };
      case "status500":
        return () => new Response("x", { status: 500 });
      case "malformed":
        return () => jsonResponse({ ...liveInvestigation(), schemaVersion: 2 });
      case "not-json":
        return () => new Response('{"schemaVersion": 1,', { status: 200, headers: { "content-type": "application/json" } });
      default:
        return () => jsonResponse(liveInvestigation(4));
    }
  }

  it("keeps the view on every outcome except loaded, and keeps camera, selection, route filter and wings on loaded", async () => {
    const { openLiveSnapshot } = await import("../../src/features/liveSnapshot/openLiveSnapshot");
    const { validateInvestigation } = await import("../../src/contracts/validate");
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KINDS),
        fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }), zoom: fc.double({ min: 0.25, max: 4, noNaN: true }) }),
        fc.option(fc.constantFrom("src/a.ts", "src/b.ts"), { nil: null }),
        fc.option(fc.constantFrom("route-1", "route-2"), { nil: null }),
        fc.subarray(["src/orders", "src/catalog", "src/shared"]),
        async (kind, camera, selected, routeFilter, expandedWings) => {
          const noInvestigation = kind === "analyze-rejects";
          const store = makeFakeStore({
            investigation: noInvestigation ? null : beforeInvestigation(),
            camera,
            selection: selected === null ? null : { kind: "module", id: selected },
            routeFilter,
            expandedWings,
          });
          const handoff = kind === "valid-handoff" ? async () => undefined : kind === "handoff-rejects" ? async () => Promise.reject(new Error("handoff failed")) : null;
          const registry = makeFakeRegistry(handoff);
          const { fetchImpl } = makeFetch(responseFor(kind));
          const deps = {
            store,
            registry,
            base: "/",
            fetchImpl,
            now: () => 1,
            loadSample: async () => ({ ok: true as const, sourceSet: sampleSet() }),
            analysisClient: { analyze: kind === "analyze-rejects" ? async () => Promise.reject(new Error("worker failed")) : async () => beforeInvestigation() },
            defaults: DEFAULT_ANALYSIS_OPTIONS,
            validate: validateInvestigation,
          } as unknown as LiveDeps;
          const before = structuredClone(store.getState());
          const statusCallsBefore = store.calls.setStatus.length;
          const outcome = await openLiveSnapshot(deps);
          const after = store.getState();
          if (kind === "valid-handoff") {
            expect(outcome).toBe("loaded");
            expect(after.camera).toEqual(before.camera);
            expect(after.selection).toEqual(before.selection);
            expect(after.routeFilter).toEqual(before.routeFilter);
            expect(after.expandedWings).toEqual(before.expandedWings);
            expect(registry.handoffCalls).toHaveLength(1);
            expect(registry.handoffCalls[0]?.before).toEqual(before.investigation);
          } else {
            expect({ ...after, status: "" }).toEqual({ ...before, status: "" });
            if (kind === "analyze-rejects") {
              expect(outcome).toBe("sample-failed");
              expect(after.investigation).toBeNull();
            }
            if (kind === "handoff-rejects") {
              expect(outcome).toBe("compare-failed");
              expect(registry.handoffCalls).toHaveLength(1);
              expect(store.calls.setStatus.length).toBe(statusCallsBefore);
            }
          }
        },
      ),
      RUNS,
    );
  });
});
