# Core Extraction Readiness

## Purpose

This note evaluates which parts of the current codebase are already pure enough for a later `src/core` extraction and which parts still depend on app-level infrastructure.

This document does not move files yet.

## Good Candidates For Future Core Extraction

These files or file groups are already close to pure application logic:

- `src/core/pipeline/PipelineState.ts`
- `src/core/export/roCrate.ts`
- `src/domain/DataSource.ts`
- `src/domain/Mapping.ts`
- large parts of `src/domain/NodeShape.ts`
- `src/services/export/datasetMetadata.ts`
- `src/services/export/profileMetadata.ts`
- `src/services/pipeline/*`

Reason:

- they are TypeScript-first
- they do not depend on Vue components
- they do not depend on Vue Flow
- they represent export/runtime semantics more than UI behavior

## Files Still Coupled To Vue, Pinia, Or Vue Flow

These must remain app-level for now:

- `src/views/*.vue`
- `src/stores/*.ts`
- `src/features/mapping/useCanvasGraph.ts`
- `src/features/mapping/useCanvasConnections.ts`
- `src/features/mapping/components/**/*`
- `src/features/shacl/useShaclFormViewer.ts`
- `src/features/mapping/mappingExtensionRegistry.ts`

Reason:

- they import Vue reactivity, Pinia, Vue Flow, or browser-only UI machinery

## Files With Browser API Dependence

These are not yet safe as pure core modules:

- `src/services/export/exportService.ts`
  - `Blob`, `document`, download behavior
- `src/features/shacl/useShaclFormViewer.ts`
  - custom elements / DOM integration
- UI-triggered preview and dialog helpers

## Files Depending On Mapping Registry Or App Runtime Wiring

These are still strongly app-internal:

- `src/features/mapping/mappingExtensionRegistry.ts`
- `src/features/mapping/extensions/modules/**/*`
- `src/stores/mappingStore.ts`
- `src/services/mapping/**/*`

Reason:

- they encode current canvas/runtime module orchestration rather than stable portable core logic

## Files Likely Safe To Move Later

Most likely next low-risk move candidates:

- `src/services/export/datasetMetadata.ts`
- `src/services/export/profileMetadata.ts`
- `src/services/pipeline/*`
- selected pure helpers from `src/domain/*`

These should move only after import boundaries are reviewed and tests continue to cover export behavior.

## Files That Should Stay App-Level

These should not move into core in the near term:

- views
- stores
- canvas graph builders
- connection handlers
- extension registry
- extension setup panels
- download helpers
- browser persistence adapters

## Main Blockers Before Larger Core Extraction

- `NodeShape.ts` still mixes rich domain behavior with parsing details that should be reviewed carefully before moving pieces out
- `exportService.ts` mixes pure export assembly with browser download concerns
- mapping runtime behavior is still partially distributed across stores, extension modules, and canvas-facing services
- the extension registry remains app-internal infrastructure, not a stable portable contract

## Readiness Summary

The codebase is now ready for a small, selective core extraction strategy, not a broad move.

Best next principle:

- move only pure export/runtime models and wrappers
- keep UI orchestration and extension runtime at app level
- preserve the new `PipelineState` seam as the center for later moves
