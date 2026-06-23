import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: [
      'tests/**/*.emulator.test.js',
      'tests/security-rules.test.js',
      'tests/e2e/**',
      'tests/e2e-emulator/**',
    ],
    testTimeout: 15000,
  },
});
