/**
 * Cloudflare KV-based rate limiter.
 *
 * @param {Object} opts Configuration options
 * @param {string} [opts.binding] Cloudflare KV namespace, default: KV
 * @param {string} [opts.prefix='ratelimit:'] Key prefix to namespace rate limit entries
 * @param {number} opts.limit Allowed requests per window (>= 1)
 * @param {number} opts.period Window size in seconds (>= 60); also used as KV TTL
 * @param {number} [opts.interval=0] Min seconds between two accepted requests (>= 0)
 * @returns {(key: string) => Promise<{success: boolean, limit: number, remaining: number, reset: number}>} Limiter function
 * @throws {TypeError} If options are invalid (missing binding/prefix or invalid limit/period/interval)
 */
export function CloudflareKVRateLimiter (opts = {}) {
  const binding = opts.binding || 'KV'
  const prefix = typeof opts.prefix === 'string' ? opts.prefix : 'ratelimit:'
  const limit = Math.floor(opts.limit)
  const period = Math.floor(opts.period)
  const interval = Math.floor(opts.interval ?? 0)

  assert(typeof binding === 'string' && binding.length > 0, 'binding must be a non-empty string (KV binding name)')
  assert(typeof prefix === 'string' && prefix.length > 0, 'prefix must be a non-empty string')
  assert(Number.isFinite(limit) && limit >= 1, 'limit must be >= 1')
  assert(Number.isFinite(period) && period >= 60, 'period must be >= 60 seconds (Cloudflare KV TTL minimum)')
  assert(Number.isFinite(interval) && interval >= 0, 'interval must be >= 0')
  assert(interval <= period, 'interval must be <= period')

  const periodMs = period * 1000
  const intervalMs = interval * 1000

  // Lazy resolve KV from Cloudflare runtime by binding name
  let runtimeCache = null
  async function resolveKV () {
    if (!runtimeCache) {
      runtimeCache = await import('cloudflare:worker')
    }
    const KV = runtimeCache.env[binding]
    assert(KV && typeof KV.get === 'function' && typeof KV.put === 'function', `KV binding not found or invalid for name: ${binding}`)
    return KV
  }

  function computeState (arr, now) {
    const first = arr[0]
    const last = arr[arr.length - 1]
    const allowedByLimit = arr.length < limit
    const allowedByInterval = intervalMs <= 0 || last == null || (now - last) >= intervalMs
    const success = allowedByLimit && allowedByInterval
    const remaining = Math.max(0, limit - arr.length)

    const resets = []
    if (!allowedByLimit) resets.push((first + periodMs) - now)
    if (!allowedByInterval) resets.push((last + intervalMs) - now)
    const resetMs = Math.max(0, resets.length ? Math.max(...resets) : 0)
    const reset = success ? 0 : Math.ceil(resetMs / 1000)

    return { success, remaining, reset }
  }

  /**
   * Attempt to consume one request for `key`.
   *
   * @param {string} key The rate limit key
   * @returns {Promise<{success: boolean, limit: number, remaining: number, reset: number}>}
   */
  async function ratelimiter (key) {
    assert(typeof key === 'string' && key.length > 0, 'key must be a non-empty string')

    const KV = await resolveKV()
    const kvKey = prefix + key
    const now = Date.now()

    // Read timestamps and cleanup expired ones
    let arr = await get(KV, kvKey)
    const originalLength = arr.length
    arr = arr.filter(ts => typeof ts === 'number' && ts > (now - periodMs)).sort((a, b) => a - b)
    let changed = arr.length !== originalLength

    // If somehow longer than limit (race conditions), keep only the most recent `limit` entries
    if (arr.length > limit) {
      arr = arr.slice(arr.length - limit)
      changed = true
    }

    const { success, reset } = computeState(arr, now)

    if (success) {
      arr.push(now)
      await set(KV, kvKey, arr, period)
    } else {
      // Only write back if cleanup changed the array; avoid unnecessary writes on pure failures
      if (changed) await set(KV, kvKey, arr, period)
    }

    // Compute remaining after potential push
    const remaining = Math.max(0, limit - arr.length)
    return { success, limit, remaining, reset }
  }

  /**
   * Inspect current state for `key` without mutating KV.
   *
   * @param {string} key The rate limit key
   * @returns {Promise<{success: boolean, limit: number, remaining: number, reset: number}>}
   */
  ratelimiter.get = async function (key) {
    // Inspect without mutating state. Useful for debugging/monitoring.
    assert(typeof key === 'string' && key.length > 0, 'key must be a non-empty string')

    const KV = await resolveKV()
    const kvKey = prefix + key
    const now = Date.now()

    let arr = await get(KV, kvKey)
    arr = arr.filter(ts => typeof ts === 'number' && ts > (now - periodMs)).sort((a, b) => a - b)

    const { success, remaining, reset } = computeState(arr, now)

    return { success, limit, remaining, reset }
  }

  return ratelimiter
}

function assert (condition, message) {
  if (!condition) throw new TypeError(message)
}

async function get (KV, key) {
  try {
    const val = await KV.get(key, 'json')
    return Array.isArray(val) ? val : []
  } catch (_) {
    return []
  }
}

async function set (KV, key, arr, period) {
  try {
    await KV.put(key, JSON.stringify(arr), { expirationTtl: period })
  } catch (_) {}
}

export default CloudflareKVRateLimiter
