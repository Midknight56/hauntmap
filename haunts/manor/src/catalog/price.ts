import { TAX_CLASSES } from "./product";
import { addMoney } from "../shared/money";

export interface Price {
  net: number;
  taxClass: (typeof TAX_CLASSES)[number];
}

export function withTax(price: Price, rate: number): number {
  const net = { cents: price.net, currency: "EUR" };
  const tax = { cents: Math.round(price.net * rate), currency: "EUR" };
  return addMoney(net, tax).cents;
}
