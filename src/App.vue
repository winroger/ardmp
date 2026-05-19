<script setup lang="ts">
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import AppShell from '@/components/AppShell.vue'
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <Toast position="bottom-right" />
  <ConfirmDialog />
</template>


