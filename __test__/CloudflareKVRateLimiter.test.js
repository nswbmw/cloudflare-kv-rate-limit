import CloudflareKVRateLimiter, { CloudflareKVRateLimiter as NamedLimiter } from '../src/CloudflareKVRateLimiter.js'
import { jest } from '@jest/globals'

class MockKV {
  constructor () {
    this.map = new Map()
    this.putCalls = []
    this.failPut = false
    this.failGetKeys = new Set()
  }

  async get (key, type) {
    if (this.failGetKeys.has(key)) throw new Error('get failed')
    const v = this.map.get(key)
    if (v == null) return null
    if (type === 'json') {
      try {
        return JSON.parse(v)
      } catch (_) {
        return null
      }
    }
    return v
  }

  async put (key, value, options = {}) {
    if (this.failPut) throw new Error('put failed')
    this.map.set(key, value)
    this.putCalls.push({ key, value, expirationTtl: options.expirationTtl })
  }
}

describe('CloudflareKVRateLimiter exports', () => {
  test('default and named export are functions', () => {
    expect(typeof CloudflareKVRateLimiter).toBe('function')
    expect(typeof NamedLimiter).toBe('function')
  })
})

describe('CloudflareKVRateLimiter validations', () => {
  test('throws if store is missing or invalid', () => {
    expect(() => CloudflareKVRateLimiter({ limit: 1, period: 60 })).toThrow('store (Cloudflare KV) required with get/put methods')
    expect(() => CloudflareKVRateLimiter({ store: {}, limit: 1, period: 60 })).toThrow('store (Cloudflare KV) required with get/put methods')
  })

  test('throws if prefix is empty', () => {
    const store = new MockKV()
    expect(() => CloudflareKVRateLimiter({ store, prefix: '', limit: 1, period: 60 })).toThrow('prefix must be a non-empty string')
  })

  test('throws if limit < 1', () => {
    const store = new MockKV()
    expect(() => CloudflareKVRateLimiter({ store, limit: 0, period: 60 })).toThrow('limit must be >= 1')
  })

  test('throws if period < 60', () => {
    const store = new MockKV()
    expect(() => CloudflareKVRateLimiter({ store, limit: 1, period: 59 })).toThrow('period must be >= 60 seconds (Cloudflare KV TTL minimum)')
  })

  test('throws if interval < 0', () => {
    const store = new MockKV()
    expect(() => CloudflareKVRateLimiter({ store, limit: 1, period: 60, interval: -1 })).toThrow('interval must be >= 0')
  })

  test('throws if interval > period', () => {
    const store = new MockKV()
    expect(() => CloudflareKVRateLimiter({ store, limit: 1, period: 60, interval: 61 })).toThrow('interval must be <= period')
  })

  test('throws if key is invalid on limiter and get', async () => {
    const store = new MockKV()
    const limiter = CloudflareKVRateLimiter({ store, limit: 1, period: 60 })
    await expect(limiter('')).rejects.toThrow('key must be a non-empty string')
    await expect(limiter.get('')).rejects.toThrow('key must be a non-empty string')
  })

  test('calling without options uses default param and throws', () => {
    expect(() => CloudflareKVRateLimiter()).toThrow('store (Cloudflare KV) required with get/put methods')
  })
})

