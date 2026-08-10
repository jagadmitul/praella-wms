import type { Config } from 'jest';

/**
 * Integration tests — the real Nest application against a real PostgreSQL
 * database, driven over HTTP with Supertest.
 *
 * These are deliberately favoured over mock-heavy unit tests for the API
 * surface: the things most worth protecting here are guard ordering, tenant
 * scoping and transactional stock arithmetic, and none of those are exercised
 * by a test that mocks the database away.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  // The workspace `@wms/contracts` package resolves to built .js via a symlink,
  // which ts-jest would otherwise try to compile.
  transformIgnorePatterns: ['/node_modules/', '/packages/contracts/dist/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/env.setup.ts'],
  testTimeout: 60_000,
  // Serial: every spec truncates the shared test database between runs.
  maxWorkers: 1,
};

export default config;
