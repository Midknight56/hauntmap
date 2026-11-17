import { sendReceipt } from "../notifications/receipt";
import { authorize } from "./gateway";
import { processingFee } from "./fees";
import { record } from "./ledger";
import { checkPayer } from "./methods";

export async function chargeCustomer(orderId: string, email: string, cents: number): Promise<boolean> {
  if (!checkPayer(email)) return false;
  const auth = authorize(orderId, cents + processingFee(cents));
  if (!auth.ok) return false;
  record(cents, `charge ${orderId}`);
  await sendReceipt({ orderId, customerEmail: email, totalCents: cents });
  return true;
}
