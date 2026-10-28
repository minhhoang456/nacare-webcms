const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const bcrypt = require("bcrypt");
const { validatorCompiler, serializerCompiler } = require("fastify-type-provider-zod");

// Isolate infrastructure while exercising the real authentication middleware.
let writes = [];
let exists = true;
let failure;
for (const [modulePath, exports] of [
  ["../src/utils/prisma.ts", {
    prismaClient: { customer: {
      findUnique: async () => {
        if (failure) throw failure;
        return exists ? { id: 123 } : null;
      },
      update: async (args) => { writes.push(args); return { id: 123 }; },
    } },
  }],
  ["../src/services/user.service.ts", { __esModule: true, default: {
    verifyUserToken: async (token) => {
      if (!["ADMIN", "ROOT", "SHOP", "NORMAL"].includes(token)) {
        throw new Error("Invalid token");
      }
      return { newToken: token, data: { userId: 7, roleSpecial: token } };
    },
  } }],
]) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const register = require("../src/controller/customer/reset-password").default;

test("customer password reset authenticates, authorizes, validates and hashes", async () => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _req, reply) => reply.code(400).send({ message: error.message }));
  app.register(register, { prefix: "/api/customer" });
  const payload = { customerId: 123, newPassword: "NewPass123!", confirmPassword: "NewPass123!" };
  const post = (token, body = payload) => app.inject({
    method: "POST", url: "/api/customer/reset-password", payload: body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  try {
    assert.equal((await post()).statusCode, 403);
    assert.equal((await post("invalid")).statusCode, 403);
    for (const role of ["SHOP", "NORMAL"]) {
      assert.equal((await post(role)).statusCode, 403);
    }
    for (const body of [
      { ...payload, customerId: 0 },
      { ...payload, customerId: 1.5 },
      { ...payload, newPassword: "short" },
      { ...payload, newPassword: "a".repeat(73) },
      { ...payload, newPassword: "ệ".repeat(25) },
      { ...payload, confirmPassword: "Different123!" },
    ]) {
      assert.equal((await post("ADMIN", body)).statusCode, 400);
    }
    exists = false;
    assert.equal((await post("ADMIN")).statusCode, 404);
    exists = true;
    failure = new Error("Database unavailable");
    const failed = await post("ADMIN");
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.body.includes(failure.message), false);
    failure = undefined;
    assert.equal(writes.length, 0);

    for (const role of ["ADMIN", "ROOT"]) {
      const response = await post(role);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().code, 0);
      const saved = writes.at(-1);
      assert.deepEqual(saved.where, { id: 123 });
      assert.deepEqual(Object.keys(saved.data), ["secure"]);
      assert.equal(await bcrypt.compare(payload.newPassword, saved.data.secure), true);
      assert.equal(await bcrypt.compare("OldPassword123!", saved.data.secure), false);
      assert.equal(response.body.includes(saved.data.secure), false);
      assert.equal(response.body.includes(payload.newPassword), false);
    }
    assert.equal(writes.length, 2);
  } finally {
    await app.close();
  }
});
