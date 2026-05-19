<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { APP_MODES, type AppModeKey } from '@/router'
import Button from 'primevue/button'

const route = useRoute()
const router = useRouter()

const activeMode = computed<AppModeKey>(() => {
  const matchedMode = APP_MODES.find(mode => route.path.startsWith(mode.path))
  return matchedMode?.key ?? 'app'
})

function navigate(modeKey: AppModeKey): void {
  const mode = APP_MODES.find(entry => entry.key === modeKey)
  if (!mode || route.path === mode.path) return
  void router.push(mode.path)
}
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <div class="app-shell__brand">
        <span class="app-shell__eyebrow">ARDMP</span>
        <h1>Architectural Research Data Mapping Pipeline</h1>
      </div>

      <nav class="app-shell__nav" aria-label="Application sections">
        <Button
          v-for="mode in APP_MODES"
          :key="mode.key"
          :label="mode.label"
          :icon="mode.icon"
          :severity="activeMode === mode.key ? 'contrast' : 'secondary'"
          :outlined="activeMode !== mode.key"
          size="small"
          @click="navigate(mode.key)"
        />
      </nav>
    </header>

    <main class="app-shell__content">
      <slot />
    </main>
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  color: var(--color-text);
}

.app-shell__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.app-shell__brand {
  display: flex;
  flex-direction: column;
  gap: 4px;

  h1 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
  }
}

.app-shell__eyebrow {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.app-shell__nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.app-shell__content {
  flex: 1;
  min-height: 0;
}

@media (max-width: 900px) {
  .app-shell__header {
    flex-direction: column;
    align-items: stretch;
  }

  .app-shell__nav {
    justify-content: flex-start;
  }
}
</style>
