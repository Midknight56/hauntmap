import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./appPath";

// Requirement 10.4: docs/kiro-log.md. Seven cells in every row, no placeholder dates or commits,
// the task-cell format of this spec, a numeric or empty Credits cell, and one row for each task
// that tasks.md marks as done.

const LABELS: Record<string, string> = {
  "2": "Setup: hook observation verify-on-stop",
  "6": "Setup: MCP registration",
  "7": "Setup: hook observation analyze-live",
  "12": "H9 session",
};
const TASK_CELL = /^kiro-integration, task (1a|1b|1c|2|3|4a|4b|4c|5|6|7|8|9|10|11|12|14|15)(?: \((.+)\))?$/;

function tableRows(): string[][] {
  const lines = readFileSync(join(REPO, "docs", "kiro-log.md"), "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("| Date |"));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()));
  }
  return rows;
}

const rows = tableRows();

describe("docs/kiro-log.md", () => {
  it("has a header with seven columns and rows with seven cells", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row, row[2]).toHaveLength(7);
  });

  it("has no EXAMPLE date and no 0000000 commit", () => {
    for (const row of rows) {
      expect((row[0] as string).startsWith("EXAMPLE"), row[2]).toBe(false);
      expect(row[3], row[2]).not.toBe("0000000");
      expect(row[0], row[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every task row of this spec matches the task cell format and its label", () => {
    for (const row of rows) {
      const task = row[2] as string;
      if (!task.startsWith("kiro-integration, task")) continue;
      const match = TASK_CELL.exec(task);
      expect(match, task).not.toBeNull();
      const number = match?.[1] as string;
      const label = match?.[2];
      if (label !== undefined) expect(label, task).toBe(LABELS[number]);
      else expect(LABELS[number], task).toBeUndefined();
    }
  });

  it("every Credits cell is empty or a non-negative number", () => {
    for (const row of rows) expect(row[5], row[2]).toMatch(/^(|\d+(\.\d+)?)$/);
  });

  it("has exactly one row for each task that tasks.md marks as done", () => {
    const tasks = readFileSync(join(REPO, ".kiro", "specs", "kiro-integration", "tasks.md"), "utf8");
    const done = [...tasks.matchAll(/^- \[x\] (\w+)\./gm)].map((m) => m[1] as string);
    expect(done.length).toBeGreaterThan(0);
    for (const id of done) {
      const found = rows.filter((row) => new RegExp(`^kiro-integration, task ${id}( \\(|$)`).test(row[2] as string));
      expect(found, `task ${id}`).toHaveLength(1);
    }
  });
});
