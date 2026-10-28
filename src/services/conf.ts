import localCache from '../utils/localCache'
import { prismaClient } from '../utils/prisma'

export const confService = {
  /**
   * Get config value by key
   * @param name string
   * @param defaultValue string
   * @returns
   */
  get: (name: string, defaultValue?: string | number) => {
    const cache: any = localCache.get('config')
    if (!cache || cache[name] === undefined) return defaultValue
    return cache[name]
  },

  /**
   *Refresh config data
   */
  refreshRemote: async () => {
    const all = await prismaClient.conf.findMany()
    const cache: any = {}
    all.forEach((i) => {
      switch (i.type) {
        case 'number':
          if (i.name) cache[i.name] = Number(i.val)
          break
        case 'string':
          if (i.name) cache[i.name] = i.val
          break
      }
    })
    localCache.set('config', cache)
  },
  /**
   * Check phone exist in whitelist
   * @param phone string
   * @returns
   */
  async checkPhoneInWhiteList(phone: string) {
    let whitelist = this.get('WHITELIST', '0987654321,0356798938,0123456789')
    whitelist = whitelist.split(',')
    return whitelist.includes(phone)
  },
  /**
   * Run every 1 minute local
   */
  async runInterval1() {
    await this.refreshRemote()
  },

  bootstrap: async () => {
    try {
      confService.refreshRemote()
    } catch (err) {
      console.log('🚀 ~ bootstap: ~ err:', err)
    }
  }
}
export default confService
