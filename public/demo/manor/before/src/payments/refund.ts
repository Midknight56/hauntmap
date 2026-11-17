import { authorize } from "./gateway";
import { record } from "./ledger";

export function refund(orderId: string, cents: number) {
  const auth = authorize(orderId, cents);
  if (auth.ok) record(-cents, `refund ${orderId}`);
  return auth;
}
