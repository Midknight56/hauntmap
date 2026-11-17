import { balance } from "./ledger";
import { formatMoney } from "../shared/money";

export function renderInvoice(orderId: string): string {
  return `invoice ${orderId}: balance ${formatMoney(balance())}`;
}
