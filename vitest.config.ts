import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  optimizeDeps: {
    // Vite pre-bundles CJS deps and exposes ALL CJS exports as ESM named exports,
    // which lets `import * as fs from 'fs-extra'` access fs.readJson in tests
    // even though Node's actual ESM resolver would not. Disabling the optimizer
    // forces CJS deps through Node's native CJS->ESM interop in tests.
    disabled: true
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'build'],
    // Skip vitest's own CJS->ESM "default" interop, so namespace imports of CJS
    // modules behave like Node's ESM resolver (default + statically-detected
    // named exports only), catching ESM/CJS interop bugs at test time.
    deps: {
      interopDefault: false
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'build/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/openapi/'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/main/typescript')
    }
  }
})