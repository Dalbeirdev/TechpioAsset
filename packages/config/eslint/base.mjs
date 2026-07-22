import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared flat ESLint config. Packages extend this and add their own
 * framework plugins (Nest, Next, React) on top.
 */
export default tseslint.config(
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', '**/*.generated.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Money must never round-trip through IEEE-754. Section 8/9 of the spec
          // requires exact invoice arithmetic; parseFloat on a currency string is
          // the usual way that guarantee gets quietly broken.
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Use Prisma.Decimal / decimal.js for monetary values, never parseFloat.',
        },
      ],
    },
  },
  prettier,
);
