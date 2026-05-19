# Architectural RDM-Pipeline

Architectural RDM-Pipeline is a browser-based tool for turning tabular research
data into structured RDF datasets. It combines SHACL application profiles,
CSV or Airtable sources, visual mapping, enrichment services, SHACL validation,
metadata capture, and RO-Crate export in one Vue single-page application.

The app is designed for research data workflows where datasets should be
understandable, reproducible, and publishable without hand-writing Turtle files
or maintaining one-off conversion scripts.

[Demo](https://winroger.github.io/ardmp/)



## What You Can Do

- Load SHACL profiles in Turtle format and resolve `owl:imports`.
- Import source data from CSV files or Airtable tables.
- Build mappings visually on a Vue Flow canvas by connecting source columns to
  SHACL property shapes.
- Detect and display table-to-table references from Airtable-style linked
  record fields.
- Add enrichment nodes for GeoNames and Lobid/GND workflows.
- Transform latitude/longitude columns into GeoSPARQL WKT points.
- Generate RDF from the current mapping.
- Browse generated RDF subjects as cards, tables, or Turtle.
- Validate generated RDF against the loaded SHACL profiles.
- Capture RO-Crate dataset metadata through a SHACL-form based export view.
- Export a ZIP package containing:
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

1. Open the mapping view.
2. Add source data, for example a CSV file or an Airtable base.
3. Add a target schema by uploading a SHACL profile or loading an embedded
   profile.
4. Connect table columns to SHACL properties on the canvas.
5. Optionally add enrichment or transformation nodes.
6. Review generated RDF in the browse view.
7. Check validation results.
8. Complete dataset metadata in the export view.
9. Export the RO-Crate ZIP.

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
