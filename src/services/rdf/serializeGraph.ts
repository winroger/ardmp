import { serialize, type Store } from 'rdflib'
import { normalizeStagingTurtlePrefixes } from '@/services/mapping/stagingSemantics'

export function serializeGraph(
  store: Store,
  format: 'text/turtle' | 'application/ld+json' | 'application/n-triples' = 'text/turtle',
): Promise<string> {
  return new Promise((resolve, reject) => {
    serialize(null, store, undefined, format, (err, str) => {
      if (err) reject(err)
      else resolve(format === 'text/turtle' ? normalizeStagingTurtlePrefixes(str ?? '') : (str ?? ''))
    })
  })
}
