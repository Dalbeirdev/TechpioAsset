import base from '@techpioasset/config/eslint/base';

export default [
  { ignores: ['.expo/**', 'android/**', 'ios/**', 'babel.config.js'] },
  ...base,
  {
    rules: {
      // React Native uses require() for static image assets.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
