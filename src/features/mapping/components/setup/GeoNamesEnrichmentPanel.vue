<script setup lang="ts">
import { computed, ref } from 'vue'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Listbox from 'primevue/listbox'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import {
  GEONAMES_NODE_STATE_KEY,
  getGeoNamesInputEdges,
  getGeoNamesInputMode,
  updateGeoNamesNode,
} from '@/features/mapping/extensions/modules/nodes/geonames/workflow'
import { GEO_NAMES_OUTPUT_OPTIONS, type GeoNamesInputType, type GeoNamesOutputField } from '@/features/mapping/extensions/modules/nodes/geonames/client'
import type { GeoNamesNodeConfig } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import { GEONAMES_DEFAULT_OUTPUTS, GEONAMES_INPUT_OPTIONS, geoNamesInputOption } from '@/features/mapping/extensions/modules/nodes/geonames/types'
import { useDataStore } from '@/stores/dataStore'
import { useMappingStore } from '@/stores/mappingStore'
import EnrichmentLookupWarnings from '@/features/mapping/components/EnrichmentLookupWarnings.vue'

const emit = defineEmits<{ added: [] }>()

const props = defineProps<{
  nodeId?: string
}>()

const mapping = useMappingStore()
const data = useDataStore()
const toast = useToast()
const currentNode = computed(() => props.nodeId ? mapping.findExtensionNode<GeoNamesNodeConfig>(GEONAMES_NODE_STATE_KEY, props.nodeId) : undefined)
const username = ref(currentNode.value?.username ?? '')
const inputMode = ref<GeoNamesInputType>(currentNode.value ? getGeoNamesInputMode(mapping, currentNode.value.id) : 'id')
const inputOptions = [...GEONAMES_INPUT_OPTIONS]
const selectedInputOption = computed(() => geoNamesInputOption(inputMode.value))
const selectedOutputs = ref<GeoNamesOutputField[]>([...(currentNode.value?.selectedOutputs ?? GEONAMES_DEFAULT_OUTPUTS)])
const isSubmitting = ref(false)
const error = ref<string | null>(null)

const outputOptions = [...GEO_NAMES_OUTPUT_OPTIONS]
const outputLabelById = new Map(outputOptions.map(option => [option.id, option.name] as const))

const inputConnections = computed(() => {
  if (!currentNode.value) return []
  const edges = getGeoNamesInputEdges(mapping, currentNode.value.id)
  return selectedInputOption.value.inputs.map(input => {
    const edge = edges.find(candidate => candidate.targetHandle === input.id)
    if (!edge) return { label: 'Not connected', itemCount: 0, inputLabel: input.label }
    const sourceId = edge.source.startsWith('src:') ? edge.source.slice(4) : `merge-output:${edge.source}`
    const sourceHeader = edge.sourceHandle.startsWith('h:') ? edge.sourceHandle.slice(2) : ''
    const source = data.findById(sourceId)
    if (!source) return { label: `${edge.source.startsWith('merge:') ? 'merge' : edge.source.startsWith('split:') ? 'split' : edge.source.startsWith('hash:') ? 'HASH' : sourceId} / ${sourceHeader}`, itemCount: 0, inputLabel: input.label }
    const headerIndex = source.headers.indexOf(sourceHeader)
    const itemCount = headerIndex >= 0
      ? source.rows.map(row => String(row[headerIndex] ?? '').trim()).filter(Boolean).length
      : 0
    return { label: `${source.name} / ${sourceHeader}`, itemCount, inputLabel: input.label }
  })
})

