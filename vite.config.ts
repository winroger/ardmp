/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath, URL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

function normalizeBasePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

function resolvePagesBase(mode: string): string {
  if (mode !== 'production') return '/'

  const explicitBase = process.env.VITE_BASE_PATH
  if (explicitBase) return normalizeBasePath(explicitBase)

  const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (process.env.GITHUB_ACTIONS === 'true' && repositoryName) {
    return normalizeBasePath(repositoryName)
  }

  return '/'
}

function manualVendorChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  if (
    id.includes('/node_modules/vue/')
    || id.includes('/node_modules/vue-router/')
    || id.includes('/node_modules/pinia/')
  ) {
    return 'vendor-vue'
  }

  if (
    id.includes('/node_modules/primevue/')
    || id.includes('/node_modules/@primevue/')
    || id.includes('/node_modules/@primeuix/')
    || id.includes('/node_modules/primeicons/')
  ) {
    return 'vendor-primevue'
  }

  if (
    id.includes('/node_modules/@vue-flow/')
    || id.includes('/node_modules/@dagrejs/dagre/')
  ) {
    return 'vendor-vueflow'
  }

  if (
    id.includes('/node_modules/@ulb-darmstadt/shacl-form/')
  ) {
    return 'vendor-shacl-form'
  }

  if (
    id.includes('/node_modules/leaflet')
    || id.includes('/node_modules/leaflet-editable/')
  ) {
    return 'vendor-leaflet'
  }

  if (id.includes('/node_modules/localforage/')) {
    return 'vendor-storage'
  }

  if (id.includes('/node_modules/rdflib/')) return 'vendor-rdflib'
  if (id.includes('/node_modules/jsonld/')) return 'vendor-jsonld'
  if (id.includes('/node_modules/ro-crate/')) return 'vendor-ro-crate'
  if (id.includes('/node_modules/@rdfjs/') || id.includes('/node_modules/n3/')) return 'vendor-rdfjs'

  if (id.includes('/node_modules/jszip/')) {
    return 'vendor-export'
  }

  return undefined
}

export default defineConfig(({ mode }) => ({
  base: resolvePagesBase(mode),
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: tag => tag === 'shacl-form',
        },
      },
    }),
    nodePolyfills({
      // Don't polyfill `process` here — `vite-plugin-node-polyfills` ships a
      // broken CJS-interop shim that loses `process.nextTick` when bundled
      // dependencies (e.g. readable-stream inside @ulb-darmstadt/shacl-form)
      // do `var process = require('process')`. We alias to the proper
      // `process/browser` package below instead.
      include: ['buffer'],
      globals: { process: false, Buffer: true, global: true },
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // Force the canonical `process` npm package (has working `nextTick`).
      // Use exact match so `process/browser` etc. are not rewritten.
      { find: /^process$/, replacement: 'process/browser.js' },
    ],
  },
  define: {
    // Many CJS packages reference bare `global` at module top-level.
    global: 'globalThis',
  },
  optimizeDeps: {
    // Pre-bundle these to ensure CJS deps see the aliased `process`.
    include: ['process/browser'],
    esbuildOptions: {
      plugins: [{
        name: 'inline-leaflet-raw-css',
        setup(build) {
          // shacl-form uses these styles inside its shadow DOM. Inline them
          // during dependency optimization so lazy routes do not depend on
          // separate CSS-as-JavaScript requests from the optimized module.
          const require = createRequire(import.meta.url)
          build.onResolve({ filter: /^leaflet(?:\.fullscreen)?\/.*\.css\?raw$/ }, args => ({
            path: require.resolve(args.path.replace(/\?raw$/, '')),
            namespace: 'leaflet-raw-css',
          }))
          build.onLoad({ filter: /./, namespace: 'leaflet-raw-css' }, async args => ({
            contents: await readFile(args.path, 'utf8'),
            loader: 'text',
          }))
        },
      }],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: manualVendorChunks,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
}))
