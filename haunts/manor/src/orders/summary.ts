import { computeTotals } from "./totals";
import { formatMoney } from "../shared/money";
import { canCancel } from "./status";

export function summarizeOrder(subtotalCents: number, lines: number): string {
  const totals = computeTotals(subtotalCents, lines, 0);
  const note = canCancel("open") ? "can be cancelled" : "final";
  return `${lines} lines, ${formatMoney(totals.totalCents)}, ${note}`;
}
