import { describe, expect, it } from 'vitest'
import rdf from '@rdfjs/data-model'
import { graph, parse } from 'rdflib'
import { reviewQueryFields } from '@/features/browse/reviewQueryFields'
import { ReviewQueryIndex } from '@/services/browse/reviewQuery'

describe('query field shape context', () => {
  it('shares bindings across inherited shapes and preserves their fixed values', () => {
    const body = document.createElement('form')
    const node = (id: string, parent: HTMLElement, fixed?: string) => {
      const element = document.createElement('shacl-node')
      Object.assign(element, {
        queryContext: { path: ['urn:stakeholder'], shapePath: ['urn:stakeholder'] },
        template: {
          id: rdf.namedNode(id), extendedShapes: new Set(),
          properties: fixed ? { role: [{ path: 'urn:role', hasValue: rdf.namedNode(fixed) }] } : {},
          config: { store: { getQuads: () => [] } },
        },
      })
      parent.append(element)
      return element
    }
    const derived = node('urn:Derived', body, 'urn:Architect')
    const inherited = node('urn:Base', derived)
    const editor = (id: string, parent: HTMLElement, path: string[]) => {
      const element = Object.assign(document.createElement('div'), { queryField: { id, path, shapePath: path } })
      element.className = 'query-editor'
      parent.append(element)
    }
    editor('role', inherited, ['urn:stakeholder', 'urn:role'])
    editor('name', derived, ['urn:stakeholder', 'urn:name'])
    const fields = reviewQueryFields({ form: body })
    expect(fields[0].scopes).toEqual(fields[1].scopes)
    expect(fields[0].scopes).toHaveLength(1)
    expect(fields[0].scopes![0].fixed).toEqual([{ path: 'urn:role', value: rdf.namedNode('urn:Architect') }])
  })

  it('keeps qualified branches distinct even when their RDF paths are identical', () => {
    const body = document.createElement('form')
    for (const id of ['architect', 'contractor']) {
      const node = document.createElement('shacl-node')
      Object.assign(node, {
        queryContext: { path: ['urn:stakeholder'], shapePath: [id] },
        template: { id: rdf.blankNode(id), properties: {}, extendedShapes: new Set(), config: { store: { getQuads: () => [] } } },
      })
      const editor = Object.assign(document.createElement('div'), { queryField: { id, path: ['urn:stakeholder', 'urn:name'], shapePath: [id, 'urn:name'] } })
      editor.className = 'query-editor'
      node.append(editor)
      body.append(node)
    }
    const fields = reviewQueryFields({ form: body })
    expect(fields[0].scopes![0].key).not.toBe(fields[1].scopes![0].key)
  })

  it('finds buildings by linked architect names without requiring every linked profile validation constraint', () => {
    const data = graph()
    parse('@prefix ex: <http://example.org/> . ex:b a ex:Building; ex:architect ex:org . ex:org a ex:Organization; ex:name "XY Architects" .', data, 'http://example.org/', 'text/turtle')
    const index = new ReviewQueryIndex(data)
    const form = document.createElement('form')
    const property = Object.assign(document.createElement('shacl-property'), { template: { qualifiedValueShape: undefined as unknown } })
    const node = Object.assign(document.createElement('shacl-node'), {
      queryContext: { path: ['http://example.org/architect'], shapePath: ['http://example.org/architect'] },
      template: { id: rdf.namedNode('urn:OrganizationShape'), extendedShapes: new Set(), properties: {}, config: { store: {
        getQuads: () => [rdf.quad(rdf.namedNode('urn:OrganizationShape'), rdf.namedNode('http://www.w3.org/ns/shacl#class'), rdf.namedNode('http://www.w3.org/ns/prov#Organization'))],
      } } },
    })
    const path = ['http://example.org/architect', 'http://example.org/name']
    const editor = Object.assign(document.createElement('div'), { queryField: { id: 'architectName', path, shapePath: path } })
    editor.className = 'query-editor'
    form.append(property)
    property.append(node)
    node.append(editor)
    const fields = reviewQueryFields({ form })
    const query = { rootShapeId: 'urn:BuildingShape', targetClass: 'http://example.org/Building', criteria: [{ field: fields[0], operator: 'contains' as const, value: rdf.literal('XY') }] }
    expect(index.matchingRoots({ query, fields }, ['http://example.org/b'])).toEqual(new Set(['http://example.org/b']))
    // The same class constraint still distinguishes an explicitly qualified partition.
    property.template.qualifiedValueShape = {}
    expect(index.matchingRoots({ query, fields: reviewQueryFields({ form }) }, ['http://example.org/b']).size).toBe(0)
  })
})
