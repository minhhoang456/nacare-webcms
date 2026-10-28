import axios from 'axios'
import { lookup } from 'node:dns/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { BlockList, isIP, LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
const blockedAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4')
}
blockedAddresses.addSubnet('2001::', 23, 'ipv6')
blockedAddresses.addSubnet('2001:db8::', 32, 'ipv6')
blockedAddresses.addSubnet('2002::', 16, 'ipv6')
blockedAddresses.addSubnet('3fff::', 20, 'ipv6')

export class ImageDownloadError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blockedAddresses.check(address, 'ipv4')
  // Only globally routed IPv6 unicast is eligible; mapped IPv4 is excluded.
  if (family === 6 && /^[23][0-9a-f]{3}:/i.test(address)) {
    return !blockedAddresses.check(address, 'ipv6')
  }
  return false
}

const publicLookup: LookupFunction = async (hostname, _options, callback) => {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicImageAddress(address))
    ) {
      throw new ImageDownloadError(400, 'URL phải trỏ đến địa chỉ công khai')
    }
    // Return the validated address directly to the socket to prevent DNS rebinding.
    callback(null, addresses[0].address, addresses[0].family)
  } catch (error) {
    callback(
      error instanceof Error ? error : new Error('DNS lookup failed'),
      '',
      4
    )
  }
}

export function detectImageExtension(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer.toString('hex', 0, 3) === 'ffd8ff')
    return 'jpg'
  if (buffer.length >= 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a')
    return 'png'
  if (
    buffer.length >= 6 &&
    ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
  )
    return 'gif'
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp'
  throw new ImageDownloadError(415, 'Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc GIF')
}

export default async function downloadImageFromUrl(source: string) {
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new ImageDownloadError(400, 'URL ảnh không hợp lệ')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    (isIP(hostname) && !isPublicImageAddress(hostname))
  ) {
    throw new ImageDownloadError(400, 'URL ảnh phải là HTTP/HTTPS công khai')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  const httpAgent = new HttpAgent({
    lookup: publicLookup,
    autoSelectFamily: false
  })
  const httpsAgent = new HttpsAgent({
    lookup: publicLookup,
    autoSelectFamily: false,
    rejectUnauthorized: true
  })
  let stream: Readable | undefined
  try {
    const response = await axios.get<Readable>(url.href, {
      responseType: 'stream',
      signal: controller.signal,
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxRedirects: 0,
      proxy: false,
      httpAgent,
      httpsAgent,
      validateStatus: () => true
    })
    stream = response.data
    if (response.status < 200 || response.status >= 300) {
      throw new ImageDownloadError(
        422,
        'Không tải được ảnh từ URL hoặc URL chuyển hướng'
      )
    }
    if (Number(response.headers['content-length']) > MAX_IMAGE_BYTES) {
      throw new ImageDownloadError(413, 'Ảnh vượt quá giới hạn 10 MB')
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > MAX_IMAGE_BYTES)
        throw new ImageDownloadError(413, 'Ảnh vượt quá giới hạn 10 MB')
      chunks.push(part)
    }
    const buffer = Buffer.alloc(size)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(new Uint8Array(chunk), offset)
      offset += chunk.length
    }
    const extension = detectImageExtension(buffer)
    return { buffer, fileName: `image.${extension}` }
  } catch (error) {
    if (error instanceof ImageDownloadError) throw error
    if (
      controller.signal.aborted ||
      (axios.isAxiosError(error) && error.code === 'ECONNABORTED')
    ) {
      throw new ImageDownloadError(504, 'Quá thời gian tải ảnh')
    }
    throw new ImageDownloadError(422, 'Không thể tải ảnh từ URL công khai')
  } finally {
    clearTimeout(timer)
    stream?.destroy()
    httpAgent.destroy()
    httpsAgent.destroy()
  }
}
