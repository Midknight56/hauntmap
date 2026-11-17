import { formatMoney, type Money } from "../shared/money";
import { discountFor } from "./discounts";
import { shippingCents } from "./shipping";

export interface Totals {
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  label: string;
}

export function computeTotals(subtotalCents: number, lines: number, coupon: number): Totals {
  const shipping = shippingCents(subtotalCents);
  const discount = discountFor(lines, coupon);
  const total = subtotalCents + shipping - discount;
  return {
    subtotalCents,
    shippingCents: shipping,
    discountCents: discount,
    totalCents: total,
    label: formatMoney(total),
  };
}

export function toMoney(totals: Totals, currency: string): Money {
  return { cents: totals.totalCents, currency };
}
