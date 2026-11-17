import { requireEmail } from "../shared/validation";

export function checkPayer(email: string): boolean {
  return requireEmail(email).ok;
}