async function addNode(): Promise<void> {
  error.value = null
  if (!username.value.trim()) {
    error.value = 'Enter a GeoNames username.'
    return
  }
  if (selectedOutputs.value.length === 0) {
    error.value = 'Select at least one output field.'
    return
  }

  isSubmitting.value = true
  try {
    if (currentNode.value) {
      updateGeoNamesNode(mapping, data, currentNode.value.id, {
        username: username.value.trim(),
        inputMode: inputMode.value,
        selectedOutputs: [...selectedOutputs.value],
      })
      toast.add({ severity: 'success', summary: 'GeoNames updated', detail: 'The GeoNames node configuration was saved.', life: 3000 })
    } else {
      const createdNode = mapping.createExtensionNode(GEONAMES_NODE_STATE_KEY, 'geonames', id => ({
        id,
        username: username.value.trim(),
        inputMode: inputMode.value,
        selectedOutputs: [...GEONAMES_DEFAULT_OUTPUTS],
        status: 'idle',
        stats: { totalCount: 0, processedCount: 0, cachedCount: 0 },
        results: {},
      }))
      if (createdNode) {
        updateGeoNamesNode(mapping, data, createdNode.id, {
          selectedOutputs: [...selectedOutputs.value],
        })
      }
      toast.add({ severity: 'success', summary: 'GeoNames added', detail: 'The GeoNames enrichment node is now on the canvas.', life: 3000 })
    }
    emit('added')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="geonames-panel">
    <label class="field field-stack">
      <span>GeoNames username</span>
      <InputText v-model="username" placeholder="username" fluid />
    </label>

    <label class="field field-stack">
      <span>Input mode</span>
      <Select
        v-model="inputMode"
        :options="inputOptions"
        option-label="label"
        option-value="inputType"
        aria-label="GeoNames input mode"
        :disabled="currentNode?.status === 'running'"
        fluid
      />
      <span>{{ selectedInputOption.description }}</span>
    </label>

    <label class="field field-stack">
      <span>Output properties</span>
      <Listbox
        v-model="selectedOutputs"
        :options="outputOptions"
        option-label="name"
        option-value="id"
        multiple
        list-style="max-height:260px"
      >
        <template #option="slotProps">
          <div class="picker-option">
            <strong>{{ slotProps.option.name }}</strong>
            <span>{{ slotProps.option.description }}</span>
          </div>
        </template>
      </Listbox>
    </label>

    <Message severity="info" :closable="false">
      <template v-if="inputConnections.length">
        <div v-for="connection in inputConnections" :key="connection.inputLabel">
          {{ connection.inputLabel }} connection: {{ connection.label }} ({{ connection.itemCount }} values)
        </div>
      </template>
      <template v-else>
        Connect {{ selectedInputOption.inputs.map(input => input.label).join(' and ') }} in the canvas before running it.
      </template>
    </Message>

    <Message severity="info" :closable="false">
      Saving a different input mode clears previous results and removes incompatible input connections.
      <template v-if="selectedInputOption.inputs.length === 2">
        Latitude and longitude must come from the same table. Use decimal degrees: latitude -90 to 90, longitude -180 to 180.
      </template>
      Failed lookups leave their output empty and are reported as warnings.
    </Message>

    <section class="io-grid flow-io-grid">
      <div class="io-block flow-io-block">
        <h3 class="panel-title">Input</h3>
        <div class="output-list">
          <Tag v-for="input in selectedInputOption.inputs" :key="input.id" :value="input.label" severity="info" />
        </div>
      </div>
      <div class="io-block flow-io-block">
        <h3 class="panel-title">Output</h3>
        <div class="output-list">
          <Tag v-for="field in selectedOutputs" :key="field" :value="outputLabelById.get(field) ?? field" severity="success" />
        </div>
      </div>
    </section>

    <EnrichmentLookupWarnings :errors="currentNode?.lookupErrors ?? []" />
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div class="actions actions-row actions-row--start">
      <Button
        :label="currentNode ? 'Save GeoNames node' : 'Add GeoNames node'"
        :icon="currentNode ? 'pi pi-check' : 'pi pi-plus'"
        :loading="isSubmitting"
        :disabled="currentNode?.status === 'running'"
        @click="addNode"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.geonames-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field {
  max-width: 560px;
}

.io-block .panel-title { margin-bottom: 0; }

.output-list {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.picker-option {
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    font-size: 0.92rem;
  }

  span {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
}

</style>


