import { describe, expect, it } from "vitest";
import { searchModules } from "../../src/features/investigation/search";
import { expected } from "../e2e/helpers";

const IDS = ["src/shared/ids.ts", "src/orders/Receipt.ts", "src/notifications/receipt.ts", "src/orders/checkout.ts"];

describe("searchModules (4.1)", () => {
  it("matches a substring case-insensitively and sorts by ID", () => {
    expect(searchModules(IDS, "receipt")).toEqual({
      shown: ["src/notifications/receipt.ts", "src/orders/Receipt.ts"],
      total: 2,
    });
    expect(searchModules(IDS, "RECEIPT").total).toBe(2);
    expect(searchModules(IDS, "orders/")).toEqual({ shown: ["src/orders/Receipt.ts", "src/orders/checkout.ts"], total: 2 });
  });

  it("returns nothing for an empty query and for a query with no match", () => {
    expect(searchModules(IDS, "")).toEqual({ shown: [], total: 0 });
    expect(searchModules(IDS, "zzz")).toEqual({ shown: [], total: 0 });
  });

  it("shows at most 20 and reports the total", () => {
    const many = Array.from({ length: 45 }, (_, i) => `src/m${String(i).padStart(3, "0")}.ts`);
    const result = searchModules(many, "m0");
    expect(result.total).toBe(45);
    expect(result.shown).toHaveLength(20);
    expect(result.shown[0]).toBe("src/m000.ts");
    expect(result.shown[19]).toBe("src/m019.ts");
  });

  it("finds receipt on the manor", () => {
    const ids = expected().modules.map((m) => m.id);
    expect(searchModules(ids, "receipt")).toEqual({ shown: ["src/notifications/receipt.ts"], total: 1 });
  });

  it("does not change its input", () => {
    const copy = [...IDS];
    searchModules(IDS, "r");
    expect(IDS).toEqual(copy);
  });
});
