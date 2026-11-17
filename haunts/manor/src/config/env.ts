export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  currency: process.env.SHOP_CURRENCY ?? "EUR",
  mailFrom: process.env.SHOP_MAIL_FROM ?? "shop@manor.test",
};
