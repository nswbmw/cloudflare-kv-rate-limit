export interface CloudflareKVRateLimiterOptions {
  binding?: string
  prefix?: string
  limit: number
  period: number
  interval?: number
}

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

export interface RateLimiter {
  (key: string): Promise<RateLimitResult>
  get(key: string): Promise<RateLimitResult>
}

export function CloudflareKVRateLimiter (opts: CloudflareKVRateLimiterOptions): RateLimiter
export default CloudflareKVRateLimiter