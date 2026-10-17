import { Ledger, idempotencyKey, minor, openAccount } from "../dist/index.js";

const cash = openAccount("USD", "Cash", "cash-usd");
const revenue = openAccount("USD", "Revenue", "rev-usd");
const amount = minor("USD", 100n);
const lines = [
  { account: cash, side: "debit", amount },
  { account: revenue, side: "credit", amount },
];
const ledger = new Ledger();
const n = 20000;
const start = performance.now();
for (let i = 0; i < n; i += 1) {
  const key = idempotencyKey(`bench-${i.toString().padStart(8, "0")}`);
  ledger.commit(ledger.prepare(lines, key), "2026-10-17T13:00:00Z");
}
const elapsed = performance.now() - start;
console.log(`posting-ledger ${n} balanced posts in ${elapsed.toFixed(1)} ms`);
