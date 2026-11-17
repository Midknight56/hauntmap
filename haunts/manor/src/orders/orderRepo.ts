import { openOrder } from "./order";
import { logger } from "../shared/logger";

type StoredOrder = ReturnType<typeof openOrder>;

const stored = new Map<string, StoredOrder>();

export function saveOrder(order: StoredOrder): void {
  stored.set(order.id, order);
  logger.info(`stored ${order.id}`);
}

export function loadOrder(id: string): StoredOrder | null {
  return stored.get(id) ?? null;
}
