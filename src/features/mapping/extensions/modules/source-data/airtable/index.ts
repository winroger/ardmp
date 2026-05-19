import { CANVAS_EDGE_STYLES } from '@/features/mapping/canvasTheme'
import { defineAsyncComponent, markRaw } from 'vue'
import { createMappingExtensionModule } from '@/features/mapping/extensions/core/createMappingExtensionModule'
import { loadAirtableCredentials } from '@/services/infrastructure/storage/credentialStore'
import {
  AIRTABLE_PROVIDER_ID,
  getAirtableTablesForBase,
  listAirtableBases,
  refreshAirtableBase,
} from '@/features/mapping/extensions/modules/source-data/airtable/workflow'

const AirtableConnectPanel = defineAsyncComponent(() => import('@/features/mapping/components/setup/AirtableConnectPanel.vue'))
const HubNode = defineAsyncComponent(() => import('@/features/mapping/components/canvas/HubNode.vue'))

export const airtableModule = createMappingExtensionModule({
  id: 'source-data.airtable',
  setupDialogs: [
    {
      id: 'airtable-connect',
      header: 'Connect Airtable',
      width: '720px',
      component: AirtableConnectPanel,
      buildProps: payload => ({
        initialBaseId: payload?.initialBaseId,
      }),
    },
  ],
  dataSourceImports: [
    {
      id: 'airtable-tables',
      label: 'Airtable table',
      icon: 'pi pi-database',
      dialogId: 'airtable-connect',
    },
  ],
  canvasNodeTypes: {
    hubNode: markRaw(HubNode),
  },
  canvasModules: [
    {
      id: 'airtable-hub',
      buildNodes: context => listAirtableBases(context.visibleSources).map(baseId => {
        const tables = getAirtableTablesForBase(context.visibleSources, baseId)
        return {
          id: `${AIRTABLE_PROVIDER_ID}:${baseId}`,
          type: 'hubNode',
          position: { x: 0, y: 0 },
          data: {
            title: 'Airtable',
            subtitle: `${tables.length} table(s)`,
            icon: 'pi pi-database',
            sourceHandleId: 'airtable-out',
            rows: [
              {
                label: 'Base',
                value: baseId,
                asCode: true,
              },
            ],
            section: {
              label: 'Loaded tables',
              items: tables.map(table => table.name),
            },
            action: {
              label: 'Refresh',
              icon: 'pi pi-refresh',
              loading: context.isRefreshingSourceGroup(AIRTABLE_PROVIDER_ID, baseId),
              onClick: () => context.refreshSourceGroup(AIRTABLE_PROVIDER_ID, baseId),
            },
            onOpenConfig: () => context.openSetupDialog('airtable-connect', { initialBaseId: baseId }),
            onHoverChange: (isHovered: boolean) => context.setSourceGroupEdgeVisibility(AIRTABLE_PROVIDER_ID, baseId, isHovered),
          },
        }
      }),
      buildEdges: context => listAirtableBases(context.visibleSources).flatMap(baseId =>
        getAirtableTablesForBase(context.visibleSources, baseId).map(source => ({
          id: `${AIRTABLE_PROVIDER_ID}:${baseId}->${source.id}`,
          source: `${AIRTABLE_PROVIDER_ID}:${baseId}`,
          sourceHandle: 'airtable-out',
          target: `src:${source.id}`,
          targetHandle: 'table-parent',
          type: 'default',
          animated: false,
          style: { ...CANVAS_EDGE_STYLES.structural, opacity: 0 },
        })),
      ),
    },
  ],
  defaultNodePositions: {
    hubNode: { x: 40, y: 40 },
  },
  sourceGroupHandlers: [
    {
      id: 'source-data.airtable.refresh',
      provider: AIRTABLE_PROVIDER_ID,
      refreshGroup: async (baseId, context) => {
        const creds = await loadAirtableCredentials()
        if (!creds?.pat) {
          context.toast.add({
            severity: 'warn',
            summary: 'No Airtable token stored',
            detail: 'Reconnect Airtable before refreshing data.',
            life: 4000,
          })
          return {
            successSummary: 'Airtable not refreshed',
            successDetail: 'Missing stored token.',
          }
        }
        const refreshed = await refreshAirtableBase(context.dataStore, creds.pat, baseId)
        return {
          successSummary: 'Airtable updated',
          successDetail: `${refreshed} table(s) reloaded. Existing mappings were preserved.`,
        }
      },
    },
  ],
})


