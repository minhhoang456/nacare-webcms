import moment from 'moment'
import redis from './redis'

const LOCKED = 'locked'
const ACQUIRED = 'acquired'

function timestamp() {
  return new Date().toUTCString()
}

function getSecondsRemaining() {
  const now = moment()
  const afterMinutes = moment().add(10, 'minutes')
  const secondsRemaining = afterMinutes.diff(now, 'seconds')
  return secondsRemaining
}

async function lock(lockId: string) {
  const isLocked = await redis.get(lockId)
  if (!isLocked) {
    const secondsRemaining = getSecondsRemaining()
    await redis.set(lockId, lockId, 'EX', secondsRemaining)
    return ACQUIRED
  } else {
    return LOCKED
  }
}

async function updateLock(lockId: string, value: any) {
  const currentTtl = await redis.pttl(lockId)
  const ttlMilliseconds = currentTtl === -2 ? -1 : currentTtl
  await redis.set(lockId, value, 'PX', ttlMilliseconds)
}

async function unlock(lockId: string) {
  console.log(timestamp(), lockId, `transaction is unlocked`)
  await redis.del(`${lockId}`)
}

const lockTransactionUtils = {
  handleWithLock: async function (lockId: string, fn: any) {
    let lockState = ''
    try {
      lockState = await lock(lockId)
      if (lockState === LOCKED) {
        return true
      }
      if (fn) {
        const data = await fn()
        updateLock(lockId, JSON.stringify(data))
        return data
      }
      return true
    } catch (err: any) {
      console.error(
        timestamp(),
        lockId,
        err && err.message ? err.message : 'transaction error'
      )
      return false
    }
  },
  handleUnlock: async function (lockId: string, fn: any) {
    try {
      let resultFn: any = null
      if (fn) {
        resultFn = await fn()
        if (resultFn) {
          unlock(lockId)
          return false
        }
        return true
      } else {
        unlock(lockId)
        return false
      }
    } catch (error) {
      console.log('🚀 ~ file: lockTransaction.ts:62 ~ error:', error)
      return true
    }
  },
  handleUseCode: async function (lockId: string, fn: any) {
    try {
      let resultFn: any = null
      if (fn) {
        resultFn = await fn()
        if (resultFn) {
          unlock(lockId)
          return resultFn
        }
        return null
      } else {
        unlock(lockId)
        return null
      }
    } catch (error) {
      console.log('🚀 ~ file: lockTransaction.ts:62 ~ error:', error)
      throw error
    }
  },
  checkKeyExists: async function (key: string) {
    try {
      const isExists = await redis.get(key)
      return isExists
    } catch (error) {
      console.log('🚀 ~ file: lockTransaction.ts:62 ~ error:', error)
      return false
    }
  }
}

export default lockTransactionUtils
