import { env } from "../config";

export const logger = {
  info(message: string): void {
    if (env.nodeEnv !== "test") console.log(message);
  },
};
