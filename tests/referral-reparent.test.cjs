const assert = require('node:assert/strict')
const test = require('node:test')
const Fastify = require('fastify')
const { Prisma } = require('@prisma/client')
const {
  validatorCompiler,
  serializerCompiler,
} = require('fastify-type-provider-zod')

let customers
let edges
let hasCycle
let failWriteAt
let queryFailure
let writes
let rawCalls
let rollbacks

function reset() {
  customers = [1, 2, 3, 4, 5].map((id) => ({
    id,
    inviteCode: `INVITE${id}`,
    isBlock: false,
  }))
  edges = [
    { referredCustomerId: 2, referrerCustomerId: 1, inviteCode: 'INVITE1' },
    { referredCustomerId: 3, referrerCustomerId: 1, inviteCode: 'INVITE1' },
    { referredCustomerId: 4, referrerCustomerId: 3, inviteCode: 'INVITE3' },
  ]
  hasCycle = false
  failWriteAt = undefined
  queryFailure = undefined
  writes = 0
  rawCalls = []
  rollbacks = 0
}

function beforeWrite() {
  writes++
  if (writes === failWriteAt) throw new Error('Private database failure')
}

const prismaClient = {
  $transaction: async (callback) => {
    const previous = structuredClone(edges)
    try {
      return await callback(prismaClient)
    } catch (error) {
      edges = previous
      rollbacks++
      throw error
    }
  },
  $queryRaw: async (query) => {
    if (queryFailure) throw queryFailure
    rawCalls.push(query)
    if (query.text.includes('FROM customer'))
      return customers.filter((customer) => query.values.includes(customer.id))
    if (query.text.includes('WITH RECURSIVE')) return [{ hasCycle }]
    return []
  },
  referral: {
    findMany: async ({ where }) =>
      edges.filter((edge) =>
        where.referredCustomerId.in.includes(edge.referredCustomerId),
      ),
    create: async ({ data }) => {
      beforeWrite()
      assert.equal(
        edges.some(
          (edge) => edge.referredCustomerId === data.referredCustomerId,
        ),
        false,
      )
      edges.push(data)
      return data
    },
    updateMany: async ({ where, data }) => {
      beforeWrite()
      const edge = edges.find(
        (item) =>
          item.referredCustomerId === where.referredCustomerId &&
          item.referrerCustomerId === where.referrerCustomerId,
      )
      if (!edge) return { count: 0 }
      Object.assign(edge, data)
      return { count: 1 }
    },
  },
}

for (const [path, exports] of [
  ['../src/utils/prisma.ts', { prismaClient }],
  [
    '../src/services/user.service.ts',
    {
      __esModule: true,
      default: {
        verifyUserToken: async (token) => {
          if (!['ADMIN', 'ROOT', 'SHOP'].includes(token))
            throw new Error('Invalid token')
          return { newToken: token, data: { userId: 7, roleSpecial: token } }
        },
      },
    },
  ],
]) {
  const id = require.resolve(path)
  require.cache[id] = { id, filename: id, loaded: true, exports }
}

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.register(
    require('../src/controller/admin/referral/reparent.ts').default,
    {
      prefix: '/api/admin/referral',
    },
  )
  return app
}

const changes = [
  { customerId: 3, referrerCustomerId: 2, expectedReferrerCustomerId: 1 },
  { customerId: 5, referrerCustomerId: 3, expectedReferrerCustomerId: null },
]

function put(app, body = {}, token = 'ROOT') {
  return app.inject({
    method: 'PUT',
    url: '/api/admin/referral/reparent',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: { changes, reason: 'Correct referral links', ...body },
  })
}

