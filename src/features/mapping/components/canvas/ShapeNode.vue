<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import type { NodeShape, PropertyShape } from '@/domain/NodeShape'
import { CANVAS_NODE_COLORS } from '@/features/mapping/canvasTheme'
import { useShapesStore } from '@/stores/shapesStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useDataStore } from '@/stores/dataStore'
import { identifierValue } from '@/services/mapping/mappingSemantics'
import { identitySourceForShape, sourceRoot } from '@/services/mapping/entityIdentity'
import { inheritReferenceIdentifiers, referenceIdentifiers } from '@/services/mapping/referenceIdentifiers'

const props = defineProps<{ data: { shape: NodeShape; onPreview?: () => void } }>()
const shapes = useShapesStore()
const mapping = useMappingStore()
const dataStore = useDataStore()
const identifierSources = computed(() => {
  const allShapes = shapes.ap.allNodeShapes()
  const references = referenceIdentifiers(allShapes, mapping.state, dataStore.sources).filter(item => item.shapeIri === props.data.shape.nodeId.value)
  const effective = inheritReferenceIdentifiers(allShapes, mapping.state, dataStore.sources)
  const sourceIds = new Set([...mapping.state.forShape(props.data.shape.nodeId.value).map(edge => edge.sourceId), ...references.map(item => item.sourceId)])
  const roots = new Map(dataStore.sources.filter(source => sourceIds.has(source.id))
    .map(source => [sourceRoot(source, dataStore.sources), source]))
  return [...roots].map(([rootId, mappedSource]) => {
    const candidates = dataStore.sources.filter(source => sourceRoot(source, dataStore.sources) === rootId)
    const root = candidates.find(source => source.id === rootId) ?? mappedSource
    const source = identitySourceForShape(props.data.shape, mappedSource, effective, dataStore.sources)
    const header = effective.subjectIdentifier(props.data.shape.nodeId.value, source.id)
    const inherited = references.find(item => item.sourceId === source.id)
    const index = header ? source.headers.indexOf(header) : -1
    return {
      rootId, root, source, candidates, inherited, header: header ?? '',
      value: header ? identifierOption(source.id, header) : '', missing: Boolean(header && index < 0),
      emptyCount: header && index >= 0 ? source.rows.filter(row => !identifierValue(row[index])).length : 0,
    }
  })
})

function identifierOption(sourceId: string, header: string): string {
  return JSON.stringify([sourceId, header])
}

function chooseIdentifier(rootId: string, event: Event): void {
  const related = new Set(dataStore.sources.filter(source => sourceRoot(source, dataStore.sources) === rootId).map(source => source.id))
  mapping.state.subjectIdentifiers = mapping.state.subjectIdentifiers.filter(item =>
    item.shapeIri !== props.data.shape.nodeId.value || !related.has(item.sourceId),
  )
  const value = (event.target as HTMLSelectElement).value
  if (value) {
    const [sourceId, header] = JSON.parse(value) as [string, string]
    mapping.state.setSubjectIdentifier(props.data.shape.nodeId.value, sourceId, header)
  }
}

const label = () => props.data.shape.label ?? localName(props.data.shape.nodeId.value)
const inheritedProperties = () => props.data.shape.properties.filter(property => property.inherited)
const ownProperties = () => props.data.shape.properties.filter(property => !property.inherited)

