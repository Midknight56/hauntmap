export type OrderStatus = "open" | "paid" | "shipped" | "cancelled";

export function canCancel(status: OrderStatus): boolean {
  return status === "open" || status === "paid";
}
