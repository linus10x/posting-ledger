import { expectType } from "tsd";
import { openAccount } from "../src/account.js";
import { add, minor, type Minor } from "../src/money.js";
import { Ledger, idempotencyKey, type Line, type Pending, type Posted } from "../src/posting.js";

const usd = minor("USD", 100n);
const eur = minor("EUR", 100n);
expectType<Minor<"USD">>(usd);

// @ts-expect-error USD and EUR are different brands
add(usd, eur);

// @ts-expect-error USDX is not in the closed ISO 4217 set
minor("USDX", 1n);

const usCash = openAccount("USD", "Cash", "cash-usd");
const euCash = openAccount("EUR", "Cash", "cash-eur");

function usdLine(line: Line<"USD">): Line<"USD"> {
  return line;
}

// @ts-expect-error a EUR account cannot sit on a USD line
usdLine({ account: euCash, side: "debit", amount: usd });

declare const pending: Pending<"USD">;
declare const posted: Posted<"USD">;
const ledger = new Ledger();

// @ts-expect-error reverse accepts a posted entry, not a pending one
ledger.reverse(pending, "2026-10-17T13:00:00Z");

expectType<Posted<"USD">>(ledger.commit(pending, "2026-10-17T13:00:00Z"));
expectType<ReturnType<typeof idempotencyKey>>(posted.key);
void usCash;
