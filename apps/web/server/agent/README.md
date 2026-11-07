# Workflow generation and bounded tools

Owner: Dev 2. Reviewer: Dev 3. Dev 1 owns composition and merging.
Original branch base: `3c432f1d9893749426f153c2ef7e503e74fbe4c5` (merged L0).
Updated against main `eb02beb608d7e52422f17561d491800a9be3bbac` after P3 landed.

## Integration

- `createFailureSummarizer({ provider, timeoutMs? })` returns the existing optional report summary value from finalized failed/blocked/error/cancelled snapshots. It separates fixed observations from unverified interpretation, validates step/evidence references and never mutates reports or outcomes. See [SUMMARIES.md](SUMMARIES.md) for its minimal provider input, bounds and integration requirements.
- `createDraftGenerator({ provider, timeoutMs? })` implements the shared `DraftGenerator`. The injected `DraftProvider.generate` receives a snapshot of the project, validated request, source documents and resolved versioned template definitions. It returns an unknown workflow object or JSON string, **not** a draft envelope. A1 validates it with `workflowSchema`, rejects credential URLs and navigation outside the project's configured origins, and adds trusted provider provenance, requested source IDs and fixed review warnings. Returned workflows are editable independent copies. There is no persistence dependency.
- `createFixtureProvider()` is explicit opt-in deterministic output. Its draft says `provider: fixture` and warns that no model was called. Missing provider configuration throws `AgentError("adapter_unavailable")`. A1 does not load credentials, select a model, perform network calls or silently install a fallback. Production composition must inject a real provider adapter; real-provider verification is **not performed** by this credential-free suite.
- A2 supplies optional `createOpenAIDraftProvider` and `createOpenAIAgentTurn` implementations for the existing injection seams. Their server configuration, bounds and separately opt-in live checks are documented in [OPENAI.md](OPENAI.md). Deterministic fixture tests still make no network requests.
- `assembleContext({ projectId, attachmentIds }, reader, signal, timeoutMs?)` uses the shared read-only `AttachmentReader`. It checks returned project/attachment identity and delegates to `contextExtractor`, the shared `ContextExtractor` implementation. No metadata or storage is written. Source IDs must match the generation request exactly after deduplication.
- `runAgentLoop({ next, tools, maxCalls?, timeoutMs? }, signal)` uses the coordinator's injected `AgentToolPort`. `next(history, signal)` returns unknown `{ kind: "tool", call }` or `{ kind: "done" }`. Every call is parsed through `browserToolCallSchema`; execute steps then pass through `translateWorkflow`. A response with an outcome or extra fields is rejected. Duplicate executed step IDs are rejected. Provider history is a copy, so a subsequent turn cannot mutate earlier observations.
- An initial observation may use the exact URL `about:blank`, as a newly opened browser session does before navigation. Other observation URLs must be credential-free HTTP(S). Navigation tools still require HTTP(S); the observation exception does not authorize navigation to other schemes.
- The loop returns `{ history, steps }` with observed results, never a model-declared final outcome. Independent `assertRequirement`/`assertLayout` results with `status: failed` and `failureKind: assertion` allow subsequent checks while retaining the failure. All other failed/blocked observations stop immediately. The provider validates the same continuation policy; finish never means pass. Infrastructure `failureKind` remains intact for the coordinator. On cancellation, timeout or tool/provider errors the loop throws; the coordinator must record its own per-step events as its injected port executes and finalize the run as cancelled/error. It must never infer a pass from an absent result.
- The coordinator owns browser origin enforcement (including redirects), event persistence, run outcome, session lifetime, evidence flushing and close. A1 never imports Playwright, opens or closes a session, or captures evidence. Browser text/results must already be credential-scrubbed by the browser adapter per L0. A1 bounds output and validates returned step identity/status. Finding metadata, nested evidence IDs and requirement metadata are validated and copied, including legacy `functionality` categories. Local limits are 1,000 findings per result, 100 unique evidence IDs per finding, 128 characters per identifier/rule ID, 20,000 characters per finding message, and shared requirement limits (128/2,000/256 for ID/text/source). A finding's optional step ID must match the executed step. Oversized or malformed metadata rejects instead of being dropped. Registered evidence ownership remains the coordinator's responsibility because the tool port has no evidence manifest.

## Limits

