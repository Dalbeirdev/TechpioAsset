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
    files: ['prisma/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      // Seed and operator scripts report progress to the console; that is their
      // entire output, not stray debugging.
      'no-console': 'off',
    },
  },
];
