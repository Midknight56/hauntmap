import { chargeCustomer } from "../payments/charge";
import { loadCart, clearCart } from "./cart";
import { computeTotals } from "./totals";
import { openOrder } from "./order";
import { saveOrder } from "./orderRepo";
import { logger } from "../shared/logger";

export function describeOrder(orderId: string): string {
  return `order ${orderId}`;
}

export async function checkout(cartId: string, email: string) {
  const lines = loadCart(cartId);
  const subtotal = lines.reduce((sum, line) => sum + line.net, 0);
  const totals = computeTotals(subtotal, lines.length, 0);
  const order = openOrder(cartId, subtotal, lines.length);
  await chargeCustomer(order.id, email, totals.totalCents);
  saveOrder(order);
  clearCart(cartId);
  logger.info(describeOrder(order.id));
  return order;
}
