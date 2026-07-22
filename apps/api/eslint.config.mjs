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
    files: ['prisma/**/*.ts'],
    rules: {
      // The seed script reports progress to the operator; that is its output.
      'no-console': 'off',
    },
  },
];
