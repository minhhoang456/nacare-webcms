const assert = require('node:assert/strict')
const test = require('node:test')
const { Readable } = require('node:stream')
const dns = require('node:dns/promises')
const axios = require('axios').default
const Fastify = require('fastify')
const {
  validatorCompiler,
  serializerCompiler
} = require('fastify-type-provider-zod')

const originalGet = axios.get
const originalLookup = dns.lookup
const downloader = require('../src/utils/downloadImageFromUrl')
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
let download = downloader.default
let uploadResult = {
  fullUrl: 'https://storage.example/image.png',
  fileName: 'uuid_image.png',
  key: 'folder/uuid_image.png'
}
let databaseFailure = false
let cleanupFailure = false
let saves = []
let removals = []
let uploads = []
let requestLogSuppressed = false

for (const [modulePath, exports] of [
  [
    '../src/utils/aws.ts',
    {
      default: {
        upload: async (image) => {
          uploads.push(image)
          return uploadResult
        },
        deleteObject: async (key) => {
          removals.push(key)
          if (cleanupFailure) throw new Error('Sensitive cleanup details')
        }
      }
    }
  ],
  [
    '../src/utils/prisma.ts',
    {
      prismaClient: {
        fileupload: {
          create: async ({ data }) => {
            if (databaseFailure) throw new Error('Sensitive database details')
            saves.push(data)
            return { id: 123, ...data }
          }
        }
      }
    }
  ],
  [
    '../src/middleware/user.ts',
    {
      default: async (req, reply) => {
        requestLogSuppressed = req.notSaveRequestLog
        if (req.headers.authorization !== 'Bearer ADMIN')
          return reply.code(403).send({ code: 403, message: 'Forbidden' })
        req.userId = 7
      }
    }
  ]
]) {
  const id = require.resolve(modulePath)
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports: { __esModule: true, ...exports }
  }
}
const downloadId = require.resolve('../src/utils/downloadImageFromUrl')
require.cache[downloadId].exports = {
  __esModule: true,
  ...downloader,
  default: async (url) => download(url)
}
const register = require('../src/controller/file/upload-image-from-url').default

test('URL image download validates addresses, signatures and bounded streams', async (t) => {
  t.after(() => {
    axios.get = originalGet
    dns.lookup = originalLookup
  })
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.100.100.200',
    '192.168.1.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2002:7f00:1::'
  ]) {
    assert.equal(downloader.isPublicImageAddress(address), false, address)
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(downloader.isPublicImageAddress(address), true, address)
  }
  for (const [buffer, extension] of [
    [png, 'png'],
    [Buffer.from('ffd8ffe0', 'hex'), 'jpg'],
    [Buffer.from('GIF89a'), 'gif'],
    [Buffer.from('RIFF1234WEBP'), 'webp']
  ])
    assert.equal(downloader.detectImageExtension(buffer), extension)
  assert.throws(() => downloader.detectImageExtension(Buffer.from('<html>')), {
    statusCode: 415
  })

  axios.get = async () => {
    throw new Error('Request should not be made')
  }
  for (const url of [
    'invalid',
    'file:///tmp/photo',
    'http://127.1/image',
    'http://[::1]/',
    'http://user:pass@example.com/',
    'http://example.com:8080/'
  ]) {
    await assert.rejects(downloader.default(url), { statusCode: 400 })
  }
  let lookupFunction
  axios.get = async (_url, options) => {
    assert.equal(options.maxRedirects, 0)
    assert.equal(options.proxy, false)
    assert.equal(options.httpsAgent.options.rejectUnauthorized, true)
    assert.equal(options.httpAgent.options.autoSelectFamily, false)
    lookupFunction = options.httpAgent.options.lookup
    return { status: 200, headers: {}, data: Readable.from([png]) }
  }
  const image = await downloader.default(
    'https://example.com/photo?token=SECRET'
  )
  assert.equal(image.fileName, 'image.png')
  assert.deepEqual(image.buffer, png)
  const resolve = () =>
    new Promise((resolve, reject) =>
      lookupFunction('example.com', {}, (error, address) =>
        error ? reject(error) : resolve(address)
      )
    )
  dns.lookup = async () => [{ address: '127.0.0.1', family: 4 }]
  await assert.rejects(resolve(), { statusCode: 400 })
  dns.lookup = async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.1', family: 4 }
  ]
  await assert.rejects(resolve(), { statusCode: 400 })
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }]
  assert.equal(await resolve(), '8.8.8.8')

  for (const [status, headers, chunks, expected] of [
    [302, { location: 'http://127.0.0.1' }, [], 422],
    [404, {}, [], 422],
    [200, { 'content-length': 10 * 1024 * 1024 + 1 }, [], 413],
    [
      200,
      {},
      [Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(5 * 1024 * 1024)],
      413
    ],
    [200, { 'content-type': 'image/png' }, [Buffer.from('<html>')], 415]
  ]) {
    const stream = Readable.from(chunks)
    axios.get = async () => ({ status, headers, data: stream })
    await assert.rejects(downloader.default('https://example.com/image'), {
      statusCode: expected
    })
    assert.equal(stream.destroyed, true)
  }
  axios.get = async () => {
    throw new axios.AxiosError('Timeout', 'ECONNABORTED')
  }
  await assert.rejects(downloader.default('https://example.com/image'), {
    statusCode: 504
  })
  axios.get = async () => {
    throw new Error('Sensitive network details')
  }
  await assert.rejects(downloader.default('https://example.com/image'), {
    statusCode: 422
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  axios.get = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new axios.CanceledError()))
    })
  const timeout = assert.rejects(
    downloader.default('https://example.com/slow'),
    { statusCode: 504 }
  )
  t.mock.timers.tick(30_000)
  await timeout
  t.mock.timers.reset()
})

test('URL upload authenticates, persists only after S3 success and compensates DB failures', async () => {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.register(register, { prefix: '/api/file' })
  const put = (
    payload = { url: 'https://example.com/image' },
    token = 'ADMIN'
  ) =>
    app.inject({
      method: 'PUT',
      url: '/api/file/upload-image-from-url',
      payload,
      headers: { authorization: `Bearer ${token}` }
    })
  try {
    download = async () => ({ buffer: png, fileName: 'image.png' })
    assert.equal((await put(undefined, 'invalid')).statusCode, 403)
    assert.equal(requestLogSuppressed, true)
    assert.equal((await put({ url: '' })).statusCode, 400)
    assert.equal((await put({})).statusCode, 400)
    assert.equal(uploads.length, 0)
    const response = await put()
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      code: 0,
      message: 'Thành công',
      data: { id: 123, url: uploadResult.fullUrl }
    })
    assert.equal(saves[0].user, 7)
    assert.equal(saves[0].status, 'finished')
    assert.equal(saves[0].url, uploadResult.fullUrl)
    const successfulUpload = uploadResult
    uploadResult = null
    assert.equal((await put()).statusCode, 502)
    assert.equal(saves.length, 1)
    uploadResult = successfulUpload
    databaseFailure = true
    assert.equal((await put()).statusCode, 500)
    assert.deepEqual(removals, [uploadResult.key])
    cleanupFailure = true
    const failure = await put()
    assert.equal(failure.statusCode, 500)
    assert.equal(failure.body.includes('Sensitive'), false)
    assert.equal(removals.length, 2)
    databaseFailure = false
    for (const code of [400, 413, 415, 422, 504]) {
      download = async () => {
        throw new downloader.ImageDownloadError(code, 'Download failed')
      }
      assert.equal((await put()).statusCode, code)
    }
    assert.equal(saves.length, 1)
  } finally {
    await app.close()
  }
})
