# Architecture Overview

This file is the quickest entry point for understanding the current ARDMP structure.

## Placement Rule For Vue Files

Do not collect all `.vue` files in one global `src/components` folder.

Use this ownership rule instead:

- `src/views`
  - route-level screens
- `src/components`
  - app-wide shared shell or UI used across unrelated features
- `src/features/<feature>/components`
  - UI owned by one feature
- `src/features/<feature>/...`
  - helpers, composables, and local wiring that belong to that feature

Current recommendation:

- keep [AppShell.vue](../src/components/AppShell.vue) in shared `components`
- keep mapping canvas/setup/preview components inside `src/features/mapping/components`
- keep browse-specific UI inside `src/features/browse/components`
- keep route screens in `src/views`

## High-Level Runtime

```mermaid
flowchart TD
    Main["main.ts"] --> App["App.vue"]
    App --> Shell["components/AppShell.vue"]
    Shell --> Router["router/index.ts"]

    Router --> AppView["views/AppView.vue<br/>Mapping Shell"]
    Router --> BrowseView["views/BrowseView.vue<br/>RDF Browse"]
    Router --> ExportView["views/ExportView.vue<br/>Metadata + Export"]

    AppView --> MappingFeature["features/mapping"]
    BrowseView --> BrowseFeature["features/browse"]
    BrowseView --> BrowseDialog["features/browse/components/SubjectDetailDialog.vue"]
    ExportView --> ShaclFeature["features/shacl"]

    MappingFeature --> MappingRegistry["mappingExtensionRegistry.ts"]
    MappingFeature --> CanvasGraph["useCanvasGraph.ts"]
    MappingFeature --> CanvasConnections["useCanvasConnections.ts"]
    MappingFeature --> MappingComponents["mapping/components/*"]

    AppView --> DataStore["stores/dataStore.ts"]
    AppView --> ShapesStore["stores/shapesStore.ts"]
    AppView --> MappingStore["stores/mappingStore.ts"]
    ExportView --> MetadataStore["stores/metadataStore.ts"]
    ExportView --> ProjectStore["stores/projectStore.ts"]
    BrowseView --> DataStore
    BrowseView --> ShapesStore
    BrowseView --> MappingStore
```

## Export And Validation Flow

```mermaid
flowchart LR
    DataStore["dataStore"] --> Pipeline["core/pipeline/PipelineState"]
    ShapesStore["shapesStore"] --> Pipeline
    MappingStore["mappingStore"] --> Pipeline
    MetadataStore["metadataStore"] --> Pipeline
    ProjectStore["projectStore"] --> Pipeline

    Pipeline --> Adapter["services/pipeline/pipelineExportAdapter.ts"]
    Adapter --> ExportInput["ExportInput"]

    ExportInput --> RDF["services/rdf/rdfGenerator.ts"]
    ExportInput --> RML["services/export/rmlSerializer.ts"]
    ExportInput --> ROCrate["core/export/roCrate.ts"]

    RDF --> Package["services/export/exportService.ts"]
    RML --> Package
    ROCrate --> Package

    Package --> Zip["RO-Crate ZIP"]
    RDF --> Browse["services/browse/browseService.ts"]
    RDF --> Validation["services/validation/*"]
```

## Layered Reading Order

For a new developer, this is the most useful reading order:

1. `src/router/index.ts`
2. `src/App.vue`
3. `src/views/AppView.vue`, `src/views/BrowseView.vue`, `src/views/ExportView.vue`
4. `src/stores/*`
5. `src/features/mapping/*` and `src/features/browse/*`
6. `src/services/pipeline/*`
7. `src/services/export/*`, `src/services/rdf/*`, `src/services/validation/*`
8. `src/domain/*`

## Current Structural Takeaway

The project is no longer best described as one big Vue app with helpers. It now reads more clearly as:

- app shell and route views
- feature-owned UI and workflows
- stores as runtime coordination
- services as business logic and export logic
- `PipelineState` as the explicit export seam

That is the structure new contributors should learn first.