function localName(iri: string): string {
  return iri.split(/[/#]/).filter(Boolean).pop() ?? iri
}

function propertyLabel(p: PropertyShape): string {
  return p.name ?? (p.path ? localName(p.path.value) : p.nodeId.value)
}

function isObjectRef(p: PropertyShape): boolean {
  return Boolean(p.node)
}

function refShapeLabel(p: PropertyShape): string {
  if (!p.node) return ''
  const linked = shapes.ap.findNodeShape(p.node.value)
  return linked?.label ?? localName(p.node.value)
}

function cardinality(p: PropertyShape): string {
  const min = p.minCount ?? 0
  const max = p.maxCount ?? '*'
  return `${min}..${max}`
}

function inheritedFromLabel(p: PropertyShape): string {
  return p.inheritedFromShapeLabel ?? (p.inheritedFromShapeIri ? localName(p.inheritedFromShapeIri) : 'Inherited shape')
}
</script>

<template>
  <div
    class="shape-node"
    :style="{
      '--shape-header-bg': CANVAS_NODE_COLORS.shape.headerBackground,
      '--shape-header-color': CANVAS_NODE_COLORS.shape.headerColor,
      '--shape-preview-border': CANVAS_NODE_COLORS.shape.previewBorderColor,
      '--shape-ref-bg': CANVAS_NODE_COLORS.shape.accentBackground,
      '--shape-ref-hover-bg': CANVAS_NODE_COLORS.shape.accentHoverBackground,
      '--shape-badge-bg': CANVAS_NODE_COLORS.shape.badgeBackground,
      '--shape-badge-border': CANVAS_NODE_COLORS.shape.badgeBorderColor,
      '--shape-badge-color': CANVAS_NODE_COLORS.shape.badgeColor,
      '--shape-handle-color': CANVAS_NODE_COLORS.shape.handleColor,
      '--shape-inherited-bg': CANVAS_NODE_COLORS.shape.inheritedBackground,
    }"
  >
    <header>
      <Handle
        id="shape-header"
        type="target"
        :position="Position.Left"
        class="handle handle-shape-target"
      />
      <i class="pi pi-bookmark" />
      <span class="label">{{ label() }}</span>
      <button
        class="preview-btn"
        type="button"
        title="Preview shape"
        aria-label="Preview shape"
        @click.stop="data.onPreview?.()"
      >
        <i class="pi pi-eye" />
      </button>
    </header>

    <section v-if="identifierSources.length" class="subject-identifiers nodrag nowheel">
      <label v-for="item in identifierSources" :key="item.rootId" class="identifier-field">
        <span>Subject identifier · {{ item.root.name }}</span>
        <template v-if="item.inherited">
          <span class="identifier-value">{{ item.header }} · {{ item.source.name }}</span>
          <small>Inherited from {{ item.inherited.fromShape.label ?? localName(item.inherited.fromShape.nodeId.value) }} → {{ propertyLabel(item.inherited.property) }}</small>
        </template>
        <select v-else :value="item.value" class="form-select" :aria-label="`Subject identifier for ${item.root.name}`" @change="chooseIdentifier(item.rootId, $event)">
          <option value="">Default ({{ item.root.recordIds ? 'record ID' : item.root.headers[0] ?? 'first column' }} · {{ item.root.name }})</option>
          <option v-if="item.missing" :value="item.value">{{ item.header }} (missing column)</option>
          <optgroup v-for="source in item.candidates" :key="source.id" :label="source.name">
            <option v-for="header in source.headers" :key="header" :value="identifierOption(source.id, header)">{{ header }} · {{ source.name }}</option>
          </optgroup>
        </select>
        <small v-if="item.missing" class="identifier-warning">{{ item.inherited ? 'The connected identifier column is no longer available.' : 'Choose an available identifier column before generating RDF.' }}</small>
        <small v-else-if="item.emptyCount" class="identifier-warning">{{ item.emptyCount }} row(s) have no valid identifier; their entities are skipped.</small>
      </label>
      <small>All fields for this profile use this identifier, including fields from enrichment outputs.</small>
      <small>Declared references to profiles fed from the same row are linked automatically. A mapped reference column takes precedence.</small>
    </section>

    <div v-if="inheritedProperties().length > 0" class="section-label">Inherited properties</div>
    <ul class="properties">
      <li
        v-for="p in inheritedProperties()"
        :key="`inherited:${p.path?.value ?? p.nodeId.value}`"
        class="row inherited-row"
        :class="{ 'is-ref': isObjectRef(p) }"
      >
        <Handle
          v-if="p.path"
          :id="`p:${p.path.value}`"
          type="target"
          :position="Position.Left"
          class="handle"
          :class="isObjectRef(p) ? 'handle-ref-target' : 'handle-target'"
        />

        <template v-if="isObjectRef(p)">
          <i class="pi pi-link fk-icon" :title="refShapeLabel(p)" />
          <span class="prop-name">{{ propertyLabel(p) }}</span>
          <span class="prop-meta">{{ cardinality(p) }}</span>
          <Handle
            v-if="p.path"
            :id="`ref:${p.path.value}`"
            type="source"
            :position="Position.Right"
            class="handle handle-ref-source"
          />
        </template>

        <template v-else>
          <span class="prop-name">{{ propertyLabel(p) }}</span>
          <span v-if="p.datatype" class="type-badge">{{ localName(p.datatype.value) }}</span>
          <span class="prop-meta">{{ cardinality(p) }}</span>
        </template>

        <i class="pi pi-sitemap inheritance-icon" :title="`Inherited from ${inheritedFromLabel(p)}`" />
      </li>
    </ul>

    <div v-if="inheritedProperties().length > 0 && ownProperties().length > 0" class="section-label section-separator">Own properties</div>
    <ul class="properties">
      <li
        v-for="p in ownProperties()"
        :key="p.path?.value ?? p.nodeId.value"
        class="row"
        :class="{ 'is-ref': isObjectRef(p) }"
      >
        <Handle
          v-if="p.path"
          :id="`p:${p.path.value}`"
          type="target"
          :position="Position.Left"
          class="handle"
          :class="isObjectRef(p) ? 'handle-ref-target' : 'handle-target'"
        />

        <!-- FK reference property -->
        <template v-if="isObjectRef(p)">
          <i class="pi pi-link fk-icon" :title="refShapeLabel(p)" />
          <span class="prop-name">{{ propertyLabel(p) }}</span>
          <span class="prop-meta">{{ cardinality(p) }}</span>
          <Handle
            v-if="p.path"
            :id="`ref:${p.path.value}`"
            type="source"
            :position="Position.Right"
            class="handle handle-ref-source"
          />
        </template>

        <!-- Regular literal property -->
        <template v-else>
          <span class="prop-name">{{ propertyLabel(p) }}</span>
          <span v-if="p.datatype" class="type-badge">{{ localName(p.datatype.value) }}</span>
          <span class="prop-meta">{{ cardinality(p) }}</span>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.shape-node {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 300px;
  max-width: 380px;
  font-size: 0.85rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

header {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--shape-header-bg);
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  color: var(--shape-header-color);
}
.label { flex: 1; word-break: break-all; }
.preview-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--shape-preview-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: white;
    border-color: color-mix(in srgb, var(--shape-header-color) 35%, white);
  }
}

