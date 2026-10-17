import type { Account } from "./account.js";
import { type Currency, type Minor } from "./money.js";

const idemBrand: unique symbol = Symbol("idempotency");

export type IdempotencyKey = string & { readonly [idemBrand]: "idempotency" };

export type Side = "debit" | "credit";

export type Line<C extends Currency> = {
  readonly account: Account<C>;
  readonly side: Side;
  readonly amount: Minor<C>;
};

export type Pending<C extends Currency> = {
  readonly state: "pending";
  readonly key: IdempotencyKey;
  readonly currency: C;
  readonly lines: readonly Line<C>[];
};

export type Posted<C extends Currency> = {
  readonly state: "posted";
  readonly key: IdempotencyKey;
  readonly currency: C;
  readonly lines: readonly Line<C>[];
  readonly at: string;
};

export type Reversed<C extends Currency> = {
  readonly state: "reversed";
  readonly key: IdempotencyKey;
  readonly currency: C;
  readonly lines: readonly Line<C>[];
  readonly at: string;
  readonly reverses: IdempotencyKey;
};

export function idempotencyKey(value: string): IdempotencyKey {
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(value)) {
    throw new Error("idempotency key must be 8 to 80 url-safe characters");
  }
  return value as IdempotencyKey;
}

function balanced<C extends Currency>(lines: readonly Line<C>[]): C {
  const first = lines[0];
  if (first === undefined || lines.length < 2) {
    throw new Error("a posting needs at least two lines");
  }
  const currency = first.account.currency;
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.account.currency !== currency) {
      throw new Error("mixed currency posting");
    }
    if (line.amount <= 0n) {
      throw new Error("line amount must be greater than zero");
    }
    if (line.side === "debit") {
      debits += line.amount;
    } else {
      credits += line.amount;
    }
  }
  if (debits !== credits) {
    throw new Error(`unbalanced posting: debits ${debits.toString()} credits ${credits.toString()}`);
  }
  return currency;
}

export class Ledger {
  readonly #pending = new Map<string, Pending<Currency>>();
  readonly #posted = new Map<string, Posted<Currency>>();
  readonly #reversed = new Map<string, Reversed<Currency>>();
  readonly #reversalOf = new Map<string, Reversed<Currency>>();

  prepare<C extends Currency>(lines: readonly Line<C>[], key: IdempotencyKey): Pending<C> {
    const posted = this.#posted.get(key);
    if (posted !== undefined) {
      throw new Error("key already posted");
    }
    const reversed = this.#reversed.get(key);
    if (reversed !== undefined) {
      throw new Error("key already reversed");
    }
    const existing = this.#pending.get(key);
    if (existing !== undefined) {
      return existing as Pending<C>;
    }
    const currency = balanced(lines);
    const pending: Pending<C> = { state: "pending", key, currency, lines };
    this.#pending.set(key, pending);
    return pending;
  }

  commit<C extends Currency>(entry: Pending<C>, at: string): Posted<C> {
    const already = this.#posted.get(entry.key);
    if (already !== undefined) {
      return already as Posted<C>;
    }
    const pending = this.#pending.get(entry.key);
    if (pending === undefined) {
      throw new Error("unknown pending posting");
    }
    const posted: Posted<C> = {
      state: "posted",
      key: entry.key,
      currency: entry.currency,
      lines: pending.lines as readonly Line<C>[],
      at,
    };
    this.#pending.delete(entry.key);
    this.#posted.set(entry.key, posted);
    return posted;
  }

  reverse<C extends Currency>(entry: Posted<C>, at: string): Reversed<C> {
    const linked = this.#reversalOf.get(entry.key);
    if (linked !== undefined) {
      return linked as Reversed<C>;
    }
    const posted = this.#posted.get(entry.key);
    if (posted === undefined) {
      throw new Error("only a posted entry can be reversed");
    }
    const reversalRaw = `${posted.key}:rev`;
    if (!/^[A-Za-z0-9:_-]{8,80}$/.test(reversalRaw)) {
      throw new Error("reversal key must be 8 to 80 url-safe characters");
    }
    if (this.#posted.has(reversalRaw) || this.#pending.has(reversalRaw)) {
      throw new Error("reversal key already used");
    }
    const lines = posted.lines.map((line) => ({
      account: line.account,
      side: line.side === "debit" ? ("credit" as const) : ("debit" as const),
      amount: line.amount,
    }));
    const reversed: Reversed<C> = {
      state: "reversed",
      key: reversalRaw as IdempotencyKey,
      currency: posted.currency as C,
      lines: lines as unknown as readonly Line<C>[],
      at,
      reverses: posted.key as IdempotencyKey,
    };
    this.#reversed.set(reversalRaw, reversed);
    this.#reversalOf.set(posted.key, reversed);
    return reversed;
  }

  get(key: IdempotencyKey): Pending<Currency> | Posted<Currency> | Reversed<Currency> | undefined {
    return this.#posted.get(key) ?? this.#reversed.get(key) ?? this.#pending.get(key);
  }
}
