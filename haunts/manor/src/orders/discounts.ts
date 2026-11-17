import { flags } from "../config/flags";

export function discountFor(lines: number, coupon: number): number {
  const stacked = flags.couponStacking ? coupon * 2 : coupon;
  return lines >= 10 ? stacked + 5 : stacked;
}
