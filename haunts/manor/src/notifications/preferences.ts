import { requireEmail } from "../shared/validation";

const optedOut = new Set<string>();

export function optOut(email: string): void {
  if (requireEmail(email).ok) optedOut.add(email);
}

export function mayContact(email: string): boolean {
  return !optedOut.has(email);
}
