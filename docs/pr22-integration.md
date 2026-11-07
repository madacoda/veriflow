# PR 22 local integration

## Task and scope

- Owner: Dev 1, local integration; source task A3 is authored by Dev 2, with Dev 3 review reported on [PR #22](https://github.com/madacoda/veriflow/pull/22).
- Branch/base: `codex/pr20-alignment`, `e98f338d9131a4cc18f030077b3d81842a4df23a`.
- Source: PR head `3bb0282fb5996b59e638259e7ab587042f831875`.
- Outcome: integrate agent result validation and independent-check continuation while preserving the current branch's generation, authentication, workbench and demo-recovery changes.
- Allowed paths: the PR's `apps/web/server/agent/**` and `apps/web/tests/agent-*.test.ts` changes, this integration record, and a verification-only synchronization fix in `packages/runner/tests/dashboard-coverage.spec.ts`.
- Dependencies: existing workflow v1 and StepResult contracts; no shared schema, manifest or dependency changes.
- Review/checkpoint: inspect the combined diff, run the repository verification gate, then commit locally. Do not merge to main, push, deploy or enable the agent loop in production.

## Acceptance criteria

1. Requirement-only generation remains accepted with source references and trusted coverage warnings; action-only requirement drafts reject.
2. Findings, evidence-reference arrays and requirement metadata survive agent execution as validated defensive copies; malformed metadata rejects.
3. Failed assertion-classified requirement/layout checks permit later saved checks without erasing failures. Dependent, blocked, infrastructure and cancellation failures stop; exact saved-step order and no-retry rules remain enforced.
4. Existing branch behavior remains covered by unit and browser checks, including authentication, generation configuration, workflow editing and known-fail/known-pass demo recovery.
5. The integration stays on the current branch. The local main ref and remote branches remain unchanged.

## Reconciliation

The source merged without conflicts. The requirement-only generation change was already present: `generate.ts` remains identical to the branch baseline and PR head. The automatic documentation merge preserves the branch's runtime-provider composition note. No existing product, authentication, HTTP, browser-runner or core files are replaced by this integration.

The coordinator still uses deterministic `runWorkflow`; this PR does not wire the AI loop into application runs. Agent evidence references are structurally validated, while registration and ownership remain coordinator responsibilities. The agent's explicit failed/assertion continuation rule conservatively stops malformed blocked/assertion combinations; core's broader existing predicate is unchanged.

The first browser gate exposed an existing coverage-test race: matching `passed` also matched the running timeline's `0 steps passed`, so the test requested a requirement heading before execution completed. The test now waits for each selected run's persisted completed/passed result and completed UI state, including the rerun, before reading findings or reports. Its overall timeout now matches the existing demo-recovery test. Product behavior is unchanged.

## Verification evidence

Verified locally on 7 November 2026 with Node `v24.11.1` and Bun `1.4.4`:

- `bun install --frozen-lockfile`: passed; no dependency changes.
- `bun run lint`, `bun run format:check`, `bun run typecheck`: passed, including the dashboard-test synchronization fix.
- `bun run test:unit`: 284 passed (9 core, 9 runner, 266 web); three opt-in live-provider tests skipped. The new parity, metadata bounds/copying and provider continuation tests all passed with explicitly labeled fake adapters.
- `bun run build`: passed. Subsequent changes affect only browser-test synchronization and this record.
- `bun run browsers:install`: passed.
- `PORT=1133 STORAGE_DIR=/tmp/veriflow-pr22.1JSWid/storage-serial VERIFLOW_U1_TEST_HTTP=1 VERIFLOW_RUN_ADAPTER=browser bun run test:smoke --workers=1`: all 58 Chromium tests passed in 1.7 minutes with isolated storage. This covers six-category execution, authentication, generation with a labeled HTTP provider fixture, editing, reports, owned PNGs and real known-fail/known-pass browser journeys.
- `bash scripts/tests/deploy.test.sh` and `bash scripts/tests/transport.test.sh`: passed with their test fixtures; no deployment occurred.
- Scope comparison: the PR's changed TypeScript sources/tests match its head exactly. The baseline's `generate.ts`, product UI, auth, runtime composition, workflow HTTP adapters and core source are unchanged. The documentation merge retains the runtime-provider note.

The initial four-worker browser run had 55 passes and three failures: the dashboard completion race fixed above, a CRUD result expectation and an isolated platform health-poll timeout. The two-worker recheck passed the corrected dashboard test but had two different failures (functional CRUD and a known-fail assertion becoming an infrastructure timeout); 56 tests passed. The complete one-worker run passed all 58 without further changes. Parallel browser timing remains sensitive on this machine; the serial result does not establish parallel CI reliability.

Logs and the first two runs' failure artifacts are retained locally under `/tmp/veriflow-pr22.1JSWid`. Playwright's final HTML report and test artifacts remain under the runner's ignored output directories. Live-provider checks, Windows/container CI and deployment were not run. The AI loop remains uncomposed, so these results do not claim real model-to-browser application execution.

Status: verified for local branch integration. The pre-existing branch head remains an ancestor, and the local main ref remains `e476a5163d523859271d183d183ad12fd7756f56`. Nothing is pushed or merged to main; the integration commit is recorded in this branch's Git history.

## PBR-1 — parallel verification follow-up

The user subsequently authorized fixing parallel browser failures, rerunning checks and merging to main. This supersedes the original local-only boundary above.

- Owner: Dev 1; independent execution-layer agent review under REVIEW.md. Source A3 review remains recorded on PR #22.
- Branch/base: `codex/pr20-alignment` at `52b5e13`, synchronized with main `f941bec` in `b3f3735`. Main already contains the earlier auth/workbench integration; synchronization preserves the completed-run dashboard test fix.
- Allowed paths: browser coverage/session tests, platform integration and dashboard workbench tests, and this verification record. Production runner/core/agent behavior is outside the timing fix.
- Acceptance: keep observed failure classifications, exact expected/actual values, registered PNG ownership and deliberate short timeout/cancellation tests; pass the complete browser suite with four workers and repeated coverage without retries; pass the full repository gate on the updated branch before a reviewed PR merge to main.
- Evidence: the retained known-fail trace spent 2,234 ms polling then 1,376 ms capturing a PNG against a 3,000 ms step deadline. Coverage tests forced all non-axe steps to 1,500 ms, reserving just 375 ms for capture. These test-only budgets are below the product's 30,000 ms default and do not represent the intended timeout tests. They now allow 10,000 ms per ordinary test step, retaining the 15,000 ms axe budget and explicit short deadline cases. Multi-run waits remain bounded and accommodate the larger test step budget.
- Readiness: the isolated platform integration helper now matches the existing built-platform helper's 10,000 ms readiness poll and 1,000 ms per-request abort, instead of an implicit 5,000 ms poll with an unbounded fetch.
- Independent review: the execution-layer reviewer approved the timing diff against `b3f3735` with no blocking findings. The review verified unchanged observed assertions, evidence ownership and deliberate 150 ms timeout/cancellation cases. This is an agent code review, not a GitHub user approval.
- Verification: frozen install, lint, formatting, type checks, all 284 unit tests (three optional live-provider checks skipped), production build, Chromium installation and fixture deployment/transport shell suites passed. `PORT=1133 STORAGE_DIR=/tmp/veriflow-parallel.oV59VY/storage VERIFLOW_U1_TEST_HTTP=1 VERIFLOW_RUN_ADAPTER=browser bun run test:smoke --workers=4 --retries=0 --repeat-each=2` passed all 116 cases in 1.5 minutes: two complete parallel suite passes, no retries and no serial fallback. Logs are retained under `/tmp/veriflow-parallel.oV59VY`.
- Checkpoint/status: locally verified; complete candidate review and exact-head remote CI precede the authorized merge. Live-model calls and production runner changes are out of scope. The local Docker daemon is unavailable; container verification must run in GitHub Actions.