.properties { list-style: none; padding: 0; margin: 0; }

.subject-identifiers {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.identifier-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.identifier-value { font-family: var(--font-mono); }

.subject-identifiers small { color: var(--color-text-muted); }
.subject-identifiers .identifier-warning { color: #92400e; }

.section-label {
  padding: 6px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  background: var(--color-surface-2);
  border-bottom: 1px solid var(--color-border);
}

.section-separator {
  border-top: 1px solid var(--color-border);
}

.row {
  position: relative;
  padding: 5px 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
  &:last-child { border-bottom: none; }
  &.is-ref {
    background: var(--shape-ref-bg);
    &:hover { background: var(--shape-ref-hover-bg); }
  }
  &:not(.is-ref):hover { background: var(--color-surface-2); }
}

.inherited-row {
  background: var(--shape-inherited-bg);
}

.fk-icon {
  font-size: 0.75rem;
  color: var(--shape-handle-color);
  flex-shrink: 0;
}

.prop-name {
  flex: 1;
  font-family: var(--font-mono);
  word-break: break-all;
  font-size: 0.82rem;
}

.type-badge {
  font-size: 0.7rem;
  background: var(--color-surface-2);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.prop-meta {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.inheritance-icon {
  font-size: 0.75rem;
  color: var(--shape-badge-color);
  flex-shrink: 0;
}

.handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--color-surface-1) !important;
}
.handle-target      { background: var(--shape-handle-color) !important; }
.handle-ref-target  { background: var(--shape-handle-color) !important; }
.handle-ref-source  { background: var(--shape-handle-color) !important; }
.handle-shape-target { background: #d1d5db !important; }
</style>


