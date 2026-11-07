# Workflow core

`@veriflow/core` owns the workflow language and deterministic translation into execution commands. All QA modules consume this contract. Persisted workflow instances will belong to the project storage adapter, while their format and semantics belong here.

```json
{
  "schemaVersion": "1",
  "id": "signup",
  "name": "Signup form",
  "steps": [
    { "id": "open", "code": "redirect", "url": "https://example.com/signup" },
    {
      "id": "email",
      "code": "fill",
      "target": { "by": "label", "value": "Email" },
      "value": "qa@example.com"
    },
    {
      "id": "terms",
      "code": "check",
      "target": { "by": "testId", "value": "terms" }
    },
    {
      "id": "marketing",
      "code": "uncheck",
      "target": { "by": "testId", "value": "marketing" }
    }
  ]
}
```

Import `translateWorkflow` from the package public entry point. It accepts unknown input and validates the complete document before returning an execution plan. Validation errors are Zod errors with field paths. HTTP adapters should map them to client validation responses. AI output follows the same validation path as user-authored input.

## Contract

- Schema version `1` is explicit. Future incompatible changes need a version and migration policy.
- IDs are stable and unique within a workflow. Commands retain step IDs for evidence correlation.
- Steps execute sequentially. `redirect` means browser navigation, not an HTTP redirect response.
- `fill` accepts an empty string to clear a field. Targets use exact label or test-ID matching.
- `check` and `uncheck` map to `setChecked(true)` and `setChecked(false)`, making repeated checkbox commands state-based.
- Step timeout defaults to 30 seconds, with a maximum of 120 seconds.
- Translation performs no I/O and does not mutate input. Unknown fields and action codes are rejected.

## Execution adapter contract

The runner will implement `StepExecutor`, receiving one command and an abort signal. It must enforce timeout and cancellation, resolve a single target, and return a result with the same step ID. runWorkflow executes commands in order, stops on failure, marks remaining steps blocked and closes its session. Automatic retries of workflows that mutate a target application require explicit policy.

The browser adapter must enforce the configured project origin policy, including redirect destinations, before navigation. HTTP URL syntax validation in the core is not a network access policy. Keep credentials out of persisted fill values and evidence. Runtime secret references, persistence, and browser adapters are future capabilities that require their own reviewed contracts.

## Extension workflow

Add a discriminated step schema, exhaustive translation case, representative example and contract tests together. Add the matching runner implementation in a separate adapter change. Modules add QA-specific policies through application ports instead of copying the workflow language. Core changes require review from affected module owners.

Assertions use code assert, a target, and expectation with kind visible, checked or text and its typed value. Text matching is exact. Session lifecycle, evaluator, finding and evidence contracts are exported from the public package entry.
