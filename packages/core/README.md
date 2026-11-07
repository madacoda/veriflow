# Workflow core

`@veriflow/core` owns the workflow language and deterministic translation into execution commands. All QA modules consume this contract. The platform storage adapter persists immutable workflow revisions; their format and semantics belong here. See [HTTP contracts](../../docs/contracts-v1.md) for integration and [current status](../../docs/project-status.md) for implementation limits.

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
    },
    {
      "id": "verify-terms",
      "code": "assert",
      "target": { "by": "testId", "value": "terms" },
      "expectation": { "kind": "checked", "value": true }
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

The real runner implements the session/executor ports, receiving one command and an abort signal. It enforces timeout and cancellation, resolves a single target, and returns a result with the same step ID. `runWorkflow` executes commands in order and closes the session. Ordinary failure blocks later dependent steps; assertion failures from `assertLayout` and `assertRequirement` permit later independent checks. Infrastructure failures stop execution. Automatic retries of workflows that mutate a target application require explicit policy.

The browser adapter enforces the configured project origin policy, including redirect destinations. HTTP URL syntax validation in the core is not a network access policy. Keep credentials out of persisted `fill` values and evidence. `fillSecret` stores only an uppercase reference; runtime composition resolves `VERIFLOW_SECRET_<REFERENCE>` on the server. Missing values block the step. After secret use, the runner suppresses screenshots and redacts known values from observations/results. Product video/trace capture is not implemented.

## Supported steps

| Code                | Meaning                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `redirect`          | Navigate to a permitted HTTP(S) URL                                            |
| `fill`              | Fill or clear one exact target                                                 |
| `check`, `uncheck`  | Set checkbox state explicitly                                                  |
| `click`             | Click one exact target                                                         |
| `assert`            | Exact text, visibility or checked-state expectation                            |
| `viewport`          | Set width 320–3840 and height 320–2160                                         |
| `assertLayout`      | Check horizontal overflow and optional exact-target containment                |
| `assertHttp`        | Navigate and compare the response to explicit acceptable status codes          |
| `accessibility`     | Run axe with configured WCAG tags; incomplete checks block for manual review   |
| `assertRequirement` | Check a supplied requirement ID/text/source against a typed target expectation |
| `fillSecret`        | Fill a target using a server-resolved secret reference                         |

These are additive schema-version-1 steps. Optional `category` identifies one of the six testing categories. A workflow has 1–1000 steps with unique IDs. See [testing coverage](../../docs/testing-coverage.md) for template parameters, evidence and manual-review limits.

## Extension workflow

Add a discriminated step schema, exhaustive translation case, representative example and contract tests together. Add the matching runner implementation in a separate adapter change. Modules add QA-specific policies through application ports instead of copying the workflow language. Core changes require review from affected module owners.

Assertions use code assert, a target, and expectation with kind visible, checked or text and its typed value. Text matching is exact. Session lifecycle, evaluator, finding and evidence contracts are exported from the public package entry.
