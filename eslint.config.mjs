import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

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
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in test files
      '@typescript-eslint/no-empty-function': 'off', // Allow empty functions in tests
      '@typescript-eslint/explicit-function-return-type': 'off', // Don't require return types in tests
      '@typescript-eslint/consistent-indexed-object-style': 'off', // Allow index signatures in tests
    },
  }
)