| Operation                                                | Default                                          | Allowed maximum                                |
| -------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Generation, context assembly or whole tool loop deadline | 30 seconds each                                  | 120 seconds each                               |
| Browser calls per loop, observe and execute combined     | 12                                               | 100                                            |
| Provider turns                                           | Tool calls plus one final decision               | `maxCalls + 1`                                 |
| Execute deadline                                         | Step's shared-schema timeout, default 30 seconds | 120 seconds; whole-loop deadline still applies |
| Observation text                                         | 8,000 characters                                 | Requested limit, at most 20,000                |
| Observation title / targets / target value               | 512 / 100 / 1,000 characters                     | Same                                           |
| Workflow provider output                                 | 200,000 serialized characters                    | Same                                           |
| Attachments / bytes / extracted text                     | Shared schemas                                   | 20 / 10 MiB each / 100,000 characters each     |

Limits must be positive integers. The final provider decision may stop exactly at the call limit; another tool call fails before dispatch. Deadlines include provider waits, and elapsed time is checked between calls even if promise chains delay timer callbacks. Abort signals propagate into providers and tools. A1 settles promptly when an adapter ignores abort, prevents any later dispatch, and leaves physical cleanup to the coordinator. JavaScript cannot preempt synchronous adapter code already running.

TXT, MD, CSV and JSON use strict UTF-8 decoding; JSON must parse. Empty/oversized text, binary control data, inconsistent byte counts and failed extraction metadata return safe errors. PDF and DOCX extraction are explicitly unsupported. PNG/JPEG extraction checks the signature and produces only an image reference, never OCR text or a claim to decode the image. A1 generation rejects images until a real image-capable adapter is designed through the shared contract process.

The [versioned template catalog](../templates/README.md) covers all six shared categories, preserving `functional-exact-total@1.0.0`. Generation supports functional and supplied-requirement drafts. Requirement-based drafts need nonblank text context, at least one `assert` or `assertRequirement` browser assertion and a trusted coverage warning. Responsive, security, accessibility and saved-revision regression selections reject before provider dispatch because the generation request does not bind their parameters or saved revisions. The workflow language now supports executable coverage through the separate deterministic [project-template API](../../../../docs/testing-coverage.md); that does not enable model generation for those selections. Mixed selections reject as a whole. The fixture tool port performs no real browser actions or captures; it cannot satisfy screenshot capability. Execution capability/prerequisite checks remain the coordinator and executor's responsibility and must produce blocked results.

## Safe error mapping for Dev 1

Only `AgentError.code` and its fixed `message` should cross an HTTP boundary. Do not serialize error objects, stacks or provider messages. Suggested mappings into existing `ApiError`:

| Local code                                                                                                         | Existing API code                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `adapter_unavailable`                                                                                              | `adapter_unavailable`                                             |
| `unsupported_format`                                                                                               | `unsupported_format`                                              |
| `attachment_unavailable`                                                                                           | `not_found`                                                       |
| `validation_error`, `context_mismatch`, `template_unavailable`, `extraction_failed`                                | `validation_error`                                                |
| `invalid_provider_output`, `provider_failed`, `invalid_tool_call`, `call_limit_exceeded`, `tool_failed`, `timeout` | `internal_error` with fixed public wording                        |
| `cancelled`                                                                                                        | Coordinator cancellation lifecycle; HTTP mapping belongs to Dev 1 |

No shared error union was changed. Dev 1 owns HTTP adapters and runtime provider configuration. The A2 provider transport is delegated to Dev 2; its reviewed-workflow input and configuration are documented in OPENAI.md.

## Verification and known contract corrections

Run the full gate in `REVIEW.md`. The focused suite is:

```sh
node --import tsx --test apps/web/tests/agent-*.test.ts apps/web/tests/context-*.test.ts apps/web/tests/templates-*.test.ts
```

Tests use explicitly labeled deterministic provider/tool fixtures, cover successful and malformed generation, safe errors, unsupported inputs, call limits, total/per-step deadlines, cancellation including noncooperative adapters, provenance, immutable history and observed assertion authority. No API credentials or real model are used. Browser suites exercise real deterministic execution, HTTP/UI integration and evidence, but do not prove real model-to-browser integration. See [project status](../../../../docs/project-status.md) for exact-commit CI limitations.

[P3 affected-consumer review](https://github.com/madacoda/veriflow/pull/6#issuecomment-6702319062) verified the resolution of both L0 findings: workflow navigation now shares the credential-free `httpUrlSchema`, and the shared attachment's declared size is derived from its actual 73 source bytes. P3 also removes the inherited platform timeout test's assumption that browser allocation occurs within 10 milliseconds. A1 retains its local URL policy checks and fixture byte-integrity checks. Core is unchanged by A1.
