import { renderTemplate } from "./templates";
import { sendMail } from "./mailer";
import { describeOrder } from "../orders/checkout";
import { formatMoney } from "../shared/money";

export interface ReceiptInput {
  orderId: string;
  customerEmail: string;
  totalCents: number;
}

export async function sendReceipt(input: ReceiptInput): Promise<void> {
  console.info(describeOrder(input.orderId));
  const body = renderTemplate("receipt", { total: formatMoney(input.totalCents) });
  await sendMail(input.customerEmail, "Your receipt", body);
}
