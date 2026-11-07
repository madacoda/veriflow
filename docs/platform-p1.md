# P1: durable project and run platform

Owner: Dev 1. Reviewers: Dev 3 for session lifecycle/evidence, Dev 4 for HTTP consumption. Branch: `codex/p1-platform`, updated against merged L0 main `3c432f1` in `0dd05f2`. L0's merge has no contract changes from `36feb2d`, and main CI passed. P1 still needs its own consumer review and current GitHub checks before merging. The user created and merged L0 PR #1; the connector returned 403 for issue/PR creation, and browser access timed out.

## Implemented

The P1 surface in contracts-v1.md is implemented, plus registered evidence retrieval. Projects are isolated by server-generated IDs. Workflow saves are atomic compare-and-save operations and retain every revision. Runs pin a saved revision and capture project/workflow metadata before execution. Run timelines use ordered persisted events; cancellation remains nonterminal until cleanup resolves, and cleanup failure remains an infrastructure error. Restart recovery marks unfinished runs interrupted. Terminal records cannot be rewritten by late cancellation or callbacks.

`PlatformStore` persists to `STORAGE_DIR/platform-v1.json` with serialized transactions, a synced temporary file and atomic rename. Instances in one Node process share a filename-keyed lock. Run jobs/controllers live in that same process. This implementation is for one long-running Next.js service and one writer process with persistent storage; it does not support multiple replicas, serverless invocation lifetimes, distributed queues or multi-user authorization. Project isolation is not authentication. A corrupted data file causes an error instead of an empty replacement.

The composition root is `apps/web/server/composition/platform.ts`. It creates one process-level platform instance and recovers interrupted runs before serving platform routes. Dev 1 must supply Dev 3's reviewed SessionFactory at this point for real browser execution. No credentials are required for platform startup. The default configuration returns JSON 503 `adapter_unavailable` when starting a run, and creates no fake run as a fallback.

For explicit fixture development only:

```sh
VERIFLOW_RUN_ADAPTER=fake VERIFLOW_FAKE_OUTCOME=failed bun run dev
```

Every such run and report says `adapter: fake`. Fake assertions have explicit fixture messages; no screenshot/video/trace files are fabricated. `passed` config produces a labeled fixture success. Changing this environment setting requires restarting the service.

Report JSON uses the same immutable snapshot for future renderers. CSV/XLSX/PDF export currently returns 503 until Dev 4's renderer is integrated. Attachments, generation/catalog HTTP adapters and bounded AI-loop composition are subsequent tasks. Current composition supports deterministic workflow execution only; it does not claim a model-driven browser journey.

## Evidence

Artifacts are registered only after checking unique IDs, run/step ownership, supported kind/media type, file existence and a storage-relative path under that run. Symlink aliases and traversal are rejected. Retrieval accepts an evidence ID registered in the selected project's run; it never accepts a filesystem path. Responses use the recorded media type and no-store caching.

The current session port does not declare the completeness of every requested capture format. P1 therefore conservatively marks nonempty evidence as partial and empty evidence as unavailable. Dev 3 must confirm capture completeness semantics with Dev 1 before claiming complete PNG/WebM/trace evidence. Browser adapters must flush media in evidence() and release resources idempotently in close(); terminal run persistence follows both operations. Cooperative aborts are required. An uncooperative adapter cannot be forcibly terminated by the coordinator; browser-process supervision remains part of B1 acceptance.

## Verification on 7 November 2026 (WIB)

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

The filesystem-tracing warning was resolved with the build's documented turbopackIgnore annotation on the runtime storage root. The resulting build has no broad filesystem-tracing warning, and production HTTP storage resolution was checked afterward. GitHub CI status and affected-consumer approval are separate, still-required merge evidence.

## Next integration actions

- Dev 2 reviews L0 generation/context/tool interfaces, then delivers A1 without persistence writes or direct Playwright access.
- Dev 3 reviews L0 and P1 session/error/evidence semantics, then supplies B1 with a real session factory and a deterministic target test.
- Dev 4 reviews API/report envelopes and confirms the proposed coupon target IDs, then binds U1 to P1 after L0 review.
- Dev 1 merges serially after review and current CI, wires real adapters, then verifies the generated/edit/save/real-fail/screenshot/fix/real-pass journey. That I1 milestone is not complete yet.
