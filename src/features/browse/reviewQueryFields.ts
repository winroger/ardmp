import rdf from '@rdfjs/data-model'
import type { Quad } from '@rdfjs/types'
import type { QueryEditor, ShaclForm } from '@ulb-darmstadt/shacl-form'
import type { QueryScope, ReviewQueryField } from '@/services/browse/reviewQuery'

/**
 * Read the form's resolved templates rather than re-parsing Turtle. This keeps
 * inherited/qualified branches and parser-generated blank shape IDs aligned
 * with the field IDs emitted by shacl-form.
 */
export function reviewQueryFields(form: Pick<ShaclForm, 'form'>): ReviewQueryField[] {
  type ShapeNode = NonNullable<ShaclForm['shape']>
  type Template = ShapeNode['template']
  function fixedProperties(template: Template, visited = new Set<Template>()): QueryScope['fixed'] {
    if (visited.has(template)) return []
    visited.add(template)
    return [
      ...Object.values(template.properties).flat().flatMap(property => property.hasValue && (property.path || property.pathAlternatives)
        ? [{ path: property.pathAlternatives ?? property.path!, value: property.hasValue }] : []),
      ...[...template.extendedShapes].flatMap(shape => fixedProperties(shape, visited)),
    ]
  }
  return [...form.form.querySelectorAll<QueryEditor>('.query-editor')].map(editor => {
    const scopes = new Map<string, QueryScope>()
    let node = editor.closest<ShapeNode>('shacl-node')
    while (node) {
      const template = node.template
      const context = node.queryContext ?? { path: [], shapePath: [] }
      const property = node.parentElement?.closest<HTMLElement & { template: { class?: { value: string }; qualifiedValueShape?: unknown } }>('shacl-property')
      // Qualified partitions need their class constraints to identify a branch.
      // Ordinary linked profiles also describe validation rules; a review search
      // must still find existing linked values when those records are invalid.
      const classes = property?.template.qualifiedValueShape
        ? (template.config.store.getQuads(template.id, rdf.namedNode('http://www.w3.org/ns/shacl#class'), null, null) as Quad[])
          .filter(quad => quad.object.termType === 'NamedNode').map(quad => quad.object.value)
        : []
      if (property?.template.qualifiedValueShape && property.template.class) classes.push(property.template.class.value)
      // Inherited shapes bind the same resource. Qualified branches already
      // have distinct shapePath entries; template IDs would incorrectly split
      // a role inherited from a base shape from an organization's own property.
      const key = JSON.stringify([context.path, context.shapePath])
      const existing = scopes.get(key)
      scopes.set(key, {
        key, depth: context.path.length,
        classes: [...new Set([...existing?.classes ?? [], ...classes])],
        fixed: [...existing?.fixed ?? [], ...fixedProperties(template)],
      })
      node = node.parentElement?.closest<ShapeNode>('shacl-node') ?? null
    }
    return { ...editor.queryField, scopes: [...scopes.values()].sort((a, b) => a.depth - b.depth) }
  })
}
