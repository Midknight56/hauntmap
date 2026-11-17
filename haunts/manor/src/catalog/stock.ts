import { ok, fail } from "../shared/result";

export function reserve(onHand: number, wanted: number) {
  return wanted <= onHand ? ok(onHand - wanted) : fail<number>("not enough stock");
}
