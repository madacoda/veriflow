# P1: durable project and run platform

Owner: Dev 1. Reviewers: Dev 3 for session lifecycle/evidence, Dev 4 for HTTP consumption. P1 was merged in [PR #2](https://github.com/madacoda/veriflow/pull/2) as `aec5515`; runtime browser wiring followed in [PR #10](https://github.com/madacoda/veriflow/pull/10). This document retains P1's original verification record. Use [project status](project-status.md) for the current implementation and release gates.

## Implemented

The P1 surface in contracts-v1.md is implemented, plus registered evidence retrieval. Projects are isolated by server-generated IDs. Workflow saves are atomic compare-and-save operations and retain every revision. Runs pin a saved revision and capture project/workflow metadata before execution. Run timelines use ordered persisted events; cancellation remains nonterminal until cleanup resolves, and cleanup failure remains an infrastructure error. Restart recovery marks unfinished runs interrupted. Terminal records cannot be rewritten by late cancellation or callbacks.

`PlatformStore` persists to `STORAGE_DIR/platform-v1.json` with serialized transactions, a synced temporary file and atomic rename. Instances in one Node process share a filename-keyed lock. Run jobs/controllers live in that same process. This implementation is for one long-running Next.js service and one writer process with persistent storage; it does not support multiple replicas, serverless invocation lifetimes, distributed queues or multi-user authorization. Project isolation is not authentication. A corrupted data file causes an error instead of an empty replacement.

The composition root is `apps/web/server/composition/platform.ts`. It creates one process-level platform instance and recovers interrupted runs before serving platform routes. It now supplies Dev 3's real Playwright SessionFactory by default. No AI credentials are required for startup or deterministic execution, but Chromium must be installed for browser runs. Invalid adapter settings reject explicitly, and there is no automatic fake fallback.

For explicit fixture development only:

```sh
VERIFLOW_RUN_ADAPTER=fake VERIFLOW_FAKE_OUTCOME=failed bun run dev
```

Every such run and report says `adapter: fake`. Fake assertions have explicit fixture messages; no screenshot/video/trace files are fabricated. `passed` config produces a labeled fixture success. Changing this environment setting requires restarting the service.

Report JSON and the integrated CSV renderer use the same immutable snapshot. The CSV-only runtime renderer rejects XLSX/PDF with 422; a custom instance with no renderer still returns 503. Attachments and deterministic project-template HTTP adapters are integrated. Generation HTTP is integrated; production provider configuration and bounded AI-loop composition remain pending; deterministic execution is not a model-driven browser journey.

## Evidence

Artifacts are registered only after checking unique IDs, run/step ownership, supported kind/media type, file existence and a storage-relative path under that run. Symlink aliases and traversal are rejected. Retrieval accepts an evidence ID registered in the selected project's run; it never accepts a filesystem path. Responses use the recorded media type and no-store caching.

The current session port does not declare the completeness of every requested capture format. P1 therefore conservatively marks nonempty evidence as partial and empty evidence as unavailable. The current product runner captures PNG only. WebM/trace recording remains pending despite supported transport types; Playwright test-runner recordings do not satisfy product capture. Browser adapters must flush media in evidence() and release resources idempotently in close(); terminal run persistence follows both operations. Cooperative aborts are required. An uncooperative adapter cannot be forcibly terminated by the coordinator; browser-process supervision remains part of B1 acceptance.

## Original P1 verification on 7 November 2026 (WIB)

Passed locally:

```sh
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test:unit
bun run build
bun run browsers:install
bun run test:smoke
```

35 unit tests pass: core 7, runner 6, web 22. The 17 added platform tests cover restart persistence and interrupted-run recovery, two-instance optimistic-write contention, project isolation, immutable report revisions, corrupt-file preservation, assertion failure versus infrastructure failure at open/execute/evidence/close, cooperative cancellation/cleanup, timeout, unavailable adapters, JSON error/size handling, HTTP envelopes, registered evidence ownership and traversal/symlink rejection. The 2 browser tests verify monolith UI/health/translation and Chromium/axe startup; they do not verify real B1 execution.

Production HTTP checks also ran against next start on port 3001 with an isolated temporary storage directory:

1. Default configuration: create project (201), save revision (201), retrieve the exact revision (200), start without an adapter (503), verify no run was created.
2. Restart with explicit failed fake adapter: the project/revision survive; a new run completes failed with adapter=fake, ordered events, unavailable media and a revision-1 report.
3. Restart with explicit passed fake adapter: the prior failed record survives, a fresh run ID completes passed with adapter=fake, and the earlier result stays failed.

The filesystem-tracing warning was resolved with the build's documented turbopackIgnore annotation on the runtime storage root. The resulting build has no broad filesystem-tracing warning, and production HTTP storage resolution was checked afterward. These checks preceded later adapter integration; their original default-503 behavior is not the current production default. Subsequent merge and CI records are in the [task board](task-board.md).

## Remaining integration actions

- A1/B1/U1 and deterministic browser composition have landed; do not reassign those completed foundation tasks.
- Dev 1 coordinates real AI generation/context/session integration with Dev 2 and Dev 3, and Dev 4 binds the UI to the agreed HTTP contract.
- The complete I1 journey still requires actual model generation, explicit review/save, real fail/evidence and target-only fix/rerun verification. See [current priorities](project-status.md).
