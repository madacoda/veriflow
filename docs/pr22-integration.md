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
