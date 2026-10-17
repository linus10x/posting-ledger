import { describe, expect, it } from "vitest";
import { openAccount } from "../src/account.js";
import { assertCurrency, formatMinor, isCurrency, add, minor } from "../src/money.js";
import { Ledger, idempotencyKey, type Line, type Pending, type Posted } from "../src/posting.js";

const at = "2026-10-17T13:00:00Z";

function usdBooks() {
  const cash = openAccount("USD", "Cash", "cash-usd");
  const revenue = openAccount("USD", "Revenue", "rev-usd");
  return { cash, revenue };
}

describe("money", () => {
  it("adds minor units of one currency and accepts a known code", () => {
    expect(add(minor("USD", 100n), minor("USD", 25n))).toBe(125n);
    expect(assertCurrency("EUR")).toBe("EUR");
  });

  it("rejects a negative minor amount", () => {
    expect(() => minor("USD", -1n)).toThrow(/zero or greater/);
  });

  it("formats JPY with exponent 0 and USD with exponent 2", () => {
    expect(formatMinor("JPY", minor("JPY", 100n))).toBe("JPY 100");
    expect(formatMinor("USD", minor("USD", 100n))).toBe("USD 1.00");
    expect(formatMinor("EUR", minor("EUR", 5n))).toBe("EUR 0.05");
  });

  it("accepts only the closed ISO 4217 set at runtime", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("USDX")).toBe(false);
    expect(() => assertCurrency("BTC")).toThrow(/does not include BTC/);
  });
});

describe("accounts", () => {
  it("rejects a short id and a blank name", () => {
    expect(() => openAccount("USD", "Cash", "ab")).toThrow(/account id/);
    expect(() => openAccount("GBP", "  ", "cash-gbp")).toThrow(/account name/);
  });
});

