# L0: integration contracts v1

Status: merged in [PR #1](https://github.com/madacoda/veriflow/pull/1), main commit `3c432f1`. That PR established the v1 baseline; additive step and result extensions have since landed. Names and fixtures remain shared across independent work. See [current implementation status](project-status.md) and [coverage extensions](testing-coverage.md). Reviewers: Dev 4 for API/result/report consumption, Dev 2 for context/tools/templates, Dev 3 for session/evidence behavior. Subsequent contract changes require affected-consumer review.

Import runtime schemas and DTOs from `@veriflow/core`; import clearly labeled, non-network fixtures from `@veriflow/core/fixtures`. `CONTRACT_VERSION` is `1`. Existing schemaVersion `1` workflows remain valid. Current steps also cover viewport/layout, HTTP status, axe accessibility, supplied requirements and server-side secret references. Label and test-ID targets remain exact. No arbitrary CSS selectors, scripts, filesystem paths or invented tools are accepted. Use `fillSecret` references for credentials; ordinary `fill` values are persisted and must not contain secrets.

## Implemented HTTP surface

All endpoints are same-origin, Node runtime, JSON unless specified. IDs are opaque; encode path segments with `encodeURIComponent`. A local single-user deployment is the P1 scope. Project scoping is data separation, not multi-user authentication.

| Method and path                                                 | Input                                                 | Success envelope                                       |
| --------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| GET `/api/projects`                                             | none                                                  | `{ projects: ProjectRecord[] }`                        |
| POST `/api/projects`                                            | `createProjectSchema`                                 | 201 `{ project: ProjectRecord }`                       |
| GET `/api/projects/:projectId`                                  | none                                                  | `{ project: ProjectRecord }`                           |
| GET `/api/projects/:projectId/workflows`                        | none                                                  | `{ workflows: WorkflowRevision[] }` (latest revisions) |
| POST `/api/projects/:projectId/workflows`                       | `saveWorkflowSchema`                                  | 201 `{ workflow: WorkflowRevision }`                   |
| GET `/api/projects/:projectId/workflows/:workflowId?revision=1` | optional positive integer revision; latest by default | `{ workflow: WorkflowRevision }`                       |
| GET `/api/projects/:projectId/runs`                             | none                                                  | `{ runs: RunRecord[] }`                                |
| POST `/api/projects/:projectId/runs`                            | `startRunSchema`                                      | 202 `{ run: RunRecord }`                               |
| GET `/api/projects/:projectId/runs/:runId`                      | none                                                  | `{ run: RunRecord }`                                   |
| POST `/api/projects/:projectId/runs/:runId/cancel`              | no body                                               | `{ run: RunRecord }`                                   |
| GET `/api/projects/:projectId/runs/:runId/report`               | terminal run only                                     | `{ snapshot: ReportSnapshot }`                         |

The table above is integrated. Additional implemented routes under `/api/projects/:projectId` are:

| Method and relative path                 | Input                             | Response                                                                  |
| ---------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| GET `/templates`                         | none                              | `{ templates }` with deterministic template options, schemas and defaults |
| POST `/templates`                        | `{ templateId, parameters }`      | `{ workflow }`, an unsaved draft with validated project origins           |
| GET `/attachments`                       | none                              | `{ attachments: AttachmentMetadata[] }`                                   |
| POST `/attachments`                      | multipart with exactly one `file` | 201 `{ attachment: AttachmentMetadata }`                                  |
| GET `/attachments/:attachmentId`         | none                              | `{ attachment: AttachmentMetadata }`                                      |
| GET `/attachments/:attachmentId/content` | none                              | Binary attachment download                                                |
| GET `/runs/:runId/evidence/:evidenceId`  | registered evidence ID            | Binary evidence download                                                  |
| GET `/runs/:runId/report?format=csv`     | terminal run                      | CSV from the immutable snapshot                                           |

The report transport also recognizes `xlsx|pdf`, but the configured CSV-only renderer rejects those formats with 422 `unsupported_format`. A custom platform instance with no renderer returns 503. Attachment storage acceptance does not imply extraction support; see [P2](platform-p2.md).

Generation `POST .../workflows/generate` and global `GET /api/templates` are **not implemented routes**. The existing project template endpoint constructs deterministic drafts without AI. Dev 1 owns HTTP/composition, Dev 2 extraction/generation/catalog functions, and Dev 4 pure report renderers.

Errors use `ApiError`: `{ error: { code, message, issues?: [{ path, message }] } }`. HTTP mapping: malformed JSON 400 `invalid_json`; input 422 `validation_error`; unknown project or cross-project resource 404 `not_found`; stale writes 409 `revision_conflict`; active report 409 `run_not_finished`; upload overflow 413 `payload_too_large`; unsupported upload media 415 `unsupported_format`; unconfigured export format 422 `unsupported_format`; missing configured adapter 503 `adapter_unavailable`; unexpected failure 500 `internal_error`. Do not return provider messages, stacks, credentials or local absolute paths. The existing standalone workflow validation endpoint retains its original response for compatibility.

## Persistence and run semantics

- Server-generated project/run IDs. Project allowed origins initially contain only `new URL(project.url).origin`. The browser owner must enforce exact origins on initial navigation, redirects and tool actions. URL syntax validation alone is not network authorization.
- Saving a new workflow requires `expectedRevision: null`. Updating requires the current revision; stale writes reject atomically. Every revision is immutable. Saving the draft is a deliberate user action; generation cannot overwrite edits.
- Run creation requires an explicit saved revision. A subsequent edit never changes an active run or its report. Reruns create fresh run/evidence identities.
- Lifecycle is `queued → running → completed|cancelled|error`. Outcome is `passed|failed|blocked` only for completed runs; otherwise null. Missing prerequisites are blocked. Infrastructure errors do not imply an assertion failed.
- Legacy `runWorkflow` still returns status `failed` on an execution exception for compatibility, adding `failureKind: infrastructure`. The run coordinator maps that to lifecycle error/outcome null. Adapters return observed assertion failures as failed and prerequisite failures as blocked.
- Cancellation sets `cancelRequestedAt`, emits `cancellation_requested`, and aborts the shared signal. Terminal `cancelled` is persisted only after the adapter has cleaned up. Cancellation is idempotent, and cannot rewrite an already terminal run. Timeouts and incomplete shutdown must not be reported as success.
- Events are persisted with increasing, one-based sequence numbers and UTC ISO timestamps, scoped to a run. Poll the run endpoint for the current timeline; SSE is not required for P1.
- P1 uses a single long-running Node process and atomic file persistence. No distributed queue or multi-process writer is claimed. On restart, queued/running records become infrastructure errors with code `interrupted`; they never silently become passed.
- A fake adapter is opt-in and every fake run says `adapter: fake`. Production composition defaults to the real Playwright adapter; Chromium must be installed to execute runs. Unknown adapter settings reject explicitly. A fixture is never evidence of a real browser run.

## Adapter boundaries

- `SessionFactory.open(SessionOptions, AbortSignal)` owns partial-open cleanup. One isolated session per run. `artifactDirectory` is a storage-relative destination computed by Dev 1, not accepted from a client. Resolve it under the configured persistent storage root. `viewport` is bounded by `startRunSchema`.
- `ExecutionSession.execute` returns the same step ID, expected/actual text when meaningful, and an observed status. Honor aborts and per-step timeouts. Return failed assertions; throw infrastructure failures. All text returned for UI/reports must be bounded and scrubbed of credentials.
- `evidence()` must flush PNG/WebM/trace capture before resolving; it may finalize/close its browser context. `close()` remains idempotent, releases all resources and tolerates evidence finalization already having closed the context. Do not finalize the run before both methods finish.
- `Evidence.artifactPath` is storage-relative, e.g. `runs/:runId/total.png`. Evidence retrieval resolves registered IDs from the run manifest, validates the run/step linkage, and prevents traversal/symlink escape. `EvidenceManifest.capture` must expose unavailable/partial capture instead of claiming complete evidence.
- Dev 2 gets an `AgentToolPort` bound to the coordinator's session. Validate every unknown call with `browserToolCallSchema` before dispatch, enforce maximum calls and cancellation, and never import Playwright. `observe` is capped at 20,000 characters. The coordinator owns finalization; the AI loop never closes a session or overrides observed results.
- `ContextExtractor` receives read-only bytes and metadata from an `AttachmentReader`. Supported metadata: TXT/MD/CSV/JSON/PDF/DOCX/PNG/JPEG, maximum 10 MiB each. Actual extraction support must return an explicit unsupported-format error until implemented. Screenshot context is an image reference, never pretend OCR text; model image loading uses the project-scoped reader. An image without model support must yield a warning or explicit failure.
- `DraftGenerator` returns a schema-validated `WorkflowDraft` with provenance and warnings. Real model configuration stays server-only. There is no automatic fallback to a fake provider presented as AI.
- Templates have a semantic version, category, prerequisites, JSON parameter schema and required capabilities. Missing execution capabilities produce blocked checks. Core does not claim all catalog capabilities are implemented.
- `ReportSnapshot` binds an immutable workflow revision, project metadata captured for the run, observed results and evidence. AI summary is optional and labeled by provider. CSV/XLSX/PDF reconcile against this same snapshot; renderers perform no persistence or browser execution.

## Shared demo target

`/demo?bug=1` is known-fail and `/demo?bug=0` is known-pass. A base total of 100000 with coupon SAVE10 must become exact text `90000`. Freeze test IDs `coupon-input`, `apply-coupon`, `order-total`. The target and browser tests use this contract. The core fixture contains a click and exact assertion; failed UI fixtures show expected `90000`, actual `100000` and a fake screenshot reference. Fixture artifact files are not real captures.

## Acceptance evidence

Core contract tests cover valid fixtures, legacy workflows, additive click translation, rejected unknown tools, observation bounds, unsupported attachments, create-only versus revision writes, and URL credentials. Platform tests cover restart, optimistic concurrency, project isolation, cancellation/cleanup and error mapping. Browser and production-route suites cover real execution and evidence ownership. DTO tests alone do not establish those guarantees; use exact-commit CI evidence, including the [current baseline limitation](project-status.md).
