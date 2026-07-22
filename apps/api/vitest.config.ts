import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // API source uses Node-style '.js' specifiers so tsc emits valid CommonJS;
    // Vite needs to be told those map back to the TypeScript sources.
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
