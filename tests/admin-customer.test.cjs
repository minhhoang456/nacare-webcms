const assert = require('node:assert/strict')
const test = require('node:test')
const Fastify = require('fastify')
const bcrypt = require('bcrypt')
const { Prisma } = require('@prisma/client')
const {
  validatorCompiler,
  serializerCompiler,
} = require('fastify-type-provider-zod')

const customer = {
  id: 123,
  email: 'customer@example.com',
  phone: '0912345678',
  merchantRef: 'legacy-ref',
  secure: 'stored-hash',
  cccd: '123456789012',
  addresses: [{ id: 1 }],
  bankAccounts: [{ id: 2 }],
}
let exists = true
let duplicate = false
let failure
let updateFailure
let createFailure
const reads = []
const writes = []
const deletedKeys = []
const createdCustomers = []

for (const [modulePath, exports] of [
  [
    '../src/helpers/inviteCode.helper.ts',
    { generateUniqueCustomerInviteCode: async () => 'NEWCODE01' },
  ],
  [
    '../src/utils/prisma.ts',
    {
      prismaClient: {
        customer: {
          findFirst: async (args) => {
            if (failure) throw failure
            reads.push(args)
            return args.where.OR
              ? duplicate
                ? { id: 456 }
                : null
              : exists
                ? customer
                : null
          },
          findUnique: async () => {
            if (failure) throw failure
            return exists ? customer : null
          },
          update: async (args) => {
            if (updateFailure) throw updateFailure
            writes.push(args)
            return {
              id: 123,
              email: args.data.email ?? customer.email,
              phone: args.data.phone ?? customer.phone,
            }
          },
        },
      },
    },
  ],
  [
    '../src/utils/redis.ts',
    {
      __esModule: true,
      default: {
        del: async (...keys) => {
          deletedKeys.push(keys)
          return keys.length
        },
      },
    },
  ],
  [
    '../src/services/customer.service.ts',
    {
      __esModule: true,
      default: {
        getCustomerKey: (id) => `customer_info_${id}`,
        getCustomerRef: (ref) => `customer_ref_${ref}`,
      },
    },
  ],
  [
    '../src/services/user.service.ts',
    {
      __esModule: true,
      default: {
        verifyUserToken: async (token) => {
          if (!['ADMIN', 'ROOT', 'SHOP', 'NORMAL'].includes(token))
            throw new Error('Invalid token')
          return { newToken: token, data: { userId: 7, roleSpecial: token } }
        },
      },
    },
  ],
]) {
  const id = require.resolve(modulePath)
  require.cache[id] = { id, filename: id, loaded: true, exports }
}

const prisma = require('../src/utils/prisma.ts').prismaClient
prisma.$transaction = async (callback) => callback(prisma)
prisma.$queryRaw = async () => [{ locked: 1 }]
prisma.customer.create = async ({ data }) => {
  if (createFailure) throw createFailure
  createdCustomers.push(data)
  return {
    id: 789,
    name: data.name,
    phone: data.phone,
    email: data.email ?? null,
    inviteCode: data.inviteCode,
  }
}

