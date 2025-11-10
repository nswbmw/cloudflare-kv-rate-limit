// Use getter to always return the latest __TEST_ENV__
export const env = new Proxy({}, {
  get (target, prop) {
    return globalThis.__TEST_ENV__?.[prop]
  },
  has (target, prop) {
    return prop in (globalThis.__TEST_ENV__ || {})
  }
})
