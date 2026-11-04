import { javascript, css } from 'virtual:ro-crate-viewer'
import type { CrateViewerPayload } from '@/features/crate-viewer/types'

export function escapeViewerHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function safeViewerJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

interface DatasetMetadata { name: string; description?: string; datePublished: string; license?: string; agents?: { name: string }[] }

export function buildCrateViewerHtml(payload: CrateViewerPayload, metadata: DatasetMetadata): string {
  const text = escapeViewerHtml
  const license = metadata.license && /^https?:\/\//i.test(metadata.license)
    ? `<a href="${text(metadata.license)}" target="_blank" rel="noopener">${text(metadata.license)}</a>` : text(metadata.license)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${text(metadata.name)}</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
<style>.crate-header{padding:24px;background:var(--color-logo-panel);border-bottom:1px solid var(--color-border)}.crate-header h1{margin:0 0 8px;font-size:1.6rem}.crate-header p{margin:8px 0;max-width:1000px}.crate-files{display:flex;gap:16px;flex-wrap:wrap;margin-top:16px}.crate-files a{color:var(--color-text-accent)}.crate-meta{color:var(--color-text-muted);font-size:.875rem}body{height:auto;min-height:100vh}#ardmp-crate-viewer{min-height:600px}</style>
</head><body><header class="crate-header"><h1>${text(metadata.name)}</h1>
<p>${text(metadata.description)}</p><p class="crate-meta">Published ${text(metadata.datePublished)}${metadata.agents?.length ? ` · ${text(metadata.agents.map(agent => agent.name).join(', '))}` : ''}</p>
${metadata.license ? `<p class="crate-meta">License: ${license}</p>` : ''}
<nav class="crate-files" aria-label="Dataset files"><a href="data/dataset.ttl" download>RDF dataset</a><a href="ro-crate-metadata.json" download>RO-Crate metadata</a><a href="mapping/mapping.rml.ttl" download>RML mapping</a><a href="README.md">README</a></nav></header>
<noscript><p>Enable JavaScript for interactive Review and Analyze. The dataset metadata and file links above remain available.</p></noscript>
<main id="ardmp-crate-viewer" aria-label="Dataset explorer"><p>Opening dataset viewer…</p></main>
<script id="ardmp-viewer-data" type="application/json">${safeViewerJson(payload)}</script>
<script>${javascript.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`
}
