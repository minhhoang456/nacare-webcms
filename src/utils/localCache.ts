const NodeCache = require('node-cache')
const myCache = new NodeCache()
/**
 *
 * @param {string} key cache key
 * @param {object} val the value
 * @param {number} ttl [optional] time to live in seconds
 */

function set(key: any, val: any, ttl?: any) {
  if (ttl) {
    return myCache.set(key, val, ttl)
  }
  myCache.set(key, val)
}
/**
 *
 * @param {string} key cache key
 */
function get(key: any) {
  const rs: any = myCache.get(key)
  return rs
}
/**
 *
 * @param {array} keys list keys to get
 */
function mget(keys: any) {
  const rs: any = myCache.mget(keys)
  return rs
}
/**
 *
 * @param {array} keys multiple key val pairs
 */
function mset(keys: any) {
  const rs: any = myCache.mset(keys)
  return rs
}

function del(key: any) {
  myCache.del(key)
}
function has(key: any) {
  return myCache.has(key)
}
const promises: any = {}
export default { get, set, mget, mset, del, has, promises }
