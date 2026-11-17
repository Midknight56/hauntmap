import { renderTemplate } from "./templates";
import { sendMail } from "./mailer";
import { summarizeOrder } from "../orders/summary";
import { formatMoney } from "../shared/money";

export interface ReceiptInput {
  orderId: string;
  customerEmail: string;
  totalCents: number;
}

export async function sendReceipt(input: ReceiptInput): Promise<void> {
  const body = renderTemplate("receipt", { total: formatMoney(input.totalCents) });
  await sendMail(input.customerEmail, "Your receipt", body);
}
