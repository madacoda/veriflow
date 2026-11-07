# L0: integration contracts v1

Status: merged in [PR #1](https://github.com/madacoda/veriflow/pull/1), main commit `3c432f1`. The merged contracts are unchanged from reviewed head `36feb2d`. Names and fixtures are the v1 baseline for independent work; implementation status remains separate. Reviewers: Dev 4 for API/result/report consumption, Dev 2 for context/tools/templates, Dev 3 for session/evidence behavior. Subsequent contract changes require affected-consumer review.

Import runtime schemas and DTOs from `@veriflow/core`; import clearly labeled, non-network fixtures from `@veriflow/core/fixtures`. `CONTRACT_VERSION` is `1`. Existing schemaVersion `1` workflows remain valid; `click` is additive. Label and test-ID targets remain exact. No CSS selectors, scripts, credentials, arbitrary filesystem paths or silently invented tools are accepted.

## P1 HTTP surface

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

P1/P2 implement the table above, evidence `GET .../runs/:runId/evidence/:evidenceId`, multipart `POST .../attachments` with field `file`, `GET .../attachments`, and binary report export `GET .../runs/:runId/report?format=csv|xlsx|pdf`. Dev 2 supplies extraction/generation/catalog functions. Dev 4 supplies a pure `ReportRenderer`, never HTTP or storage.

I1-C adds the existing planned generation/catalog routes without changing core DTOs:

| Method and path                                    | Input                     | Success envelope                          |
| -------------------------------------------------- | ------------------------- | ----------------------------------------- |
| POST `/api/projects/:projectId/workflows/generate` | `generationRequestSchema` | 200 `{ draft: WorkflowDraft }`            |
| GET `/api/templates`                               | none                      | 200 `{ templates: TemplateDefinition[] }` |

Generation reads the project's registered attachments and returns an editable draft without saving revisions, creating runs or modifying extraction metadata. One server-owned 30-second deadline includes body reading, context assembly and generation; trusted composition may set 1–120000 milliseconds. The request abort signal cancels these phases. Missing provider configuration returns 503; explicit run fixture mode does not configure a generation provider, and clients cannot select providers in the request body. A2 will supply a reviewed provider injected by server composition. Current text extraction supports TXT/MD/CSV/JSON; PDF/DOCX/image generation rejects explicitly. The catalog currently contains only `functional-exact-total@1.0.0` with its declared prerequisites/capabilities. Unsupported capabilities never imply a passing run.

The generation action also preserves GET `/api/projects/:projectId/workflows/generate?revision=1` for an existing workflow with ID `generate`; that identifier is not newly reserved.

Errors use `ApiError`: `{ error: { code, message, issues?: [{ path, message }] } }`. HTTP mapping: malformed JSON 400 `invalid_json`; input 422 `validation_error`; unknown project or cross-project resource 404 `not_found`; stale writes 409 `revision_conflict`; active report 409 `run_not_finished`; upload overflow 413 `payload_too_large`; unsupported media 415 `unsupported_format`; missing configured adapter 503 `adapter_unavailable`; unexpected failure 500 `internal_error`. Do not return provider messages, stacks, credentials or local absolute paths. The existing standalone workflow validation endpoint retains its original response for compatibility.

## Persistence and run semantics

- Server-generated project/run IDs. Project allowed origins initially contain only `new URL(project.url).origin`. The browser owner must enforce exact origins on initial navigation, redirects and tool actions. URL syntax validation alone is not network authorization.
- Saving a new workflow requires `expectedRevision: null`. Updating requires the current revision; stale writes reject atomically. Every revision is immutable. Saving the draft is a deliberate user action; generation cannot overwrite edits.
- Run creation requires an explicit saved revision. A subsequent edit never changes an active run or its report. Reruns create fresh run/evidence identities.
- Lifecycle is `queued → running → completed|cancelled|error`. Outcome is `passed|failed|blocked` only for completed runs; otherwise null. Missing prerequisites are blocked. Infrastructure errors do not imply an assertion failed.
- Legacy `runWorkflow` still returns status `failed` on an execution exception for compatibility, adding `failureKind: infrastructure`. The run coordinator maps that to lifecycle error/outcome null. Adapters return observed assertion failures as failed and prerequisite failures as blocked.
- Cancellation sets `cancelRequestedAt`, emits `cancellation_requested`, and aborts the shared signal. Terminal `cancelled` is persisted only after the adapter has cleaned up. Cancellation is idempotent, and cannot rewrite an already terminal run. Timeouts and incomplete shutdown must not be reported as success.
- Events are persisted with increasing, one-based sequence numbers and UTC ISO timestamps, scoped to a run. Poll the run endpoint for the current timeline; SSE is not required for P1.
- P1 uses a single long-running Node process and atomic file persistence. No distributed queue or multi-process writer is claimed. On restart, queued/running records become infrastructure errors with code `interrupted`; they never silently become passed.
- A fake adapter is opt-in and every fake run says `adapter: fake`. Production composition defaults to unavailable until Dev 3's real adapter is integrated. A fixture is never evidence of a real browser run.

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

## Shared demo target proposed for Dev 4

`/demo?bug=1` is known-fail and `/demo?bug=0` is known-pass. A base total of 100000 with coupon SAVE10 must become exact text `90000`. Freeze test IDs `coupon-input`, `apply-coupon`, `order-total`. Dev 4 confirms this contract before binding the browser tests. The core fixture contains a click and exact assertion; failed UI fixtures show expected `90000`, actual `100000` and a fake screenshot reference. Fixture artifact files are not real captures.

## Acceptance evidence

Core contract tests cover valid fixtures, legacy workflows, additive click translation, rejected unknown tools, observation bounds, unsupported attachments, create-only versus revision writes, and URL credentials. P1 must add actual restart, optimistic concurrency, project isolation, cancellation/cleanup and error mapping tests. Those storage/run guarantees are not established by DTO tests alone.