describe('CloudflareKVRateLimiter behavior', () => {
  test('basic success, TTL set, and get reflects state', async () => {
    const store = new MockKV()
    const limiter = CloudflareKVRateLimiter({ store, limit: 3, period: 60, interval: 0 })

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)

    const r1 = await limiter('user:1')
    expect(r1.success).toBe(true)
    expect(r1.limit).toBe(3)
    expect(r1.remaining).toBe(2)
    expect(r1.reset).toBe(0)

    expect(store.putCalls.length).toBe(1)
    expect(store.putCalls[0].key).toBe('ratelimit:user:1')
    expect(store.putCalls[0].expirationTtl).toBe(60)

    const rget = await limiter.get('user:1')
    expect(rget.success).toBe(true)
    expect(rget.limit).toBe(3)
    expect(rget.remaining).toBe(2)
    expect(rget.reset).toBe(0)

    nowSpy.mockRestore()
  })

  test('interval gating: second immediate call fails with reset = interval', async () => {
    const store = new MockKV()
    const limiter = CloudflareKVRateLimiter({ store, limit: 3, period: 60, interval: 10 })

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)

    const r1 = await limiter('user:2')
    expect(r1.success).toBe(true)

    // immediate second call (same system time)
    const r2 = await limiter('user:2')
    expect(r2.success).toBe(false)
    expect(r2.remaining).toBe(2) // still only 1 timestamp stored
    expect(r2.reset).toBe(10)

    // get should also show interval gating
    const rget = await limiter.get('user:2')
    expect(rget.success).toBe(false)
    expect(rget.reset).toBe(10)

    nowSpy.mockRestore()
  })

  test('limit gating: third call fails and reset derived from first + period', async () => {
    const store = new MockKV()
    const limiter = CloudflareKVRateLimiter({ store, limit: 2, period: 60, interval: 0 })

    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(0)
    const r1 = await limiter('user:3')
    expect(r1.success).toBe(true)

    nowSpy.mockReturnValue(1000)
    const r2 = await limiter('user:3')
    expect(r2.success).toBe(true)

    nowSpy.mockReturnValue(2000)
    const r3 = await limiter('user:3')
    expect(r3.success).toBe(false)
    expect(r3.remaining).toBe(0)
    expect(r3.reset).toBe(58) // (first=0 + 60000 - now=2000) / 1000 => 58

    nowSpy.mockRestore()
  })

  test('cleanup trims over-limit arrays and writes back with TTL on failure', async () => {
    const store = new MockKV()
    // Pre-populate with 3 entries within window
    store.map.set('ratelimit:heavy', JSON.stringify([1000, 2000, 3000]))

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(4000)
    const limiter = CloudflareKVRateLimiter({ store, limit: 2, period: 60, interval: 0 })

    const r = await limiter('heavy')
    expect(r.success).toBe(false)
    expect(r.remaining).toBe(0)

    // Store should have been trimmed to last 2 entries and updated with TTL
    const parsed = JSON.parse(store.map.get('ratelimit:heavy'))
    expect(parsed).toEqual([2000, 3000])
    const lastPut = store.putCalls[store.putCalls.length - 1]
    expect(lastPut.key).toBe('ratelimit:heavy')
    expect(lastPut.expirationTtl).toBe(60)

    nowSpy.mockRestore()
  })

  test('get() path handles store.get errors gracefully', async () => {
    const store = new MockKV()
    store.failGetKeys.add('ratelimit:err')

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
    const limiter = CloudflareKVRateLimiter({ store, limit: 2, period: 60, interval: 0 })

    const r = await limiter('err') // underlying get throws; code treats as [] and succeeds
    expect(r.success).toBe(true)
    expect(r.remaining).toBe(1)

    nowSpy.mockRestore()
  })

  test('set() path swallows put errors without throwing', async () => {
    const store = new MockKV()
    store.failPut = true

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
    const limiter = CloudflareKVRateLimiter({ store, limit: 2, period: 60, interval: 0 })

    const r = await limiter('failput')
    expect(r.success).toBe(true)
    expect(r.remaining).toBe(1)
    // Ensure it did not throw despite put failure
    expect(store.putCalls.length).toBe(0)

    nowSpy.mockRestore()
  })

  test('custom prefix is used when provided', async () => {
    const store = new MockKV()
    const limiter = CloudflareKVRateLimiter({ store, prefix: 'p:', limit: 1, period: 60, interval: 0 })
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)

    const r = await limiter('x')
    expect(r.success).toBe(true)
    expect(store.putCalls[0].key).toBe('p:x')

    nowSpy.mockRestore()
  })

  test('limiter.get period reset branch when at rate limit', async () => {
    const store = new MockKV()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)
    const limiter = CloudflareKVRateLimiter({ store, limit: 1, period: 60, interval: 0 })

    store.map.set('ratelimit:get-limit', JSON.stringify([0]))
    const rget = await limiter.get('get-limit')
    expect(rget.success).toBe(false)
    expect(rget.reset).toBe(59)

    nowSpy.mockRestore()
  })

  test('limiter.get sorts and computes reset with multiple timestamps', async () => {
    const store = new MockKV()
    // prepopulate with mixed order and within window
    store.map.set('ratelimit:getsort', JSON.stringify([1600, 1000, 1500]))
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2600)
    const limiter = CloudflareKVRateLimiter({ store, limit: 4, period: 60, interval: 1 })

    const rget = await limiter.get('getsort')
    expect(rget.limit).toBe(4)
    expect(rget.remaining).toBe(1)
    expect(rget.success).toBe(true)
    expect(rget.reset).toBe(0)

    nowSpy.mockRestore()
  })
})