test('reparent requires admin access and validates changes before reading data', async () => {
  reset()
  const app = await buildApp()
  try {
    for (const token of ['', 'invalid', 'SHOP']) {
      assert.equal((await put(app, {}, token)).statusCode, 403)
    }
    for (const body of [
      { changes: [] },
      { changes: Array(51).fill(changes[0]) },
      { changes: [changes[0], changes[0]] },
      { changes: [{ customerId: 3, referrerCustomerId: 2 }] },
      { changes: [{ ...changes[0], customerId: 2147483648 }] },
      { changes: [{ ...changes[0], customerId: 1.5 }] },
      { changes: [{ ...changes[0], referrerCustomerId: null }] },
      { reason: ' ' },
      { dryRun: 'false' },
      { unexpected: true },
    ]) {
      assert.equal((await put(app, body)).statusCode, 400)
    }
    assert.equal(rawCalls.length, 0)
    assert.equal(writes, 0)
  } finally {
    await app.close()
  }
})

test('reparent defaults to preview and commits all moves while preserving existing descendants', async () => {
  reset()
  const app = await buildApp()
  try {
    const before = structuredClone(edges)
    const preview = await put(app)
    assert.equal(preview.statusCode, 200)
    assert.equal(preview.json().data.dryRun, true)
    assert.equal(
      preview.json().data.changes.every((item) => item.changed),
      true,
    )
    assert.deepEqual(edges, before)
    assert.equal(writes, 0)
    assert.equal(rawCalls[0].values[0], '724656337252656101')
    const validation = rawCalls.find((query) =>
      query.text.includes('WITH RECURSIVE'),
    )
    assert.deepEqual(JSON.parse(validation.values[0]), changes)

    const applied = await put(app, { dryRun: false }, 'ADMIN')
    assert.equal(applied.statusCode, 200)
    assert.equal(writes, 2)
    assert.deepEqual(
      edges.find((edge) => edge.referredCustomerId === 3),
      {
        referredCustomerId: 3,
        referrerCustomerId: 2,
        inviteCode: 'INVITE2',
      },
    )
    assert.deepEqual(
      edges.find((edge) => edge.referredCustomerId === 5),
      {
        referredCustomerId: 5,
        referrerCustomerId: 3,
        inviteCode: 'INVITE3',
      },
    )
    assert.deepEqual(
      edges.find((edge) => edge.referredCustomerId === 4),
      before[2],
    )
    const retry = await put(app, { dryRun: false })
    assert.equal(retry.statusCode, 200)
    assert.equal(
      retry.json().data.changes.every((item) => !item.changed),
      true,
    )
    assert.equal(writes, 2)
  } finally {
    await app.close()
  }
})

test('reparent rejects missing accounts, blocked accounts, stale parents and database cycle detection without writes', async () => {
  const app = await buildApp()
  try {
    reset()
    customers.pop()
    assert.equal((await put(app, { dryRun: false })).statusCode, 404)
    assert.equal(writes, 0)
    reset()
    customers[1].isBlock = true
    assert.equal((await put(app, { dryRun: false })).statusCode, 409)
    assert.equal(writes, 0)
    reset()
    assert.equal(
      (
        await put(app, {
          changes: [{ ...changes[0], expectedReferrerCustomerId: null }],
          dryRun: false,
        })
      ).statusCode,
      409,
    )
    assert.equal(writes, 0)
    reset()
    hasCycle = true
    assert.equal((await put(app, { dryRun: false })).statusCode, 409)
    assert.equal(writes, 0)
  } finally {
    await app.close()
  }
})

test('reparent rolls back the entire batch on failure and does not expose internal errors', async () => {
  reset()
  const app = await buildApp()
  try {
    const before = structuredClone(edges)
    failWriteAt = 2
    const failed = await put(app, { dryRun: false })
    assert.equal(failed.statusCode, 500)
    assert.equal(failed.body.includes('Private database failure'), false)
    assert.equal(rollbacks, 1)
    assert.deepEqual(edges, before)
    for (const code of ['P2002', 'P2034']) {
      reset()
      queryFailure = new Prisma.PrismaClientKnownRequestError(
        'Concurrent change',
        {
          code,
          clientVersion: '5.22.0',
        },
      )
      assert.equal((await put(app, { dryRun: false })).statusCode, 409)
      assert.equal(writes, 0)
    }
  } finally {
    await app.close()
  }
})
