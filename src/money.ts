const minorBrand: unique symbol = Symbol("minor");

/** Closed alphabetic set drawn from ISO 4217. Codes outside this set fail at compile time. */
export const ISO_4217 = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
} as const;

export type Currency = keyof typeof ISO_4217;

export type Scale<C extends Currency> = (typeof ISO_4217)[C];

/** Integer minor units branded by currency. 100 USD minor units are 1.00. 100 JPY minor units are 100. */
export type Minor<C extends Currency> = bigint & { readonly [minorBrand]: C };

export function minor<C extends Currency>(currency: C, amount: bigint): Minor<C> {
  if (amount < 0n) {
    throw new Error("amount must be zero or greater");
  }
  return amount as Minor<C>;
}

type SameCurrency<A extends Currency, B extends Currency, T> = [A] extends [B] ? ([B] extends [A] ? T : never) : never;

export function add<A extends Currency, B extends Currency>(
  left: Minor<A>,
  right: SameCurrency<A, B, Minor<B>>,
): Minor<A> {
  return (left + right) as Minor<A>;
}

export function isCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(ISO_4217, value);
}

export function assertCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new Error(`closed ISO 4217 set does not include ${value}`);
  }
  return value;
}

export function formatMinor<C extends Currency>(currency: C, amount: Minor<C>): string {
  const scale = ISO_4217[currency];
  if (scale === 0) {
    return `${currency} ${amount.toString()}`;
  }
  const divisor = 10n ** BigInt(scale);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(scale, "0");
  return `${currency} ${whole.toString()}.${fraction}`;
}
