import type { Config } from 'jest';

/** Unit tests — pure logic, no database or network. */
const config: Config = {
  rootDir: 'src',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  // The workspace `@wms/contracts` package resolves to built .js via a symlink,
  // which ts-jest would otherwise try to compile.
  transformIgnorePatterns: ['/node_modules/', '/packages/contracts/dist/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.ts', '!**/generated/**', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
};

export default config;
