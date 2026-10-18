import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const RAW_HTTP_MESSAGE =
  'Call the Grepr API through GreprApiClient so auth headers are attached and redacted in one place.'

export default tseslint.config(
  {
    ignores: [
      'build/',
      'dist/',
      'node_modules/',
      'src/main/typescript/openapi/openApiTypes.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_.*$',
          destructuredArrayIgnorePattern: '^_.*$',
          varsIgnorePattern: '^_.*$',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off', // Allow empty object types
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // All Grepr API calls go through GreprApiClient so the bearer token is attached,
    // and redacted from debug output, in exactly one place: its openapi-fetch middleware.
    // auth.ts is exempt because the token exchange happens before a token exists.
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/typescript/lib/auth.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: RAW_HTTP_MESSAGE }],
      'no-restricted-properties': ['error',
        { object: 'globalThis', property: 'fetch', message: RAW_HTTP_MESSAGE },
        { object: 'global', property: 'fetch', message: RAW_HTTP_MESSAGE },
      ],
      'no-restricted-imports': ['error', {
        paths: ['axios', 'node-fetch', 'undici', 'http', 'node:http', 'https', 'node:https']
          .map(name => ({ name, message: RAW_HTTP_MESSAGE })),
      }],
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in test files
      '@typescript-eslint/no-empty-function': 'off', // Allow empty functions in tests
      '@typescript-eslint/explicit-function-return-type': 'off', // Don't require return types in tests
      '@typescript-eslint/consistent-indexed-object-style': 'off', // Allow index signatures in tests
    },
  }
)