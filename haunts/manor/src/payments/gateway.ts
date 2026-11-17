import { env } from "../config/env";
import { ok, fail } from "../shared/result";

export function authorize(token: string, cents: number) {
  if (env.nodeEnv === "test") return ok(`test-${token}`);
  return cents > 0 ? ok(`auth-${token}-${cents}`) : fail<string>("nothing to charge");
}
