# PipelineState

## What It Is

`PipelineState` is the plain TypeScript representation of the application's current exportable runtime state.

It captures the minimum information needed to drive:

- RDF generation
- RML generation
- RO-Crate packaging
- source table export

Current location:

- `src/core/pipeline/PipelineState.ts`

## What It Is Not

`PipelineState` is not:

- a workflow engine
- a job system
- a backend execution contract
- a public plugin API
- a replacement for the canvas UI

It is intentionally small and close to the current working export behavior.

## Relationship To Current Runtime State

Today the export path still starts from app runtime state spread across stores:

- `projectStore`
- `shapesStore`
- `dataStore`
- `mappingStore`
- `metadataStore`

That state is now assembled explicitly into `PipelineState` before export-oriented wrapper functions are called.

## Relationship To Export

The current export implementation still centers on `ExportInput` and `buildRoCratePackage`.

`PipelineState` now sits in front of that existing implementation:

```text
stores/runtime state
  -> createPipelineState()
  -> buildRoCrateFromPipelineState()
  -> pipelineStateToExportInput()
  -> buildRoCratePackage()
```

The same seam now exists for:

- `generateRdfFromPipelineState()`
- `generateRmlFromPipelineState()`

## Why This Helps

This gives the codebase one explicit object that answers:

- what will be exported
- where export inputs come from
- which data RDF/RML/RO-Crate logic actually depends on

That makes later refactors safer and easier to test.

## Future Backend Or Persistence Use

If the application later adds backend execution or persistent project storage, `PipelineState` is the right place to start because it already describes the export-relevant runtime state in one plain model.

That does not mean it should be treated as a final backend API yet. It is an app-internal seam first.

## Why It Is Not A Full Workflow Engine

The current application does not need a general workflow engine to stabilize export behavior.

The immediate need is traceability:

- clear export state
- clear adapters
- clear wrapper boundaries

`PipelineState` provides that traceable center without introducing speculative architecture.
