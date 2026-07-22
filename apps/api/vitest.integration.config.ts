import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // Vitest transpiles with esbuild, which cannot emit decorator metadata. Without
  // it Nest's injector sees `undefined` for every constructor parameter type and
  // the module graph fails to build. SWC emits the metadata that tsc does.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    env: {
      // The suite performs dozens of legitimate logins within a few seconds and
      // would otherwise trip its own brute-force protection. The throttle is
      // exercised deliberately in its own test rather than incidentally here.
      LOGIN_RATE_LIMIT: '10000',
    },
    // The suite boots a Nest application and talks to a real database; the
    // default 5s is not enough for the first compile plus argon2 hashing.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One database, shared fixtures: parallel files would race on the same rows.
    fileParallelism: false,
  },
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
