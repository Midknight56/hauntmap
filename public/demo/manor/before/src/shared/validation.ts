import { fail, ok } from "./result";
import { isoDate } from "./dates";

export function requireEmail(value: string) {
  return value.includes("@") ? ok(value) : fail<string>("not an email address");
}

export function requireFutureDate(value: Date, today: Date) {
  return value > today ? ok(isoDate(value)) : fail<string>("date is not in the future");
}
