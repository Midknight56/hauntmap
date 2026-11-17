export interface Money {
  cents: number;
  currency: string;
}

export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function addMoney(a: Money, b: Money): Money {
  return { cents: a.cents + b.cents, currency: a.currency };
}