describe("postings", () => {
  it("posts a balanced entry once for the same idempotency key", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const key = idempotencyKey("invoice-1001");
    const amount = minor("USD", 2500n);
    const pending = ledger.prepare(
      [
        { account: cash, side: "debit", amount },
        { account: revenue, side: "credit", amount },
      ],
      key,
    );
    const first = ledger.commit(pending, at);
    const again = ledger.commit(pending, "2026-10-17T14:00:00Z");
    expect(first.state).toBe("posted");
    expect(again.at).toBe(at);
    expect(ledger.get(key)?.state).toBe("posted");
    const pendingKey = idempotencyKey("invoice-pend");
    const held = ledger.prepare(
      [
        { account: cash, side: "debit", amount },
        { account: revenue, side: "credit", amount },
      ],
      pendingKey,
    );
    expect(ledger.get(pendingKey)).toBe(held);
  });

  it("returns the same pending entry when prepare is repeated", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const key = idempotencyKey("invoice-1002");
    const amount = minor("USD", 100n);
    const lines = [
      { account: cash, side: "debit" as const, amount },
      { account: revenue, side: "credit" as const, amount },
    ];
    expect(ledger.prepare(lines, key)).toBe(ledger.prepare(lines, key));
  });

  it("throws when debits and credits differ", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    expect(() =>
      ledger.prepare(
        [
          { account: cash, side: "debit", amount: minor("USD", 100n) },
          { account: revenue, side: "credit", amount: minor("USD", 90n) },
        ],
        idempotencyKey("unbalanced"),
      ),
    ).toThrow(/unbalanced posting/);
  });

  it("rejects a line whose account currency does not match the posting", () => {
    const { cash } = usdBooks();
    const eur = openAccount("EUR", "Cash", "cash-eur");
    const ledger = new Ledger();
    const lines = [
      { account: cash, side: "debit" as const, amount: minor("USD", 100n) },
      {
        account: eur,
        side: "credit" as const,
        amount: minor("EUR", 100n),
      },
    ] as unknown as readonly Line<"USD">[];
    expect(() => ledger.prepare(lines, idempotencyKey("mixed-ccy"))).toThrow(/mixed currency/);
  });

  it("throws on a one-line or zero-amount posting", () => {
    const { cash } = usdBooks();
    const ledger = new Ledger();
    expect(() =>
      ledger.prepare(
        [{ account: cash, side: "debit", amount: minor("USD", 100n) }],
        idempotencyKey("one-line"),
      ),
    ).toThrow(/at least two lines/);
    const other = openAccount("USD", "Fees", "fees-usd");
    expect(() =>
      ledger.prepare(
        [
          { account: cash, side: "debit", amount: minor("USD", 0n) },
          { account: other, side: "credit", amount: minor("USD", 0n) },
        ],
        idempotencyKey("zero-line"),
      ),
    ).toThrow(/greater than zero/);
  });

  it("rejects a key that is already posted and a key that is too short", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const key = idempotencyKey("invoice-1003");
    const amount = minor("GBP", 10n);
    const gbpCash = openAccount("GBP", "Cash", "cash-gbp");
    const gbpRev = openAccount("GBP", "Revenue", "rev-gbp");
    const pending = ledger.prepare(
      [
        { account: gbpCash, side: "debit", amount },
        { account: gbpRev, side: "credit", amount },
      ],
      key,
    );
    ledger.commit(pending, at);
    expect(() =>
      ledger.prepare(
        [
          { account: cash, side: "debit", amount: minor("USD", 10n) },
          { account: revenue, side: "credit", amount: minor("USD", 10n) },
        ],
        key,
      ),
    ).toThrow(/already posted/);
    expect(() => idempotencyKey("short")).toThrow(/idempotency key/);
  });

  it("reverses a posted entry once and refuses an unknown commit", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const key = idempotencyKey("invoice-1004");
    const amount = minor("USD", 400n);
    const pending = ledger.prepare(
      [
        { account: cash, side: "debit", amount },
        { account: revenue, side: "credit", amount },
      ],
      key,
    );
    const posted = ledger.commit(pending, at);
    const reversed = ledger.reverse(posted, "2026-10-17T15:00:00Z");
    expect(reversed.state).toBe("reversed");
    expect(reversed.reverses).toBe(key);
    expect(reversed.key).toBe(idempotencyKey("invoice-1004:rev"));
    expect(reversed.lines[0]?.side).toBe("credit");
    expect(reversed.lines[1]?.side).toBe("debit");
    expect(reversed.lines[0]?.amount).toBe(amount);
    expect(ledger.get(key)?.state).toBe("posted");
    expect(ledger.get(key)?.lines[0]?.side).toBe("debit");
    expect(ledger.get(reversed.key)?.state).toBe("reversed");
    expect(ledger.reverse(posted, "2026-10-17T16:00:00Z").at).toBe("2026-10-17T15:00:00Z");
    const stray = { ...pending, key: idempotencyKey("missing-01") };
    expect(() => ledger.commit(stray, at)).toThrow(/unknown pending/);
    expect(() => ledger.reverse({ ...posted, key: idempotencyKey("missing-02") }, at)).toThrow(
      /only a posted entry/,
    );
  });

  it("refuses prepare after reverse and commit of a forged pending shape still checks the store", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const key = idempotencyKey("invoice-1005");
    const amount = minor("USD", 100n);
    const pending = ledger.prepare(
      [
        { account: cash, side: "debit", amount },
        { account: revenue, side: "credit", amount },
      ],
      key,
    );
    const posted = ledger.commit(pending, at);
    ledger.reverse(posted, at);
    expect(() =>
      ledger.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        key,
      ),
    ).toThrow(/already posted/);
    expect(() =>
      ledger.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        idempotencyKey("invoice-1005:rev"),
      ),
    ).toThrow(/already reversed/);
  });

  it("reads the stored currency and keeps both entries", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const key = idempotencyKey("invoice-1006");
    const amount = minor("USD", 50n);
    const posted = ledger.commit(
      ledger.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        key,
      ),
      at,
    );
    const forged = { ...posted, currency: "EUR" as const };
    const reversed = ledger.reverse(forged as Posted<"EUR">, at);
    expect(reversed.currency).toBe("USD");
    expect(ledger.get(key)?.currency).toBe("USD");
  });

  it("rejects a reversal key that does not fit or is already used", () => {
    const { cash, revenue } = usdBooks();
    const ledger = new Ledger();
    const longKey = idempotencyKey("k".repeat(78));
    const amount = minor("USD", 10n);
    const posted = ledger.commit(
      ledger.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        longKey,
      ),
      at,
    );
    expect(() => ledger.reverse(posted, at)).toThrow(/reversal key/);

    const other = new Ledger();
    const original = idempotencyKey("invoice-1007");
    other.commit(
      other.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        idempotencyKey("invoice-1007:rev"),
      ),
      at,
    );
    const target = other.commit(
      other.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        original,
      ),
      at,
    );
    expect(() => other.reverse(target, at)).toThrow(/reversal key already used/);

    const pendingLedger = new Ledger();
    pendingLedger.prepare(
      [
        { account: cash, side: "debit", amount },
        { account: revenue, side: "credit", amount },
      ],
      idempotencyKey("invoice-1008:rev"),
    );
    const pendingTarget = pendingLedger.commit(
      pendingLedger.prepare(
        [
          { account: cash, side: "debit", amount },
          { account: revenue, side: "credit", amount },
        ],
        idempotencyKey("invoice-1008"),
      ),
      at,
    );
    expect(() => pendingLedger.reverse(pendingTarget, at)).toThrow(/reversal key already used/);
  });
});

describe("state types", () => {
  it("keeps pending and posted as distinct states", () => {
    const pending: Pending<"USD"> = {
      state: "pending",
      key: idempotencyKey("type-check"),
      currency: "USD",
      lines: [],
    };
    const posted: Posted<"USD"> = {
      state: "posted",
      key: pending.key,
      currency: "USD",
      lines: [],
      at,
    };
    expect(pending.state).not.toBe(posted.state);
  });
});
