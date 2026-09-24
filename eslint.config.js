// ESLint flat config for the whole monorepo (JavaScript only — DECISIONS OD-1, D-1).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Server-only packages that must never be bundled into a client (money is computed on the server). */
const SERVER_ONLY = [
  '@jamzo/database',
  '@jamzo/auth',
  '@jamzo/logger',
  '@jamzo/notifications',
  '@jamzo/pricing-engine',
  '@jamzo/order-engine',
  '@jamzo/delivery-engine',
  '@jamzo/settlement-engine',
];

/** Product identifiers live only in the central registry (DECISIONS D-15). */
const IDENTIFIER_LITERALS = {
  selector: 'Literal[value=/in\\.jamzo\\.|jamzo\\.in/]',
  message:
    'Product identifiers/domain must come from @jamzo/config (packages/config/src/apps.js), not literals.',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/.expo/**',
      '**/dist/**',
      '**/coverage/**',
      '**/var/**',
      'apps/*/android/**',
      'apps/*/ios/**',
      'assets/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/admin/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    plugins: { jsdoc },
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // `React` may be imported but unused under the automatic JSX runtime (generated shadcn/ui components).
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|React$)', caughtErrors: 'none' },
      ],
      'no-restricted-syntax': ['error', IDENTIFIER_LITERALS],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'jsdoc/valid-types': 'error',
      'jsdoc/check-param-names': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // The registry and its tests are the only places identifiers may be written literally.
    files: ['packages/config/src/apps.js', 'packages/config/src/apps.test.js', 'scripts/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: [
      'apps/**/*.{js,jsx}',
      'packages/mobile-ui/**/*.{js,jsx}',
      'packages/mobile-foundation/**/*.{js,jsx}',
    ],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, __DEV__: 'readonly', process: 'readonly' },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: SERVER_ONLY.map((name) => ({
            name,
            message:
              'Server-only package: clients must not compute money or touch the database (ARCHITECTURE §3).',
          })),
        },
      ],
    },
  },
  {
    files: [
      '**/*.test.{js,jsx}',
      '**/test/**/*.{js,jsx}',
      '**/__tests__/**/*.{js,jsx}',
      '**/jest.setup.js',
      '**/e2e/**/*.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    // Tests assert the registry's identifiers, so literals are expected there.
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // React Native renders apostrophes in <Text> as-is; this HTML/DOM rule does not apply.
    files: [
      'apps/customer/**/*.{js,jsx}',
      'apps/restaurant/**/*.{js,jsx}',
      'apps/rider/**/*.{js,jsx}',
      'packages/mobile-*/**/*.{js,jsx}',
    ],
    rules: { 'react/no-unescaped-entities': 'off' },
  },
  {
    // The admin E2E harness starts a real test backend; it never ships to a browser.
    files: ['apps/admin/e2e/**/*.js'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
];
