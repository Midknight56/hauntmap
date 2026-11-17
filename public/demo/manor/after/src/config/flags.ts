import { env } from "./env";

export const flags = {
  giftWrap: env.nodeEnv !== "production",
  couponStacking: false,
};
