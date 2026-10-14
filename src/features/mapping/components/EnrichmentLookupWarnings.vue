<script setup lang="ts">
import Message from 'primevue/message'

defineProps<{
  errors: Array<{ input: string; message: string }>
}>()
</script>

<template>
  <Message v-if="errors.length" severity="warn" :closable="false" class="lookup-warnings nodrag nowheel" @click.stop>
    <div>{{ errors.length }} lookup(s) failed. Output is empty for these entries.</div>
    <details>
      <summary>View failed locations</summary>
      <ul>
        <li v-for="error in errors" :key="error.input">
          <strong>{{ error.input }}</strong>: {{ error.message }}
        </li>
      </ul>
    </details>
  </Message>
</template>

<style scoped lang="scss">
.lookup-warnings {
  overflow-wrap: anywhere;
}

details {
  margin-top: var(--space-2);
}

summary {
  cursor: pointer;
}

ul {
  max-height: 200px;
  overflow-y: auto;
  padding-left: var(--space-4);
  margin: var(--space-2) 0 0;
}

li + li {
  margin-top: var(--space-2);
}
</style>
