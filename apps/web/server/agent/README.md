# A1 generation and bounded tools

Owner: Dev 2. Reviewer: Dev 3. Dev 1 owns composition and merging.
Original branch base: `3c432f1d9893749426f153c2ef7e503e74fbe4c5` (merged L0).
Updated against main `eb02beb608d7e52422f17561d491800a9be3bbac` after P3 landed.

## Integration

- `createDraftGenerator({ provider, timeoutMs? })` implements the shared `DraftGenerator`. The injected `DraftProvider.generate` receives a snapshot of the project, validated request, source documents and resolved versioned template definitions. It returns an unknown workflow object or JSON string, **not** a draft envelope. A1 validates it with `workflowSchema`, rejects credential URLs and navigation outside the project's configured origins, and adds trusted provider provenance, requested source IDs and fixed review warnings. Returned workflows are editable independent copies. There is no persistence dependency.
- `createFixtureProvider()` is explicit opt-in deterministic output. Its draft says `provider: fixture` and warns that no model was called. Missing provider configuration throws `AgentError("adapter_unavailable")`. A1 does not load credentials, select a model, perform network calls or silently install a fallback. Production composition must inject a real provider adapter; real-provider verification is **not performed** by this credential-free suite.
- A2 supplies optional `createOpenAIDraftProvider` and `createOpenAIAgentTurn` implementations for the existing injection seams. Their server configuration, bounds and separately opt-in live checks are documented in [OPENAI.md](OPENAI.md). Deterministic fixture tests still make no network requests.
- `assembleContext({ projectId, attachmentIds }, reader, signal, timeoutMs?)` uses the shared read-only `AttachmentReader`. It checks returned project/attachment identity and delegates to `contextExtractor`, the shared `ContextExtractor` implementation. No metadata or storage is written. Source IDs must match the generation request exactly after deduplication.
- `runAgentLoop({ next, tools, maxCalls?, timeoutMs? }, signal)` uses the coordinator's injected `AgentToolPort`. `next(history, signal)` returns unknown `{ kind: "tool", call }` or `{ kind: "done" }`. Every call is parsed through `browserToolCallSchema`; execute steps then pass through `translateWorkflow`. A response with an outcome or extra fields is rejected. Duplicate executed step IDs are rejected. Provider history is a copy, so a subsequent turn cannot mutate earlier observations.
- An initial observation may use the exact URL `about:blank`, as a newly opened browser session does before navigation. Other observation URLs must be credential-free HTTP(S). Navigation tools still require HTTP(S); the observation exception does not authorize navigation to other schemes.
- The loop returns `{ history, steps }` with observed results, never a model-declared final outcome. Failed/blocked observations stop immediately. Infrastructure `failureKind` remains intact for the coordinator. On cancellation, timeout or tool/provider errors the loop throws; the coordinator must record its own per-step events as its injected port executes and finalize the run as cancelled/error. It must never infer a pass from an absent result.
- The coordinator owns browser origin enforcement (including redirects), event persistence, run outcome, session lifetime, evidence flushing and close. A1 never imports Playwright, opens or closes a session, or captures evidence. Browser text/results must already be credential-scrubbed by the browser adapter per L0. A1 bounds output and validates returned step identity/status.

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

The catalog starts with `functional-exact-total@1.0.0` from the shared fixture. Prerequisites, JSON parameter schema and required capabilities (including screenshot) are preserved. The fixture tool port performs no real browser actions or captures; it cannot satisfy screenshot capability. Missing catalog entries fail explicitly. Capability/prerequisite checks remain the coordinator and executor's responsibility and must produce blocked results.

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

Tests use explicitly labeled deterministic provider/tool fixtures, cover successful and malformed generation, safe errors, unsupported inputs, call limits, total/per-step deadlines, cancellation including noncooperative adapters, provenance, immutable history and observed assertion authority. No API credentials or real model are used. Browser smoke tests verify the repository scaffold; they do not prove real model-to-browser integration.

[P3 affected-consumer review](https://github.com/madacoda/veriflow/pull/6#issuecomment-6702319062) verified the resolution of both L0 findings: workflow navigation now shares the credential-free `httpUrlSchema`, and the shared attachment's declared size is derived from its actual 73 source bytes. P3 also removes the inherited platform timeout test's assumption that browser allocation occurs within 10 milliseconds. A1 retains its local URL policy checks and fixture byte-integrity checks. Core is unchanged by A1.
