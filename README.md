# Architectural RDM-Pipeline

Architectural RDM-Pipeline is a browser-based tool for turning tabular research
data into structured RDF datasets. It combines SHACL application profiles,
CSV or Airtable sources, visual mapping, enrichment services, SHACL validation,
metadata capture, and RO-Crate publishing in one Vue single-page application.

The app is designed for research data workflows where datasets should be
understandable, reproducible, and publishable without hand-writing Turtle files
or maintaining one-off conversion scripts.

[Demo](https://winroger.github.io/ardmp/)



## What You Can Do

- Load SHACL profiles in Turtle format and resolve `owl:imports`.
- Prepare source data from CSV files or Airtable tables.
- Load a built-in showcase project from the mapping view for demonstrations or onboarding.
- Build mappings visually on a Vue Flow canvas by connecting source columns to
  SHACL property shapes.
- Choose a subject identifier column for each mapped shape and original table.
  One table can supply Building, Location, and Stakeholder profiles with
  separate identifiers, while declared `sh:node` relationships keep them linked.
- Detect and display table-to-table references from Airtable-style linked
  record fields.
- Add enrichment nodes for GeoNames and Lobid/GND workflows.
  Choose the GeoNames input mode from the dropdown on the node or in its
  configuration: GeoNames ID, free text, or latitude/longitude for the nearest
  city or populated place. The canvas displays
  one input for ID/text and two inputs for latitude/longitude. Coordinate fields
  must come from the same table and use decimal degrees. The coordinate modes use
  the [GeoNames reverse geocoding service](https://www.geonames.org/export/reverse-geocoding.html).
  New nodes select Name, ID, Latitude, Longitude, and Country name by
  default. Other output fields remain available but are initially unselected.
  Changing mode clears previous results and removes incompatible input connections.
  Free text uses the first result from the
  [GeoNames search service](https://www.geonames.org/export/geonames-search.html).
  Include a country or region for more specific searches. Failed lookups leave
  their output rows empty while the remaining locations are processed. The node
  and its configuration panel report each failed input and its error message.
- Transform latitude/longitude columns into GeoSPARQL WKT points.
- Combine two or more columns from the same table with the `merge`
  transformation. Use `Add input` for additional fields. Values are joined in
  input order with `, `; empty values are skipped. Connect the merged output to
  a SHACL property or the GeoNames free text input, for example to search for
  `Berlin, Germany` from separate city and country columns.
  Merge also accepts fields from the same GeoNames node, for example its Name
  and Country name outputs. Run GeoNames to populate or refresh the merged
  output. Connections that would create a cycle are rejected.
- Generate RDF from the current mapping.
- Review generated RDF subjects as cards, tables, or Turtle.
- Validate generated RDF against the loaded SHACL profiles.
- Capture RO-Crate dataset metadata through a SHACL-form based publish view.
- Publish a ZIP package containing:
  - `ro-crate-metadata.json`
  - generated RDF as `data/dataset.ttl`
  - source tables as CSV
  - materialized enrichment or transform outputs as CSV when they are part of the exportable pipeline state
  - resolved SHACL profiles
  - RML mapping output

## Who It Is For

This tool is aimed at research data managers, data stewards, and domain experts
who need to prepare RDF datasets from tabular data while staying aligned with
SHACL-based application profiles. It is especially useful when a dataset needs
both machine-readable RDF and packaging metadata for publication or archival
handover.

## Main Workflow

1. Open the Prepare view.
2. Optionally load the built-in showcase project from `Options` for a ready-made example.
3. Add source data, for example a CSV file or an Airtable base.
4. Add a target schema by uploading a SHACL profile or loading an embedded
   profile.
5. Connect table columns to SHACL properties on the canvas.
6. Optionally add enrichment or transformation nodes.
7. Review generated RDF in the Review view.
8. Check validation results.
9. Complete dataset metadata in the Publish view.
10. Publish the RO-Crate ZIP.

## Entity identifiers and relationships

After mapping a column to a shape, its canvas node shows a **Subject identifier**
dropdown for each original table. The dropdown groups columns from that table
and its enrichment outputs. Select the CSV's `building_id` on Building and the
connect the GeoNames output's `id` to Building's Location (`sh:node`) property.
For profiles fed from the same original table, the referenced shape inherits
the connected field as its subject identifier. Location shows that field and
**Inherited from Building → Location**, instead of a separate selector. This
also works with a CSV column directly: a `geonames_id` column connected to the
reference becomes Location's identifier. Building keeps its CSV identifier.
When GeoNames has not run yet, the inheritance takes effect as soon as its output
is available. Changing the reference connection updates the inherited identifier;
removing it restores the independent selector. Saved connections carry this rule
without storing another primary-key selection on the target shape.
With target classes `ex:Building` and `ex:Location`, the generated subjects are
`http://example.org/Building/B1` and `http://example.org/Location/2950159`.
The selected value supplies the URL suffix; the target class supplies the class
segment. Without a target class, the shape name supplies that segment. Default
keeps the existing storage record ID (or first column for a source without record
IDs) from the original table. Selection changes RDF identity without changing
source row IDs. All mapped properties for the same profile and original row use
this identity, including properties supplied by enrichment outputs. Connecting a
GeoNames ID to Building's Location reference therefore adds a link on the existing
Building; it does not create a Building whose ID is the GeoNames ID. Multiple
Buildings keep their individual CSV IDs while sharing one Location.

If Building declares a property with `sh:node ex:LocationShape`, and both shapes
receive data from the same row, ARDMP automatically links the Building to that
row's Location. This also works through GeoNames, Lobid, and merge outputs that
retain their source lineage and row IDs. A reference column explicitly mapped
to the property takes precedence and defines the target identity for the same
original table. For unrelated tables, references can contain the target's selected
ID or an Airtable storage record ID; ARDMP resolves either to the target entity
URL while preserving that table's independently selected identifier.

Selected identifiers are trimmed and URL-encoded. Repeated IDs share a subject,
so several buildings can reference one Location. An empty or non-scalar selected
ID skips that entity and its automatic incoming links; the canvas reports the
affected row count. A missing selected column requires choosing another column.
The project saves these choices. RO-Crate exports include generated entity CSVs
with resolved subject and reference URLs, used by the RML mapping to preserve
the identities and links shown in the RDF preview.

## Technology

- Vue 3 and TypeScript
- Vite
- Pinia
- Vue Router
- PrimeVue
- Vue Flow and Dagre
- rdflib
- shacl-engine
- `@ulb-darmstadt/shacl-form`
- PapaParse
- localForage
- JSZip
- Vitest

## Development

Recommended runtime: Node.js 20 or newer.

```bash
npm install
npm run dev
npm run type-check
npm run lint
npm run test
npm run build
```

The local dev server is served by Vite, usually at:

```text
http://localhost:5173/
```

## Repository Layout

```text
src/
  assets/profiles/      bundled SHACL profiles
  components/           app-wide shared UI
  domain/               framework-light domain models
  features/             feature modules for mapping, browse, export, SHACL UI
  router/               route definitions
  services/             RDF, validation, export, mapping, project, infrastructure
  stores/               Pinia stores
  styles/               global SCSS and design tokens
  views/                route-level views
```

## Deployment

The app is a static hash-routed SPA and can be deployed to GitHub Pages. The
production base path is derived in `vite.config.ts` from the repository name
when the GitHub Actions workflow runs, so the source code does not hardcode a
Pages path.

The deployment workflow:

- installs dependencies with `npm ci`
- runs type checking
- builds the Vite app
- uploads `dist/`
- deploys through GitHub Pages

For GitHub Pages, set the repository Pages source to **GitHub Actions**.

## Project Status

The project is under active development. The current architecture separates
domain models, Pinia state, feature modules, infrastructure adapters, RDF
generation, validation, and export logic. Mapping extensions are being moved
toward explicit module boundaries so new importers, enrichers, transformations,
and exporters can be added without growing route views or central stores.

## License

MIT. See [LICENSE](LICENSE).
