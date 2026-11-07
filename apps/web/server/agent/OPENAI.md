# A2: OpenAI provider for I1

Owner: Dev 2. Reviewer: Dev 3. Dev 1 owns runtime composition, revision/session ownership and serial merging.
Branch: `codex/a2-openai-provider`. Original stacked base: A1 `5728daddfb71c520790bb9c491c55881eb4b4394`. A1 merged as main `8d11c70786dd6b5c69f63a8618e918597a9464c2`; the final current-main base and head are recorded on PR #12.

Outcome: real model generation and reviewed-workflow decisions use the existing A1 injection seams and shared v1 validation. This follows the [lead's A2 assignment](https://github.com/madacoda/veriflow/pull/5#issuecomment-6702566990). Changes stay in agent-owned paths and tests. The installed OpenAI SDK is reused; no route, storage, browser, core, manifest or lockfile edits are included.

## Composition

The application runtime now wires draft generation to these settings through a trusted per-request resolver in `server/composition/platform.ts`. See [runtime configuration](../../../../docs/generation-http.md#runtime-configuration). The agent-loop and summary adapters still require their own composition.

`createOpenAISummaryProvider(config)` uses the same configuration/transport for optional failure interpretations. Inject it through `createFailureSummarizer` so report identity, output structure and reference validation remain enforced. It makes one request without tools; see [SUMMARIES.md](SUMMARIES.md) for the report projection and separately opt-in verification.

Dev 1 loads trusted server configuration and supplies the saved revision. Neither request bodies nor model/page text may configure the provider or replace the reviewed workflow:

```ts
const config = {
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
  model: process.env.OPENAI_MODEL,
};
const generator = createDraftGenerator({
  provider: createOpenAIDraftProvider(config),
});
// project and savedRevision are loaded and pinned by the coordinator.
// savedRevision uses the existing core StoredWorkflow shape.
const next = createOpenAIAgentTurn(config, {
  project,
  reviewedWorkflow: savedRevision,
});
const result = await runAgentLoop({ next, tools: coordinatorSession }, signal);
```

Key and model are required; missing configuration throws fixed `adapter_unavailable`. No environment variable or env file is read by the adapter. An absent `baseURL` uses `https://api.openai.com/v1`, not the SDK's ambient environment setting. Explicit endpoints support HTTPS and loopback HTTP; credentials in URLs, query strings, fragments and remote cleartext endpoints reject. The endpoint must implement Chat Completions JSON mode, function calling and the documented request fields; incompatible endpoints fail safely without automatic transport/model fallback. A trusted `fetch` injection seam supports transport fixtures and must preserve signal/redirect behavior.

The SDK has redirects, logging and retries disabled. Each turn makes at most one HTTP attempt; `store: false` is requested. No conversation IDs, hidden model state or browser sessions are retained. Keep credentials server-side, outside workflows, evidence and logs.

## Generation and reviewed execution

Draft generation uses Chat Completions JSON mode with a workflow schema derived from the shared Zod definition in the fixed system instructions. JSON mode does not guarantee schema adherence: A1 still validates the complete output with `workflowSchema`, checks allowed origins and assigns trusted model provenance/source IDs. Generation returns an editable draft and never saves it. Refused, incomplete, empty, multiple-choice or malformed output rejects.

The provider also applies the shared [catalog generation prerequisites](../templates/README.md) before HTTP dispatch. Selecting an unavailable category or requirement-based generation without text sources fails explicitly; caller-supplied template definitions cannot bypass this check. The enclosing generator enforces assertion presence and adds the coverage warning for requirement-based drafts.

`createOpenAIAgentTurn` accepts `{ project, reviewedWorkflow: StoredWorkflow }`. It validates project ownership, positive revision, the full workflow and every navigation origin, then copies the snapshot. It receives no new objective or attachment input that could redefine saved steps. The coordinator must independently load/pin the correct reviewed revision and enforce its session policy; this adapter does not establish that a user approved a revision.

Tool decisions use `observe`, `execute` and empty-argument `finish` through Chat Completions function calling, with parallel calls disabled. All unknown arguments pass the shared `browserToolCallSchema`. An execute call must equal the next saved step after schema normalization, including ID, action, target, value, timeout, URL and expectation. Changed, skipped, repeated or extra steps reject before dispatch. Prior executed history must be a matching prefix with validated observed results. Passed steps and failed assertion-classified `assertRequirement`/`assertLayout` checks permit the next saved step. Blocked, infrastructure, cancellation and dependent failures reject further provider dispatch. Finding/requirement metadata and evidence reference arrays are copied and validated with the same rules as the loop. Input and history snapshots prevent later caller mutations from changing a pending request. Untrusted page text cannot authorize altered actions or assertions.

`finish` is accepted only after all reviewed steps have observed results that permit continuation under this policy. Independent-check failures remain failed in history; the model cannot retry or revise them. Finish returns only a stop decision, never an outcome. A1 stops immediately on all other failed or blocked results. The coordinator remains responsible for assertion sufficiency, per-step events, final status, evidence, cancellation and cleanup. A model finish or empty result must never imply success.

Tool API schemas also derive from shared schemas. Unsupported URI-format/default annotations are removed only from API projections; strict local validation remains authoritative. Function strict mode is disabled for endpoint compatibility, so prompt/schema adherence is never assumed. All dispatch still goes through A1's shared translation path and injected AgentToolPort; this provider never imports Playwright.

## Bounds and safe failures

The serialized task plus copied history is limited to 200,000 characters; overflow fails rather than dropping context. History is additionally capped at A1's maximum of 100 calls. The fixed workflow schema/instructions are separate from this user-data limit. Image context, PDF and DOCX remain explicitly unsupported under A1.

Each provider request defaults to 30 seconds, configurable within 1..120,000 ms. Output uses `max_completion_tokens`, default 4,096 and configurable within 256..8,192. Returned text/function arguments are capped at 200,000 characters. The enclosing A1 loop independently bounds total time and tool calls. Caller cancellation reaches HTTP; a late or noncooperative transport cannot dispatch a subsequent tool after the deadline.

HTTP/authentication/rate-limit/SDK failures expose only fixed `provider_failed`; raw bodies, headers, SDK stacks and causes do not cross the adapter boundary. Invalid direct adapter output may use `invalid_provider_output` or `invalid_tool_call`; the enclosing A1 generator/loop maps thrown provider errors to fixed `provider_failed`. Browser observations retain outcome authority.

## Verification

Default CI is credential-free. `agent-openai.test.ts` uses injected HTTP fixtures for JSON generation/provenance, safe configuration and HTTP failures, malformed/refused/truncated output, unsupported inputs, cancellation/deadlines, tool validation, exact ordered saved-step enforcement, hostile observation text, call/input bounds and observed assertion authority.

The separately opt-in live tests verify real generation and a first valid decision against a reviewed workflow fixture, plus independent-failure continuation through a labeled fake tool session. They do not save a revision or execute a browser:

```sh
VERIFLOW_VERIFY_OPENAI=1 node --env-file=/absolute/path/to/ignored.env --import tsx --test apps/web/tests/agent-openai-live.test.ts
```

It uses the official endpoint and `OPENAI_MODEL`, with `gpt-4.1-mini` only as the test's fallback. Production has no default model. The full REVIEW.md gate is required on the updated branch. Current commit, CI and separately labeled real-provider/browser evidence are recorded on [PR #12](https://github.com/madacoda/veriflow/pull/12). Prior Responses-based evidence is historical and does not verify this revised transport.

Sources: [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [JSON mode and Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).
