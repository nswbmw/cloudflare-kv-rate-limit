## cloudflare-kv-rate-limit

Cloudflare KV-based sliding-window rate limiter with optional minimum-interval gating.

## Installation

```bash
$ npm i cloudflare-kv-rate-limit --save
```

## Quick Start

```js
import CloudflareKVRateLimiter from 'cloudflare-kv-rate-limit'

const ratelimiter = CloudflareKVRateLimiter({
  binding: 'KV',
  prefix: 'ratelimit:',
  limit: 3,
  period: 60,
  interval: 10
})

const { success, limit, remaining, reset } = await ratelimiter('myKey')
// Or inspect via read-only .get() (no KV writes).
// const { success, limit, remaining, reset } = await ratelimiter.get('myKey')
```

### Options

| Option     | Type    | Required | Default       | Description                                            |
|------------|---------|----------|---------------|--------------------------------------------------------|
| `binding`  | string  | No       | `'KV'`        | KV binding name (e.g., `'KV'`). The library imports `cloudflare:workers` and resolves `env[binding]`. |
| `prefix`   | string  | No       | `'ratelimit:'`| Key prefix used to namespace rate limit entries.       |
| `limit`    | number  | Yes      | -             | Allowed requests per window (≥ 1).                     |
| `period`   | number  | Yes      | -             | Window size in seconds (≥ 60); also used as KV TTL.    |
| `interval` | number  | No       | `0`           | Minimum seconds between two accepted requests (≥ 0).   |

## Example

```js
import CloudflareKVRateLimiter from 'cloudflare-kv-rate-limit'

export default {
  async fetch (request, env) {
    const ratelimiter = CloudflareKVRateLimiter({ binding: 'KV', limit: 3, period: 60, interval: 10 })
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown'
    const { success, limit, remaining, reset } = await ratelimiter(ip)

    if (!success) {
      return new Response(`Rate limited. Try again in ${reset}s`, { status: 429 })
    }
    return new Response(`OK. Limit: ${limit}, Remaining: ${remaining}`)
  }
}
```

## Test (100% coverage)

```sh
$ npm test
```

## License

MIT
