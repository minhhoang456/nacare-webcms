import { ono } from '@jsdevtools/ono'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import jwt from 'jsonwebtoken'
import randomstring from 'randomstring'
import Conf from '../services/conf'
import request from './request'
import redisClient from '../utils/redis'
import cc from 'coupon-code'

function generateCodeChar(quanity: number, length: number) {
  const codes = []
  for (let i = 0; i < quanity; i++) {
    codes.push(
      randomstring.generate({
        length,
        capitalization: 'uppercase',
        readable: true
      })
    )
  }
  return codes
}

function generateStringRandom(length: number) {
  return randomstring.generate({
    length,
    capitalization: 'uppercase',
    readable: true
  })
}

function hashCode(str: string) {
  let hash = 0
  if (str.length == 0) {
    return hash
  }
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    // hash = hash & hash; // Convert to 32bit integer
  }
  return hash
}

function signJwt(data: any, expire: number, secret?: string) {
  const token = jwt.sign(
    { data },
    secret ||
      Conf.get('ACCESS_TOKEN_SECRET', 'd2f2bef4-b3c6-4963-b366-1fc081738431'),
    { expiresIn: expire }
  )
  return token
}

function signJwtV2(
  data: any,
  expireAccessToken: number,
  expireRefreshToken: number,
  secret?: string
) {
  data.expireAccessToken = expireAccessToken
  data.expireRefreshToken = expireRefreshToken
  const secretKey =
    secret ||
    Conf.get('ACCESS_TOKEN_SECRET', 'd2f2bef4-b3c6-4963-b366-1fc081738431')
  const token = jwt.sign({ data }, secretKey, { expiresIn: expireAccessToken })
  redisClient.set(token, JSON.stringify(data), 'EX', expireRefreshToken)
  return token
}

async function verifyJwtV2(token: string, secret?: string) {
  const secretKey =
    secret ||
    Conf.get('ACCESS_TOKEN_SECRET', 'd2f2bef4-b3c6-4963-b366-1fc081738431')
  try {
    const data: any = jwt.verify(token, secretKey)
    return {
      newToken: token,
      payload: data.data
    }
  } catch (error) {
    const refreshInfo = await refreshToken(token, secretKey)
    if (refreshInfo === null) {
      throw new Error('e_invalid_token')
    }
    return refreshInfo
  }
}

async function refreshToken(token: string, secret: string) {
  let payload: any = await redisClient.get(token)
  if (!payload) {
    return null
  }
  payload = JSON.parse(payload)
  await redisClient.del(token)
  const newToken = signJwtV2(
    payload,
    payload.expireAccessToken,
    payload.expireRefreshToken,
    secret
  )
  return {
    newToken,
    payload
  }
}

function getCacheTime() {
  return 60
}
function getLongCacheTime() {
  return 3600
}
function randomCacheTime() {
  return Math.round(Math.random() * 60) + 60
}
function verifyJwt(token: string, secret?: string) {
  try {
    const data = jwt.verify(
      token,
      secret ||
        Conf.get('ACCESS_TOKEN_SECRET', 'd2f2bef4-b3c6-4963-b366-1fc081738431')
    )
    return data
  } catch (error) {
    throw new Error('e_invalid_token')
  }
}

async function checkHash(text: string, hash: string) {
  return new Promise((resolve, _) => {
    bcrypt.compare(text, hash, (err, result) => {
      if (err) {
        resolve(false)
      }
      resolve(result)
    })
  })
}
async function hash(text: string) {
  return new Promise((resolve, _) => {
    // eslint-disable-next-line handle-callback-err
    bcrypt.hash(text, 10, (_, hash) => {
      resolve(hash)
    })
  })
}

function uuid() {
  return uuidv4()
}
function randomOtp() {
  return Math.round(Math.random() * 8999) + 1000
}

function replaceAll(str: string, search: string, sub: string) {
  return str.split(search).join(sub)
}

async function checkCaptchaV3(token: string) {
  const secretKeyCaptcha = Conf.get(
    'KEY_CAPTCHA_V3',
    '6LfcZx4fAAAAAOLsnT35rdpE6eVqVIlYT86gs-t7'
  )
  const result = await request({
    method: 'POST',
    url:
      'https://www.google.com/recaptcha/api/siteverify?secret=' +
      secretKeyCaptcha +
      '&response=' +
      token,
    data: {}
  })
  if (result.success && result.score > 0.1) {
    return true
  }
  throw ono({
    code: 'e_invalid_captcha'
  })
}

function generateCouponCodes(quanity: number): string[] {
  const codes = []
  for (let i = 0; i < quanity; i++) {
    codes.push(cc.generate())
  }
  return codes
}

export default {
  generateCouponCodes,
  hashCode,
  getLongCacheTime,
  getCacheTime,
  randomCacheTime,
  hash,
  checkHash,
  uuid,
  randomOtp,
  signJwt,
  verifyJwt,
  generateCodeChar,
  replaceAll,
  signJwtV2,
  verifyJwtV2,
  checkCaptchaV3,
  generateStringRandom
}
