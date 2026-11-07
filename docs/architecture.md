# Modular monolith

Veriflow uses one Next.js application for the UI and HTTP API, with TypeScript packages for workflow semantics and browser execution. Bun manages dependencies and scripts; Node.js runs the application. There is no separate API service to deploy. See [current status](project-status.md) for the boundary between integrated features, available modules and unfinished work.

```text
apps/web/app                 pages, demo target and thin HTTP route handlers
apps/web/features            workbench, draft review, timelines and downloads
apps/web/server/composition  dependency wiring and HTTP boundary
apps/web/server/projects     atomic project/workflow/run metadata store
apps/web/server/attachments  project-scoped blob storage and reader adapter
apps/web/server/runs         run coordinator and report delivery
apps/web/server/agent        draft generation, provider adapter and bounded loop
apps/web/server/context      read-only context extraction and assembly
apps/web/server/templates    versioned definitions and deterministic draft builders
apps/web/server/reports      pure report renderers; CSV currently implemented
packages/core               workflow schemas, translation, execution and ports
packages/runner             real Playwright adapter, testing fakes and browser tests
```

## Dependency boundaries

The core owns workflow invariants and public contracts, and remains independent of Next.js and Playwright. HTTP handlers validate unknown input and call application services. Infrastructure implements core ports; the composition root selects concrete adapters. The UI consumes HTTP envelopes rather than importing storage, provider credentials or browser code.

`SessionFactory`, `ExecutionSession`, `AgentToolPort`, `AttachmentReader`, `DraftGenerator` and `ReportRenderer` keep lifecycle, AI, storage and presentation responsibilities separate. Use small interfaces for concrete behavior rather than adding abstraction layers solely to label the design DDD or SOLID. Projects, workflow revisions, runs and evidence carry the useful identity and consistency boundaries.

The legacy functionality/security/accessibility modules are extension points, not separate services or active team boundaries. Their evaluator fixtures are not proof of executed category checks. Current executable coverage flows through the shared workflow language and the real runner. Platform login remains separate from testing a target application's authentication.

## Workflow and run lifecycle

1. A user edits a workflow draft, either manually or from the deterministic template API. The AI generation preview is a labeled fixture; the generation HTTP adapter exists, but production provider configuration and UI binding remain pending.
2. Explicit save validates the workflow and creates an immutable revision using optimistic concurrency. Generation must never overwrite user edits.
3. Run creation pins a saved revision, captures project metadata, reserves bounded process capacity and persists the run identity.
4. The core translates the complete workflow before execution. The coordinator supplies project origins, viewport, timeout/abort signal and a storage-relative artifact directory to one isolated browser session.
5. Commands execute sequentially. Browser assertions determine outcomes. Ordinary failed steps block subsequent dependent steps; independent `assertRequirement` and `assertLayout` assertion failures allow later checks to execute. Infrastructure errors stop execution and remain distinct from test failures.
6. Evidence is flushed and resources close before terminal persistence. Reports use the immutable snapshot and registered evidence IDs, so subsequent workflow edits cannot change prior results.

Workflow version `1` includes navigation, fill, check/uncheck, click, assertions, viewport/layout checks, HTTP status checks, axe accessibility, supplied requirements and secret references. See [the core contract](../packages/core/README.md) and [coverage semantics](testing-coverage.md). Targets are exact labels or test IDs; arbitrary scripts/selectors are not accepted.

Cancellation is terminal only after cleanup. The coordinator distinguishes `completed` with `passed|failed|blocked` from `cancelled|error` with no assertion outcome. Restart recovery marks unfinished jobs as interrupted infrastructure errors. There is no durable distributed queue or automatic replay of target-mutating workflows.

## Runtime composition and persistence

`apps/web/server/composition/platform.ts` creates one process-level platform instance. It wires the real Playwright factory by default, a server-only secret resolver and the CSV renderer. Fake execution requires an explicit environment setting and remains labeled in runs and reports. Unknown adapter configuration fails explicitly.

Metadata lives in `STORAGE_DIR/platform-v1.json`; attachments, evidence and exported reports live under managed storage paths. Atomic file writes and an in-process lock protect one writer. Use a persistent volume and one long-running service process. Multiple replicas and serverless request lifetimes are unsupported. Project scoping is not application authentication.

CSV is rendered from the immutable snapshot and persisted before download. XLSX/PDF have shared transport contracts but no configured renderer. Generation reads and extracts supported text without modifying upload metadata, which remains `extraction=pending`; accepting a PDF or screenshot for storage does not imply extraction or model support.

## AI integration boundary

Dev 2's provider, draft validation, context assembly and bounded loop are implemented modules. Generation HTTP and read-only context assembly are integrated. Runtime provider configuration and model-to-browser composition remain pending. OpenAI environment settings alone do not connect these modules to the dashboard.

Generation currently accepts only `functional-exact-total` and `requirements-acceptance` template IDs. The newer dashboard coverage-template IDs use deterministic parameter binding and are not accepted by `DraftGenerator`. The integration contract must reconcile those inputs explicitly before the UI offers live generation for them.

The intended integrated loop uses a coordinator-owned session-bound `AgentToolPort`. Validate every model call before dispatch, enforce limits, preserve observed assertion results and let the coordinator own events, evidence and cleanup. Model explanations cannot change observed pass/fail/blocked results. A fake provider is explicit test data, never a silent fallback.

## Package development and ownership

Core and runner expose TypeScript source; Next.js transpiles both workspace packages. Runner depends on core, and web depends on both at runtime. Unit tests use `tsx`; browser tests have their own Playwright loading boundary. The [current CI blocker](project-status.md) concerns that test import boundary and must be resolved before the newer coverage release.

The standalone Next.js image is the deployable artifact; these private packages are not published libraries. A future standalone worker would need its own bundling/export and job-lifecycle design.

Dev 1 owns shared contracts and composition, Dev 2 AI/templates/context, Dev 3 browser execution/evidence, and Dev 4 UI/renderers/demo. New step types need coordinated schema, translation, adapter and regression coverage while preserving existing version-1 workflows. [The handoff](developer-handoff.md) defines exact paths; [REVIEW.md](../REVIEW.md) defines independent work and serial integration.
