import { limits } from "../config/limits";

export function shippingCents(subtotalCents: number): number {
  return subtotalCents >= limits.freeShippingCents ? 0 : 490;
}
