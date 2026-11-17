import { newId } from "../shared/ids";
import { canCancel } from "./status";
import { computeTotals } from "./totals";

export interface Order {
  id: string;
  cartId: string;
  status: "open" | "paid" | "shipped" | "cancelled";
  totalCents: number;
}

export function openOrder(cartId: string, subtotalCents: number, lines: number): Order {
  const totals = computeTotals(subtotalCents, lines, 0);
  return { id: newId("ord"), cartId, status: "open", totalCents: totals.totalCents };
}

export function cancelOrder(order: Order): Order {
  return canCancel(order.status) ? { ...order, status: "cancelled" } : order;
}
