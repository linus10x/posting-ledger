import type { Currency } from "./money.js";

const accountBrand: unique symbol = Symbol("account");

export type Account<C extends Currency> = {
  readonly [accountBrand]: C;
  readonly id: string;
  readonly name: string;
  readonly currency: C;
};

export function openAccount<C extends Currency>(currency: C, name: string, id: string): Account<C> {
  if (!/^[a-z0-9-]{4,64}$/.test(id)) {
    throw new Error("account id must be 4 to 64 lowercase letters, digits, or hyphens");
  }
  if (name.trim().length === 0) {
    throw new Error("account name is required");
  }
  return { [accountBrand]: currency, id, name: name.trim(), currency };
}
