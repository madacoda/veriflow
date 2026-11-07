# A3 — workflow and result contract parity

- Task/owner: A3, Dev 2 (`monsieurafa`); reviewer Dev 3. Dev 1 retains merge/composition ownership.
- Branch/base: `codex/dev2-contract-parity`, main `0e79d3a377c8bf3283b4dbbe726033a5cd4ef396`.
- Outcome: resolve audited D2/D3/D4 using the existing workflow v1 and StepResult contracts.
- Allowed paths: `apps/web/server/agent/**`, `apps/web/tests/agent-*.test.ts`.
- Dependencies: merged six-category workflow/executor contracts and summary provider. No schema or dependency changes.
- Acceptance: requirement-only drafts retain trusted source references and coverage warnings; validated findings, evidence IDs and requirement metadata survive the loop as defensive copies; independent requirement/layout assertion failures allow later checks without losing the recorded failure; dependent failures, blocked results, cancellation and infrastructure errors stop; provider history uses the same rule and preserves exact saved step order/fields.
- Verification: `agent-contract-parity.test.ts` compares the deterministic executor and loop with labeled fake sessions, tests malformed/bounded metadata and mutation isolation, and exercises the provider via fake HTTP. Existing draft/tool/provider suites remain required. Run the complete REVIEW.md gate on the final commit; opt-in real-provider tests are separate from browser execution evidence.
- Budget/checkpoint: one reviewable correctness slice; policy/metadata review before final diff review, then exact-commit full gate.
- Out of scope: HTTP/storage/UI integration, extraction formats, target suggestions, browser implementation, shared core changes, and excluded PR #20.
- PR/current commit: recorded on the PR when published.
- Status: review; Dev 3 independently approved the implementation with 113 deterministic tests passing.

## Verification evidence

On 7 November 2026, the complete REVIEW.md gate passed locally: frozen install, lint, formatting, typecheck, 265 unit tests (three opt-in live tests skipped), production build, browser installation and 52 Chromium tests. Separately, all three opt-in real-provider tests passed using `gpt-4.1-mini`: draft generation/first decision, independent-failure continuation with a labeled fake session, and report-fixture failure summarization. Those live checks do not establish real model-to-browser application integration. Exact published head and CI are recorded on the PR.

The continuation rule matches actual runner output: continue `passed`, or `failed` with `failureKind: assertion` for `assertRequirement`/`assertLayout`. A malformed `blocked` plus `assertion` stops conservatively even though the current core predicate is broader. No model can change the outcome, retry the same reviewed step, or claim pass by finishing. Findings validate step identity and evidence-reference shape; only the coordinator can verify registration against its evidence manifest.
