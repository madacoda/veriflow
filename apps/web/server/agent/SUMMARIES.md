# Failure summaries

Owner: Dev 2. Review: Dev 3 for observed results and evidence semantics; Dev 1 for composition and merging. Starting base: `1266309c112d492b43a5003818211806571e575c`.

`createFailureSummarizer({ provider, timeoutMs? }).summarize(snapshot, signal)` returns only the existing `ReportSnapshot.aiSummary` value, `{ text, provider }`. It never mutates the snapshot, persists a report, runs a browser or decides an outcome. Dev 1 loads the project-scoped immutable snapshot and decides whether/how to attach the optional result; summary failure must not change run status or prevent access to the original report.

```ts
const summarizer = createFailureSummarizer({
  provider: createOpenAISummaryProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    baseURL: process.env.OPENAI_BASE_URL,
  }),
});
const aiSummary = await summarizer.summarize(snapshot, signal);
// Dev 1 owns attaching aiSummary to a report; no adapter writes occur here.
```

The provider factory is a low-level injection seam. Use it through `createFailureSummarizer`; raw model output is never a validated report summary. The wrapper validates project/workflow/revision identity, terminal lifecycle and outcome shape, unique known step IDs, evidence ownership and references, then copies a minimal projection. Queued/running/passed runs return `summary_unavailable` before provider dispatch. Finalized failed, blocked, errored and cancelled runs are supported, including allocation failures with no executed steps.

## Observations and interpretation

The wrapper renders lifecycle, the coordinator's recorded outcome, adapter, step counts, failed/blocked expected/actual/reason, failure kind, capture status/warnings and relevant registered evidence IDs directly from the validated snapshot. Infrastructure error codes and absent outcomes remain explicit. Fake runs stay labeled even when a real model summarizes them. Evidence contents are never loaded or claimed to have been inspected. The projection excludes workflow fill values and URLs, project descriptions/goals, artifact paths, raw infrastructure error messages, events, findings and prior AI summaries. This slice explains run/step failures, not independent evaluator findings. The supplying browser/coordinator must scrub observation text and capture warnings of credentials, as required by the existing v1 contract.

Providers return an unknown object or JSON string with exactly this shape:

```json
{
  "analyses": [
    {
      "stepIds": ["total"],
      "evidenceIds": [],
      "hypothesis": "The coupon discount may not have been applied.",
      "nextCheck": "Inspect the calculation triggered by the coupon action."
    }
  ]
}
```

Every analysis must reference a supplied failed/blocked step when such steps exist. Run-level explanations with empty step IDs are allowed when no failed/blocked steps were recorded. Evidence IDs must be registered for a cited step or for the run. Passed-step references, duplicate/unknown IDs, cross-step references, extra fields (including model outcomes/provenance), malformed output and over-limit responses reject. An empty analyses array is valid when the provider has no interpretation to offer.

Hypotheses and suggested checks are separately labeled **unverified** and **not executed**. Structured references are validated; free-form prose is not proof of causation, complete coverage, or correct interpretation and may still be inaccurate. It must never replace observed results. Values are quoted to keep embedded line breaks from posing as new observation sections. Consumers must render the result as plain text, never trusted HTML or instructions. Fixtures use `provider: fixture` and an explicit no-model warning; a real configured provider uses `provider: model`. Missing configuration never selects a fixture automatically.

## Bounds and errors

| Limit                                                    | Value                                                 |
| -------------------------------------------------------- | ----------------------------------------------------- |
| Whole summary deadline                                   | Default 30 seconds; configurable integer 1–120,000 ms |
| Provider attempts                                        | One; no tools, retries or repair calls                |
| Serialized projected input                               | 100,000 characters                                    |
| Recorded steps / registered artifacts / capture warnings | At most 1,000 / 1,000 / 50                            |
| Individual observed text / capture warning               | At most 20,000 / 2,000 characters                     |
| Provider output                                          | 16,000 serialized characters                          |
| Analyses / references per array / prose field            | At most 5 / 5 / 800 characters                        |
| Final rendered summary                                   | 30,000 characters                                     |

Oversized observations are rejected, not silently truncated or omitted. Input projection and fixed observation rendering are checked before dispatch. Cancellation/deadlines include provider waits and settle even if a custom provider ignores abort. The OpenAI transport shares the existing explicit configuration, output-token bounds, redirect policy, disabled logging/retries and `store: false` behavior described in [OPENAI.md](OPENAI.md). No credentials are read by the adapter. Transport implementations must honor abort to release their own resources.

New local safe codes are `invalid_summary_input`, `summary_unavailable` and `invalid_summary_output`. Existing `adapter_unavailable`, `provider_failed`, `validation_error`, `cancelled` and `timeout` still apply. Thrown provider/SDK failures are mapped to fixed `provider_failed` without exposing raw bodies, errors or causes. Dev 1 maps these local codes at composition/HTTP boundaries; the core API error union is unchanged.

## Verification

Default tests use explicit provider and HTTP fixtures, including source immutability, excluded input fields, reference ownership, lifecycle preservation, malformed/oversized responses, cancellation and safe configuration/HTTP failures:

```sh
node --import tsx --test apps/web/tests/agent-summary*.test.ts
```

The live test is separate and skipped in CI. It requires an explicit configured model and summarizes a labeled report fixture, not real browser evidence:

```sh
VERIFLOW_VERIFY_OPENAI_SUMMARY=1 node --env-file=/absolute/path/to/ignored.env --import tsx --test apps/web/tests/agent-summary-live.test.ts
```

The existing full `REVIEW.md` gate is required before review. UI display, HTTP/storage wiring, live browser report integration and report-renderer changes remain with their owners.

JSON mode supplies syntax rather than application-level guarantees; this adapter validates structure and references locally. See the [official OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).
