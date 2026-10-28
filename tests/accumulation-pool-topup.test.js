const assert = require("node:assert/strict");
const test = require("node:test");
const {
  businessDateFromTimestamp,
  manualPoolAfterAdjustment,
} = require("../src/services/accumulationPoolTopup.core");

test("Vietnam date stores the contribution on its actual local day", () => {
  assert.equal(
    businessDateFromTimestamp(Date.parse("2026-10-14T17:00:00Z")),
    "2026-10-15",
  );
  assert.equal(
    businessDateFromTimestamp(Date.parse("2026-10-15T16:59:59Z")),
    "2026-10-15",
  );
  assert.equal(
    businessDateFromTimestamp(Date.parse("2026-10-15T17:00:00Z")),
    "2026-10-16",
  );
});

test("admin credits and debits only the same-day manual net pool", () => {
  let total = BigInt(0);
  assert.equal(manualPoolAfterAdjustment(total, -1), null);
  total = manualPoolAfterAdjustment(total, 500_000);
  total = manualPoolAfterAdjustment(total, 250_000);
  assert.equal(total, BigInt(750_000));
  assert.equal(manualPoolAfterAdjustment(total, -750_001), null);
  total = manualPoolAfterAdjustment(total, -750_000);
  assert.equal(total, BigInt(0));
  assert.equal(manualPoolAfterAdjustment(total, -1), null);

  // A different date starts from its own sum, not yesterday's balance.
  assert.equal(manualPoolAfterAdjustment(BigInt(0), -1), null);
});

test("admin adjustment rejects zero, fractional, unsafe and overflowing amounts", () => {
  for (const amount of [0, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.throws(() => manualPoolAfterAdjustment(BigInt(0), amount));
  }
  assert.throws(() =>
    manualPoolAfterAdjustment(BigInt(Number.MAX_SAFE_INTEGER), 1),
  );
});
