import { enqueue } from "./queue";
import { mayContact } from "./preferences";
import { env } from "../config/env";

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  if (!mayContact(to)) return;
  enqueue(`${env.mailFrom} > ${to}: ${subject}\n${body}`);
}

export async function sendInvoiceMail(to: string, orderId: string): Promise<void> {
  const invoice = await import("../payments/invoice");
  await sendMail(to, "Your invoice", invoice.renderInvoice(orderId));
}
