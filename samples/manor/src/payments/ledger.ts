import { newId } from "../shared/ids";
import { isoDate } from "../shared/dates";

export interface LedgerEntry {
  id: string;
  day: string;
  cents: number;
  memo: string;
}

const entries: LedgerEntry[] = [];

export function record(cents: number, memo: string): LedgerEntry {
  const entry = { id: newId("led"), day: isoDate(new Date()), cents, memo };
  entries.push(entry);
  return entry;
}

export function balance(): number {
  return entries.reduce((sum, entry) => sum + entry.cents, 0);
}
