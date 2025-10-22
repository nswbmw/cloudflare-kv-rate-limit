import CloudflareKVRateLimiter from './src/CloudflareKVRateLimiter.js'

export default {
  async fetch (request, env) {
    const ratelimiter = CloudflareKVRateLimiter({ store: env.KV, limit: 3, period: 60, interval: 10 })
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown'
    const { success, limit, remaining, reset } = await ratelimiter(ip)

    if (!success) {
      return new Response(`Rate limited. Try again in ${reset}s`, { status: 429 })
    }
    return new Response(`OK. Limit: ${limit}, Remaining: ${remaining}`)
  }
}
