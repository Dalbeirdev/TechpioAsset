// The Next plugin is wired directly rather than via `eslint-config-next`, which
// loads @rushstack/eslint-patch and fails against ESLint 9.39.
import nextPlugin from '@next/eslint-plugin-next';
import base from '@techpioasset/config/eslint/base';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
