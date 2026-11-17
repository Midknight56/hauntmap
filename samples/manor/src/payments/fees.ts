import { limits } from "../config/limits";

export function processingFee(cents: number): number {
  const cap = Math.round(limits.maxChargeCents * 0.01);
  return Math.min(Math.round(cents * 0.015) + 25, cap);
}
