const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const {
  validatorCompiler,
  serializerCompiler,
} = require("fastify-type-provider-zod");
// The real Prisma and authentication modules initialize Redis/service clients
// at import time. Stub them before loading the route: this suite must never
// connect to DB, Redis, or any external service.
for (const [modulePath, exports] of [
  ["../src/utils/prisma.ts", { prismaClient: {} }],
  ["../src/middleware/user.ts", { default: async () => {} }],
]) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const {
  registerTopupRoutes,
} = require("../src/controller/admin/commission-pools/topups");

function fakeStore() {
  const entries = [];
  let status = null;
  const tx = {
    commissionRun: {
      findUnique: async () => (status ? { status } : null),
    },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) return [{ locked: 1 }];
      if (sql.includes('WHERE "idempotencyKey"')) {
        return entries.filter((entry) => entry.key === values[0]);
      }
      if (sql.includes('SUM("amount")')) {
        return [{
          amount: entries
            .filter((entry) => entry.date === values[0])
            .reduce((sum, entry) => sum + entry.amount, BigInt(0)),
        }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    $executeRaw: async (_strings, ...values) => {
      const [id, key, date, amount] = values;
      entries.push({ id, key, date, amount });
      return 1;
    },
  };
  return {
    entries,
    client: { $transaction: async (callback) => callback(tx) },
    setStatus: (value) => { status = value; },
  };
}

async function buildApp(store, clock, role = "ROOT") {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerTopupRoutes(app, {
    client: store.client,
    now: () => clock.value,
    middleware: async (req) => {
      req.roleSpecial = role;
      req.userId = 7;
    },
  });
  await app.ready();
  return app;
}

async function post(app, amount, requestId) {
  const response = await app.inject({
    method: "POST",
    url: "/topups",
    payload: { amount, requestId },
  });
  return { status: response.statusCode, body: response.json() };
}

test("admin topup HTTP flow is date-scoped and never writes to a database", async () => {
  const store = fakeStore();
  const clock = { value: Date.parse("2026-10-15T09:00:00+07:00") };
  const app = await buildApp(store, clock);
  try {
    assert.equal((await post(app, -1, "before-credit")).status, 400);
    assert.equal(store.entries.length, 0);
    assert.equal((await post(app, 500_000, "credit-1")).body.data.totalManualPoolAmount, 500_000);
    assert.equal((await post(app, 250_000, "credit-2")).body.data.totalManualPoolAmount, 750_000);
    assert.equal((await post(app, -750_001, "too-much")).status, 400);
    assert.equal((await post(app, -750_000, "debit-all")).body.data.totalManualPoolAmount, 0);
    assert.equal((await post(app, -1, "after-zero")).status, 400);
    assert.equal(store.entries.length, 3);

    assert.equal((await post(app, 500_000, "credit-1")).status, 409);
    assert.equal(store.entries.length, 3);

    clock.value = Date.parse("2026-10-16T00:00:00+07:00");
    assert.equal((await post(app, -1, "new-day-debit")).status, 400);
    const nextDay = await post(app, 100, "new-day-credit");
    assert.equal(nextDay.status, 200);
    assert.equal(nextDay.body.data.calculationDate, "2026-10-16");
    assert.equal(nextDay.body.data.totalManualPoolAmount, 100);

    store.setStatus("calculating");
    assert.equal((await post(app, 1, "after-claim")).status, 409);
    store.setStatus("completed");
    assert.equal((await post(app, -1, "after-settle")).status, 409);
    assert.equal(store.entries.length, 4);
  } finally {
    await app.close();
  }
});

test("admin topup HTTP rejects invalid amounts and non-admin role", async () => {
  const store = fakeStore();
  const clock = { value: Date.parse("2026-10-15T09:00:00+07:00") };
  const app = await buildApp(store, clock, "CUSTOMER");
  try {
    assert.equal((await post(app, 100, "not-admin")).status, 403);
    assert.equal(store.entries.length, 0);
  } finally {
    await app.close();
  }
  const adminApp = await buildApp(store, clock);
  try {
    for (const amount of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal((await post(adminApp, amount, `invalid-${amount}`)).status, 400);
    }
    assert.equal(store.entries.length, 0);
  } finally {
    await adminApp.close();
  }
});
