import base from '@techpioasset/config/eslint/base';

export default [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      // Nest resolves providers from decorator metadata, which the unused-vars
      // rule cannot see on constructor parameter properties.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['prisma/**/*.ts', 'scripts/**/*.mjs', 'src/**/*-cli.ts'],
    rules: {
      // Seed and operator scripts report progress to the console; that is their
      // entire output, not stray debugging. The same applies to the *-cli.ts
      // entry points (v2.8): shell scripts parse their stdout, so printing IS
      // the interface.
      'no-console': 'off',
    },
  },
];
