# posting-ledger

A small TypeScript ledger. Currency is a brand on an integer minor-unit amount. A posting that mixes currencies, or a reverse of an entry that is not posted, fails `tsc`. Debits must equal credits or `prepare` throws. The same idempotency key posts once.

This is a hands-on library. It is not a client system and it is not years of production ledger work.

## Problem

Banking and wealth code keeps losing money at the boundary between a string currency code and a JavaScript number. `0.1 + 0.2` is not a cent. A function that accepts `string` will accept `"USDX"`. Dinero.js already brands currency amounts. The open problem above that is the posting itself: which account the line may name, whether the entry is pending, posted, or reversed, and whether a retry posts it twice.

Research notes from 2026-10-17: Claude.ai kept the ledger and said to leave the amount type to a library like Dinero and put the type system on the posting state machine. Grok kept branded currency and said mixed-currency arithmetic has to fail at compile time. Sources named in those chats: https://dinerojs.com and https://github.com/dinerojs/dinero.js.

## Design

- `ISO_4217` is a closed set: USD, EUR, GBP, JPY. The exponent is 2, except JPY, which is 0. `minor("USDX", 1n)` is a type error. A runtime string goes through `assertCurrency`.
- `Minor<C>` is a `bigint` branded by `C`. `add` accepts two amounts only when both type parameters are the same currency.
- `Account<C>` carries the same brand. A `Line<"USD">` cannot hold a EUR account.
- `prepare` checks that every line shares one currency and that debits equal credits. `commit` turns a `Pending<C>` into a `Posted<C>`. `reverse` accepts only a `Posted<C>`, leaves that posted entry in place, and stores a second entry under the original key plus `:rev`. The second entry keeps the stored currency and the same amounts, with debit and credit swapped. Both entries stay in the store, so the offset can be added to the original.
- The store returns the first committed entry for an idempotency key.

## Usage

```ts
import { Ledger, idempotencyKey, minor, openAccount } from "posting-ledger";

const cash = openAccount("USD", "Cash", "cash-usd");
const revenue = openAccount("USD", "Revenue", "rev-usd");
const amount = minor("USD", 2500n);
const ledger = new Ledger();
const pending = ledger.prepare(
  [
    { account: cash, side: "debit", amount },
    { account: revenue, side: "credit", amount },
  ],
  idempotencyKey("invoice-1001"),
);
const posted = ledger.commit(pending, "2026-10-17T13:00:00Z");
ledger.reverse(posted, "2026-10-17T15:00:00Z");
```

## Build

```bash
npm ci
npm test
npm run build
npm run test:types
```

`npm test` is Vitest with coverage thresholds of 90 percent lines and functions. `npm run test:types` is tsd.

## Benchmark

On this machine (Node v25.9.0, 2026-10-17), `npm run bench` posted 20,000 balanced USD entries in 8.2 ms. That is one local run, not a published suite.

## Limits

The currency set is four ISO 4217 alphabetic codes, not the full standard. Amounts are non-negative minor units. The ledger is in memory. A process restart drops every entry. Reverse writes the offset in that same memory store. It is not a durable transaction journal. A reversal key is the original key plus `:rev`, and that key must stay within 80 characters. There is no multi-currency journal entry and no interest or tax rule. A cast can still bypass the brand at runtime. `reverse` reads currency and lines from the stored posted entry. The mixed-currency check runs again inside `prepare` for that case.
