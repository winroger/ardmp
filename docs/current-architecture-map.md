# Current Architecture Map

## Purpose

ARDMP is a Vue 3 + TypeScript single-page application for building RDF-oriented dataset packages from:

- tabular source data
- SHACL-based application profiles
- interactive canvas mappings
- optional enrichment and transform nodes
- dataset metadata

The current product focus is an app-internal runtime and export flow, not a backend execution system.

## Main Runtime Stores

The runtime state is currently coordinated through Pinia stores:

- `src/stores/dataStore.ts`
  - loaded tabular sources
  - node output sources
  - source snapshots/import/export support
- `src/stores/shapesStore.ts`
  - application profile
  - imported SHACL profiles
  - derived canvas shapes
- `src/stores/mappingStore.ts`
  - mapping edges
  - transform wiring
  - extension state
- `src/stores/metadataStore.ts`
  - dataset metadata values and Turtle assembly
- `src/stores/projectStore.ts`
  - project title and higher-level project state coordination

## Main Services

The most important service areas today are:

- `src/services/rdf`
  - RDF generation and serialization
- `src/services/export`
  - export assembly
  - RML generation
  - RO-Crate packaging
- `src/services/validation`
  - SHACL validation and result mapping
- `src/services/project`
  - snapshot normalization and project persistence helpers
- `src/services/mapping`
  - graph layout
  - mapping semantics
  - mapping edge helpers

## Main Canvas Modules

The canvas editor is application-internal UI infrastructure built around Vue Flow.

Relevant pieces:

- `src/views/AppView.vue`
  - current app-level canvas shell
- `src/features/mapping/useCanvasGraph.ts`
  - graph orchestration for nodes and edges
- `src/features/mapping/useCanvasConnections.ts`
  - connection and deletion behavior
- `src/features/mapping/mappingExtensionRegistry.ts`
  - app-internal registry for current mapping modules

Current packaged mapping modules include:

- source-data
  - CSV upload
  - Airtable
- shape sources
  - TTL upload
  - AIMS profile
- node modules
  - GeoNames enrichment
  - Lobid enrichment
  - lat-lng-to-wkt transform

## Main Export Flow

The current export flow is centered around the export view and export services.

High-level flow:

1. Runtime state is assembled from stores:
   - project title
   - application profile
   - loaded SHACL profiles
   - data sources
   - mapping state
   - metadata Turtle
2. The export path constructs `PipelineState`.
3. `PipelineState` is adapted into the current export input model.
4. Export services generate:
   - RDF dataset Turtle
   - RML mapping Turtle
   - RO-Crate metadata and package content
5. The package is downloaded/exported through the UI.

## Current Central Export State

The current practical center is now:

- `PipelineState`
- `ExportInput`
- `buildRoCratePackage`

The current seam works like this:

```text
stores/runtime state
  -> PipelineState
  -> adapters/wrappers
  -> ExportInput
  -> RDF / RML / RO-Crate generation
```

This remains close to the original export implementation because it gathers:

- `projectTitle`
- `ap`
- `profiles`
- `sources`
- `mapping`
- `metadataTurtle`

That means the export boundary now has an explicit shared runtime shape while still preserving the existing export implementation internally.

## Current Pain Points

The application works, and `PipelineState` is now in place, but the codebase is not fully simplified yet.

Main pain points:

- export-relevant state still starts in multiple stores before converging into `PipelineState`
- canvas/editor concerns and export/runtime concerns are still conceptually close in the current app structure
- extension runtime state exists, but its export meaning is still partially inferred through adapters and module conventions
- tests now protect the explicit export seam, but some larger feature areas are still easier to understand through source reading than through one stable contract

## Current Stabilization Direction

The main stabilization seam is now active:

- `PipelineState` exists as the plain exportable runtime model
- the export path constructs `PipelineState`
- wrappers exist for RDF, RML, and RO-Crate export

Current direction:

```text
stores + runtime state
  -> PipelineState
  -> RDF
  -> RML
  -> RO-Crate
  -> validation/export wrappers
```

This still does not require:

- a workflow engine
- a backend
- a plugin platform
- a rebuild of the application

Instead, it creates a traceable center for current behavior and a safer base for later cleanup.

## Why ExportInput Still Matters

The current system still converges near `ExportInput` and `buildRoCratePackage`.

That is why the new seam was added as wrappers and adapters instead of a redesign.

## Next Stabilization Target

Immediate next architectural target:

- keep pushing export-related logic through `PipelineState` wrappers
- use the seam to evaluate which pure runtime/export logic can move safely into `src/core`
- keep feature ownership clear so app-wide folders do not become mixed-purpose dumping grounds

This should become the shared seam for:

- RDF generation
- RML generation
- RO-Crate generation
- future persistence
- future backend execution, if introduced later

Without changing current working UI behavior.
