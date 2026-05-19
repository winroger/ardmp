# Refactoring Rules

## Purpose

These rules define how the current ARDMP stabilization phase must be executed.

The goal is to improve traceability, testability, and structural clarity of the current runtime and export flow without rebuilding the application.

## Do Not Do

Do not do any of the following during this phase unless explicitly requested later:

- no rebuild of the application
- no backend introduction
- no database introduction
- no authentication introduction
- no microservices
- no worker queue
- no workflow engine
- no Vue Flow replacement
- no public plugin API
- no package extraction
- no monorepo/package split
- no broad rename of major architecture areas
- no speculative abstractions for future infrastructure
- no new product features
- no new enrichment providers

## Core Direction

The current working runtime/export behavior must be preserved.

The stabilization path is:

```text
current runtime state
  -> explicit PipelineState
  -> RDF / RML / RO-Crate / validation wrappers
```

This means:

- keep current behavior working
- make exportable state explicit
- avoid large redesigns
- prefer thin adapters over rewrites

## Small Changes Only

Preferred scope:

- 100-300 changed lines: ideal
- 300-700 changed lines: acceptable if tightly scoped
- 1000+ changed lines: avoid

If a task starts growing too much, split it into smaller steps.

## Tests Before Risky Movement

Before moving logic related to:

- RDF generation
- RML generation
- RO-Crate export
- mapping serialization
- export assembly

add or strengthen tests around current behavior first.

## Preserve Export Behavior

The export button and current package structure must keep working during the stabilization phase.

Do not change:

- visible export behavior
- ZIP/package structure
- generated RDF meaning
- generated RML meaning

unless explicitly requested.

## PipelineState Before WorkflowDefinition

Do not introduce:

- `WorkflowDefinition`
- workflow engine abstractions
- execution graph abstractions
- backend executor abstractions

before `PipelineState` exists and is actually used.

`PipelineState` is the first required explicit model.

## Fixture Strategy

Two fixture levels should be used.

### 1. Minimal golden fixture

The AI should create this fixture autonomously.

It must:

- be self-contained
- be small and readable
- avoid Airtable
- avoid GeoNames
- avoid Lobid
- avoid credentials
- avoid network access
- avoid browser-only state

Recommended contents:

- one CSV source
- two rows
- one simple SHACL profile
- one simple metadata Turtle
- expected RDF
- expected RML
- expected RO-Crate metadata

### 2. Real export regression fixture

Use the existing exported project fixture for structural regression checks.

Prefer:

- parseability checks
- required file existence checks
- structural assertions

Avoid brittle full-file equality on large generated artifacts.

## Autonomous Fixture Creation Rule

During this first stabilization phase, the AI should proceed autonomously for:

- creating the minimal fixture
- choosing simple sample entities
- choosing simple SHACL shapes
- choosing simple CSV rows
- creating structural tests
- introducing PipelineState
- creating adapters and wrappers
- adding internal documentation

The AI should only stop for developer input before:

- deleting existing behavior
- removing compatibility behavior
- changing package paths
- changing visible UI behavior
- changing RDF meaning
- introducing backend or infrastructure changes

## Required Checks After Each Step

After each step, run:

- `npm run type-check`
- `npm run test`
- `npm run lint`
- `npm run build`

If one check cannot be completed, report:

```text
Step incomplete.
Reason:
Blocked by:
Suggested next action:
```

## Reporting Rule

After each completed step, report:

```text
## Step Completed: <step name>

### Files changed
- ...

### What changed
- ...

### Behavior impact
- ...

### Tests/checks
- [ ] npm run type-check
- [ ] npm run test
- [ ] npm run lint
- [ ] npm run build

### Definition of Done
- [ ] item
- [ ] item
- [ ] item

### Developer input needed
- None
```

## Practical Rule Set

Use the following operating rules during the phase:

- preserve working behavior
- prefer explicit state over implicit runtime coupling
- prefer adapters over rewrites
- isolate risky logic behind tests
- keep canvas/editor concerns separate from export-state concerns
- avoid unrelated cleanup while doing a scoped step
- document architectural intent as you stabilize the code
