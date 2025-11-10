export default {
  // Test environment
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/__test__/**/*.test.js'
  ],

  // Coverage settings
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js'
  ],

  // Module resolution - correct property name
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^cloudflare:worker$': '<rootDir>/__test__/__mocks__/cloudflare-worker.js'
  },

  // Transform settings for ESM - disable transforms for pure ESM
  transform: {},

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Error handling
  errorOnDeprecated: true,

  // ESM support
  globals: {
    jest: {
      useESM: true
    }
  }
}
