import { describe, expect, it } from "vitest";
import { validateInvestigation } from "../../src/contracts/validate";
import { readGraphFile } from "../../src/features/import/graphFile";
import { graphFixture, liveCounts, liveInvestigation, liveText } from "./graphHelpers";

// Requirements 6.2 to 6.4. `readGraphFile` takes a Blob, so Node's Blob serves.

const blob = (text: string): Blob => new Blob([text]);

describe("readGraphFile failures (6.2)", () => {
  it("refuses a file over 25 MiB without reading it", async () => {
    let read = false;
    const huge = { size: 26_214_401, text: async () => { read = true; return ""; } } as unknown as Blob;
    expect(await readGraphFile(huge, validateInvestigation)).toEqual({ ok: false, message: "The graph file is larger than 25 MiB." });
    expect(read).toBe(false);
  });

  it("accepts a file of exactly 26,214,400 bytes as far as the size goes", async () => {
    const edge = { size: 26_214_400, text: async () => "{" } as unknown as Blob;
    const result = await readGraphFile(edge, validateInvestigation);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message.startsWith("The graph file is not JSON (")).toBe(true);
  });

  it("says when the text is not JSON, with the SyntaxError message", async () => {
    const result = await readGraphFile(blob(graphFixture("not-json.txt")), validateInvestigation);
    let expectedMessage = "";
    try {
      JSON.parse(graphFixture("not-json.txt"));
    } catch (error) {
      expectedMessage = (error as SyntaxError).message;
    }
    expect(result).toEqual({ ok: false, message: `The graph file is not JSON (${expectedMessage}).` });
  });

  it("says when validation fails, with the first error", async () => {
    const result = await readGraphFile(blob(graphFixture("malformed.json")), validateInvestigation);
    expect(result).toEqual({ ok: false, message: "The graph file is not valid: schemaVersion must be 1 (found 2)." });
  });

  it("uses the first error of the validator it is given", async () => {
    const result = await readGraphFile(blob("{}"), () => ({ ok: false, errors: ["first", "second"] }));
    expect(result).toEqual({ ok: false, message: "The graph file is not valid: first." });
  });
});

describe("readGraphFile success (6.3, 6.4)", () => {
  it("reads public/demo/live.json as a bare investigation and keeps its sourceLabel", async () => {
    const result = await readGraphFile(blob(liveText()), validateInvestigation);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.label).toBe("live:haunts/manor");
    expect(result.investigation).toEqual(liveInvestigation());
    expect(liveCounts().modules).toBeGreaterThan(0);
  });
});