test('admin customer lookup and update enforce access, validation, uniqueness and credential safety', async () => {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler((_error, _req, reply) =>
    reply.code(400).send({ code: 1 }),
  )
  const loggingFlags = []
  app.addHook('onSend', async (req, _reply, payload) => {
    loggingFlags.push(req.notSaveRequestLog)
    return payload
  })
  app.register(require('@fastify/autoload'), {
    dir: require('node:path').join(
      __dirname,
      '../src/controller/admin/customer',
    ),
    options: { prefix: '/api/admin/customer' },
    forceESM: false,
  })
  const get = (token = 'ADMIN', query = 'email=customer%40example.com') =>
    app.inject({
      method: 'GET',
      url: `/api/admin/customer/find?${query}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  const put = (payload, token = 'ADMIN') =>
    app.inject({
      method: 'PUT',
      url: '/api/admin/customer/update',
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  try {
    for (const token of ['', 'invalid', 'SHOP', 'NORMAL']) {
      assert.equal((await get(token)).statusCode, 403)
      assert.equal(
        (await put({ customerId: 123, secure: 'Password123!' }, token))
          .statusCode,
        403,
      )
    }
    assert.equal(reads.length, 0)
    for (const query of [
      '',
      'email=invalid',
      'phone=123',
      'email=a%40b.com&phone=0912345678',
    ]) {
      assert.equal((await get('ADMIN', query)).statusCode, 400)
    }
    for (const payload of [
      { customerId: 123 },
      { customerId: 0, email: 'a@b.com' },
      { customerId: 1.5, email: 'a@b.com' },
      { customerId: 123, email: 'invalid' },
      { customerId: 123, phone: '' },
      { customerId: 123, secure: '' },
      { customerId: 123, secure: 'ệ'.repeat(25) },
      { customerId: 123, secure: 'a'.repeat(73) },
      { customerId: 123, email: null },
      { customerId: 123, name: 'Not allowed' },
    ])
      assert.equal((await put(payload)).statusCode, 400)

    for (const token of ['ADMIN', 'ROOT']) {
      const response = await get(token)
      assert.equal(response.statusCode, 200)
      const { secure, ...expected } = customer
      assert.deepEqual(response.json().data, { ...expected, hasPassword: true })
      assert.equal(response.body.includes(secure), false)
    }
    for (const phone of ['0912345678', '84912345678']) {
      assert.equal((await get('ADMIN', `phone=${phone}`)).statusCode, 200)
      assert.deepEqual(reads.at(-1).where, {
        phone: { in: ['0912345678', '84912345678'] },
      })
    }
    exists = false
    assert.equal((await get()).statusCode, 404)
    assert.equal(
      (await put({ customerId: 123, email: 'a@b.com' })).statusCode,
      404,
    )
    exists = true
    duplicate = true
    assert.equal(
      (await put({ customerId: 123, phone: '84912345678' })).statusCode,
      409,
    )
    assert.deepEqual(reads.at(-1).where, {
      id: { not: 123 },
      OR: [{ phone: { in: ['0912345678', '84912345678'] } }],
    })
    duplicate = false
    failure = new Error('Internal database detail')
    for (const response of [
      await get(),
      await put({ customerId: 123, secure: 'Pass123!' }),
    ]) {
      assert.equal(response.statusCode, 500)
      assert.equal(response.body.includes(failure.message), false)
    }
    failure = undefined
    assert.equal(writes.length, 0)
    for (const [code, status] of [
      ['P2002', 409],
      ['P2025', 404],
    ]) {
      updateFailure = new Prisma.PrismaClientKnownRequestError(
        'Concurrent change',
        { code, clientVersion: '5.22.0' },
      )
      assert.equal(
        (await put({ customerId: 123, email: 'a@b.com' })).statusCode,
        status,
      )
    }
    updateFailure = undefined
    assert.equal(deletedKeys.length, 0)

    const payload = {
      customerId: 123,
      email: 'new@example.com',
      phone: '84912345678',
      secure: 'NewPass123!',
    }
    const response = await put(payload, 'ROOT')
    assert.equal(response.statusCode, 200)
    assert.equal(writes.at(-1).data.phone, '0912345678')
    assert.equal(writes.at(-1).data.email, payload.email)
    assert.equal(
      await bcrypt.compare(payload.secure, writes.at(-1).data.secure),
      true,
    )
    assert.equal(response.body.includes(payload.secure), false)
    assert.equal(response.body.includes(writes.at(-1).data.secure), false)
    assert.deepEqual(deletedKeys.at(-1), [
      'customer_info_123',
      'customer_ref_legacy-ref',
    ])
    assert.equal(
      (await put({ customerId: 123, email: 'email-only@example.com' }))
        .statusCode,
      200,
    )
    assert.deepEqual(writes.at(-1).data, { email: 'email-only@example.com' })
    assert.equal(
      (await put({ customerId: 123, secure: 'PasswordOnly!' })).statusCode,
      200,
    )
    assert.deepEqual(Object.keys(writes.at(-1).data), ['secure'])
    assert.equal(loggingFlags.every(Boolean), true)
  } finally {
    await app.close()
  }
})

test('admin customer creation normalizes phones, prevents duplicates and protects credentials', async () => {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  const loggingFlags = []
  app.addHook('onSend', async (req, _reply, payload) => {
    loggingFlags.push(req.notSaveRequestLog)
    return payload
  })
  app.register(require('../src/controller/admin/customer/account.ts').default, {
    prefix: '/api/admin/customer',
  })
  const post = (payload, token = 'ADMIN') =>
    app.inject({
      method: 'POST',
      url: '/api/admin/customer/create',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    })
  try {
    for (const token of ['', 'invalid', 'SHOP', 'NORMAL']) {
      assert.equal((await post({ phone: '0912345678' }, token)).statusCode, 403)
    }
    for (const payload of [
      {},
      { phone: '123' },
      { phone: '0912345678', secure: 'short' },
      { phone: '0912345678', secure: 'ệ'.repeat(25) },
      { phone: '0912345678', email: 'invalid' },
      { phone: '0912345678', name: ' ' },
      { phone: '0912345678', inviteCode: 'UNTRUSTED' },
    ]) {
      assert.equal((await post(payload)).statusCode, 400)
    }
    assert.equal(createdCustomers.length, 0)
    duplicate = true
    assert.equal((await post({ phone: '84912345678' })).statusCode, 409)
    assert.deepEqual(reads.at(-1).where.OR, [
      { phone: { in: ['0912345678', '84912345678'] } },
      { merchantRef: { in: ['0912345678', '84912345678'] } },
    ])
    duplicate = false
    const withoutPassword = await post({ phone: '84912345678' })
    assert.equal(withoutPassword.statusCode, 201)
    assert.equal(withoutPassword.json().data.hasPassword, false)
    assert.equal(withoutPassword.json().data.phone, '0912345678')
    assert.equal(createdCustomers.at(-1).secure, null)
    assert.equal(createdCustomers.at(-1).merchantRef, '0912345678')
    assert.equal(createdCustomers.at(-1).isBlock, false)

    const password = 'NewCustomer123!'
    const withPassword = await post(
      {
        phone: '0912345678',
        email: 'new@example.com',
        name: 'New',
        secure: password,
      },
      'ROOT',
    )
    assert.equal(withPassword.statusCode, 201)
    assert.equal(withPassword.json().data.hasPassword, true)
    assert.equal(
      await bcrypt.compare(password, createdCustomers.at(-1).secure),
      true,
    )
    assert.equal(withPassword.body.includes(password), false)
    assert.equal(
      withPassword.body.includes(createdCustomers.at(-1).secure),
      false,
    )
    assert.equal('secure' in withPassword.json().data, false)
    assert.equal(
      reads.at(-1).where.OR.some((item) => item.email === 'new@example.com'),
      true,
    )

    createFailure = new Prisma.PrismaClientKnownRequestError(
      'Concurrent duplicate',
      {
        code: 'P2002',
        clientVersion: '5.22.0',
      },
    )
    assert.equal((await post({ phone: '0912345678' })).statusCode, 409)
    createFailure = new Error('Private database failure')
    const failed = await post({ phone: '0912345678' })
    assert.equal(failed.statusCode, 500)
    assert.equal(failed.body.includes(createFailure.message), false)
    assert.equal(loggingFlags.every(Boolean), true)
  } finally {
    createFailure = undefined
    await app.close()
  }
})
