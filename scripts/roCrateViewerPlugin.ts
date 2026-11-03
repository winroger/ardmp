import { build, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath, URL } from 'node:url'

/** Build an independent classic-script viewer; no module loads on file://. */
export function roCrateViewerPlugin(): Plugin {
  const id = '\0virtual:ro-crate-viewer'
  let bundle: Promise<string> | undefined
  let testMode = false
  async function compile(): Promise<string> {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const output = await build({
      configFile: false, root, publicDir: false, logLevel: 'warn',
      plugins: [vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'shacl-form' } } }),
        nodePolyfills({ include: ['buffer'], globals: { process: false, Buffer: true, global: true } })],
      resolve: {
        alias: [{ find: '@', replacement: fileURLToPath(new URL('../src', import.meta.url)) }, { find: /^process$/, replacement: 'process/browser.js' }],
      },
      define: { global: 'globalThis', 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        write: false, cssCodeSplit: false, reportCompressedSize: false, target: 'es2022',
        lib: { entry: `${root}/src/features/crate-viewer/main.ts`, name: 'ArdmpCrateViewer', formats: ['iife'] },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    })
    const outputs = Array.isArray(output) ? output.flatMap(result => result.output) : 'output' in output ? output.output : []
    const javascript = outputs.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
    const css = outputs.flatMap(item => item.type === 'asset' && item.fileName.endsWith('.css') ? [String(item.source)] : []).join('\n')
    if (!javascript || !css) throw new Error('RO-Crate viewer bundle is incomplete.')
    return `export const javascript = ${JSON.stringify(javascript)};\nexport const css = ${JSON.stringify(css)};`
  }
  return {
    name: 'ardmp-ro-crate-viewer',
    configResolved(config) { testMode = config.mode === 'test' },
    // Compile before test execution, rather than inside an export test's timeout.
    async buildStart() { if (testMode) await (bundle ??= compile()) },
    resolveId(source) { if (source === 'virtual:ro-crate-viewer') return id },
    load(source) { if (source === id) return bundle ??= compile() },
    handleHotUpdate(context) {
      if (!context.file.replace(/\\/g, '/').includes('/src/')) return
      bundle = undefined
      const module = context.server.moduleGraph.getModuleById(id)
      if (module) {
        context.server.moduleGraph.invalidateModule(module)
        return [module]
      }
    },
  }
}
