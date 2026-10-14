import type { MappingExtensionModule } from '@/features/mapping/extensions/core/types'
import { airtableModule } from '@/features/mapping/extensions/modules/source-data/airtable'
import { csvFileModule } from '@/features/mapping/extensions/modules/source-data/csv-file'
import { aimsProfileModule } from '@/features/mapping/extensions/modules/shape-sources/aims-profile'
import { ttlUploadModule } from '@/features/mapping/extensions/modules/shape-sources/ttl-upload'
import { geoNamesModule } from '@/features/mapping/extensions/modules/nodes/geonames'
import { latLngToWktModule } from '@/features/mapping/extensions/modules/nodes/lat-lng-to-wkt'
import { lobidModule } from '@/features/mapping/extensions/modules/nodes/lobid'
import { mergeModule } from '@/features/mapping/extensions/modules/nodes/merge'

export const mappingExtensionModules: MappingExtensionModule[] = [
  csvFileModule,
  airtableModule,
  ttlUploadModule,
  aimsProfileModule,
  geoNamesModule,
  lobidModule,
  latLngToWktModule,
  mergeModule,
]

