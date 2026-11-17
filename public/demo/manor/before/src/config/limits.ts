import { flags } from "./flags";

export const limits = {
  maxCartLines: flags.couponStacking ? 50 : 25,
  freeShippingCents: 5000,
  maxChargeCents: 500000,
};
