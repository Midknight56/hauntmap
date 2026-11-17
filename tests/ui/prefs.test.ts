import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  createPrefsStore,
  effectiveReducedMotion,
  type Prefs,
} from "../../src/features/investigation/prefs";

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PREFS_KEY, initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("prefs", () => {
  it("uses the documented key and defaults", () => {
    expect(PREFS_KEY).toBe("hauntmap.prefs.v1");
    expect(DEFAULT_PREFS).toEqual({ version: 1, motion: "system", legendOpen: true, preset: "static-value" });
  });

  it("returns the defaults for empty storage, no storage, garbage and a wrong shape", () => {
    expect(createPrefsStore(memory()).read()).toEqual(DEFAULT_PREFS);
    expect(createPrefsStore(null).read()).toEqual(DEFAULT_PREFS);
    for (const garbage of ["", "{", "null", "[]", "42", '"x"', '{"version":2}', '{"version":1,"motion":"loud","legendOpen":true,"preset":"static-value"}', '{"version":1,"motion":"system","legendOpen":"yes","preset":"static-value"}', '{"version":1,"motion":"system","legendOpen":true,"preset":"all"}']) {
      expect(createPrefsStore(memory(garbage)).read()).toEqual(DEFAULT_PREFS);
    }
  });

  it("returns the defaults when the storage throws, and write never throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const store = createPrefsStore(throwing);
    expect(store.read()).toEqual(DEFAULT_PREFS);
    expect(() => store.write({ ...DEFAULT_PREFS, legendOpen: false })).not.toThrow();
  });

  it("round-trips a written value and stores only the four fields", () => {
    const storage = memory();
    const store = createPrefsStore(storage);
    const prefs: Prefs = { version: 1, motion: "reduce", legendOpen: false, preset: "type-inclusive" };
    store.write(prefs);
    expect(store.read()).toEqual(prefs);
    expect(Object.keys(JSON.parse(storage.data.get(PREFS_KEY) ?? "{}") as object).sort()).toEqual(["legendOpen", "motion", "preset", "version"]);
  });

  it("effectiveReducedMotion follows the truth table", () => {
    const table: [Prefs["motion"], boolean, boolean][] = [
      ["reduce", true, true],
      ["reduce", false, true],
      ["allow", true, false],
      ["allow", false, false],
      ["system", true, true],
      ["system", false, false],
    ];
    for (const [motion, media, result] of table) {
      expect(effectiveReducedMotion({ ...DEFAULT_PREFS, motion }, media)).toBe(result);
    }
  });
});
