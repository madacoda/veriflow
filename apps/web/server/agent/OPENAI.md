# A2: OpenAI provider for I1

Owner: Dev 2. Reviewer: Dev 3. Dev 1 owns composition and serial merging.
Branch: `codex/a2-openai-provider`. Original stacked base: A1 `5728daddfb71c520790bb9c491c55881eb4b4394`, including B1 main `39bd03ddc2ed5104738bf787b85588e1270033f7`.

Outcome: real model generation and tool decisions use the existing A1 injection seams and shared v1 validation. Allowed paths remain agent/context/templates and their owned test files. No route, storage, browser, core, manifest or lockfile edits. The existing OpenAI SDK dependency is reused. This adapter does not make the full product journey available until Dev 1 wires it into the application.

## Composition

Use trusted server configuration, never a request body or model output:

```ts
const config = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
};
const generator = createDraftGenerator({
  provider: createOpenAIDraftProvider(config),
});
const next = createOpenAIAgentTurn(config, generationInput);
const result = await runAgentLoop({ next, tools: coordinatorSession }, signal);
```

Both constructors require an explicit key and model. Missing configuration throws the fixed `adapter_unavailable` error. No environment variables or env files are read by the adapter itself. Keep keys server-side; do not put them in workflows, logs, GitHub test fixtures, or browser configuration. `fetch` is a trusted transport injection seam used by deterministic HTTP tests.

The endpoint is fixed to `https://api.openai.com/v1`; ambient `OPENAI_BASE_URL` cannot redirect credentials. HTTP redirects and SDK logs are disabled. SDK retries are disabled so one provider turn makes at most one HTTP attempt. `store: false` disables stored responses; no cross-run conversation IDs or hidden conversation state are retained.

## Validation and limits

Generation uses Responses structured outputs. Function decisions use `observe`, `execute` and an empty-argument `finish`, with parallel calls disabled. More than one returned function call is rejected. `finish` only stops the loop; it cannot supply a test outcome. The coordinator must not infer success from an empty step list or an absent assertion.

Schemas are derived from the shared Zod schemas using the SDK helpers. The API projection removes schema annotations/defaults and the unsupported URI format; the original runtime schemas still enforce URL policy, step IDs, workflow validity and exact arguments. No separate workflow language or core contract is introduced. The provider is not trusted to follow prompts: A1 and browser validation remain authoritative.

The request contains the validated project, objective, source documents, resolved templates and (for tools) the observed history. These are user-message data; fixed instructions identify documents and browser content as untrusted. A request above 200,000 serialized input characters fails explicitly instead of silently dropping context. Image context remains unsupported.

Provider request timeout defaults to 30 seconds and is configurable within 1..120,000 milliseconds. The whole A1 loop retains its independent total deadline and call bound. Output is capped at 4,096 tokens by default, configurable within 256..8,192. Returned draft text/function arguments are capped at 200,000 characters. Caller cancellation reaches the HTTP transport. A noncooperative transport cannot allow later tool dispatch after the A1 deadline.

HTTP/authentication/rate-limit/SDK failures expose only `provider_failed`; no raw error body, headers, stack from the SDK or cause is attached. Refused, incomplete, empty or malformed responses reject safely. Direct adapter calls may report `invalid_provider_output` or `invalid_tool_call`; A1's enclosing generator/loop maps thrown provider errors to the existing fixed `provider_failed` error. Missing prerequisites, PDF/DOCX/image handling and observed browser outcomes retain their existing ownership and behavior.

## Verification

Default CI stays credential-free. `agent-openai.test.ts` uses explicit HTTP fixtures and covers valid drafts, source provenance, strict schemas, malformed/refused/incomplete output, invalid tools, origin policy, parallel-call rejection, call limits, failed assertion authority, cancellation, timeout, context limits, missing configuration and safe non-retried HTTP failures.

An opt-in live test verifies a real draft and a schema-valid first model tool decision. It does not execute a browser. Run it only with an authorized local key:

```sh
VERIFLOW_VERIFY_OPENAI=1 node --env-file=/absolute/path/to/ignored.env --import tsx --test apps/web/tests/agent-openai-live.test.ts
```

This test uses `OPENAI_MODEL`, falling back to `gpt-4.1-mini` only within the opt-in test. Production has no model fallback. The full REVIEW.md gate is required before review. Live verification evidence and the actual PR head are recorded on the PR.

Live checks on 7 November 2026 also used a separate external session-owning harness and Dev 3's real Chromium adapter/independent coupon target. One real generated four-step draft was executed against both bug modes, changing only the navigation query. Two additional runs used real model function decisions through `runAgentLoop` and the injected browser session:

| Verification         | Buggy target                 | Fixed target                 | Evidence                       |
| -------------------- | ---------------------------- | ---------------------------- | ------------------------------ |
| Real generated draft | failed, actual `100000`      | passed, actual `90000`       | 4 valid run-owned PNGs per run |
| Real model tool loop | failed after 6 browser calls | passed after 5 browser calls | 4 valid run-owned PNGs per run |

The expected total remained `90000`; browser observations determined every result. The harness finalized and closed all sessions. It did not write to application storage or use the product UI. This is live adapter verification, not a claim that the HTTP/UI journey is integrated. Credentials and generated artifacts are not committed.

Sources: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [function calling](https://developers.openai.com/api/docs/guides/function-calling), [GPT-4.1 mini capabilities](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
