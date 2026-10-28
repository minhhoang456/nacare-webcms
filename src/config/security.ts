import * as crypto from 'crypto'
export default class Security {
  private static readonly HMAC_SHA1_ALGORITHM = 'sha1'

  static hmac(data: string, key: string): string {
    try {
      const hmac = crypto.createHmac(Security.HMAC_SHA1_ALGORITHM, key)
      hmac.update(data)
      const rawHmac = hmac.digest()
      return rawHmac.toString('base64')
    } catch (e: any) {
      throw new Error(`Failed to generate HMAC: ${e.message}`)
    }
  }
}
