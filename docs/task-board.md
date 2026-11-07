# First journey: lead task board

Dev 1 owns this board and the serial merge queue. The connected GitHub integration returned 403 for both issue and PR creation; browser access was also unavailable. The pushed branches and this board are the review handoff until a teammate creates the PRs. No GitHub handles or GitHub reviewer assignments have been invented; role owners must confirm their own handles. Devs 2–4 are working separately, not as subagents in this checkout.

The 10:00 WIB gate has already elapsed. Do not report it as achieved. Prioritize L0 review now, then independent fixtures; keep the 14:00 known-fail/known-pass cutoff. The full MVP remains the scope in developer-handoff.md. These tasks cover the first journey only.

## L0 — Dev 1; reviewer Dev 4, affected reviews Dev 2/3

- Branch/base: `codex/l0-platform-contracts`, base `6a6d55a3bdf60db4baca8d234be32e704974b281`.
- Outcome: one shared v1 contract and frozen fixture set for every consumer.
- Allowed paths: `packages/core/**`, `docs/contracts-v1.md`, this board, required manifests and lockfile.
- Dependencies/version: existing workflow v1; additive `CONTRACT_VERSION = 1`.
- Acceptance: legacy fixtures remain valid; click translates; project/context/template/tool/run/evidence/report DTOs are exported; untrusted boundary failures are tested; infrastructure failure is distinguishable from observed assertions; consumers review names and lifecycle semantics.
- Verification: frozen install, lint, formatting, type checks, unit tests, build, browser installation and smoke tests. Record exact results on the PR.
- Budget/checkpoint: immediate first review; consumers review in parallel with fixture/layout work. Review/integration retains 40% of Dev 1 capacity.
- Out of scope: real AI/browser/UI implementation, storage adapters, complete MVP claims.
- PR/current commit: `codex/l0-platform-contracts` at `36feb2d`; [open the L0 comparison](https://github.com/madacoda/veriflow/compare/main...codex/l0-platform-contracts?expand=1). PR creation is blocked by connector permissions.
- Status: review; local verification passed (18 unit tests, 2 browser tests). Merge only after affected-consumer approval and latest GitHub checks.

## P1 — Dev 1; reviewer Dev 3 for lifecycle, Dev 4 for HTTP shape

- Branch/base: `codex/p1-platform`, stacked draft based on L0 commit `36feb2d` until L0 is reviewed and merged.
- Outcome: persistent projects/revisions and run create/status/cancel APIs; real adapter injected at composition.
- Allowed paths: `apps/web/app/api/**`, `apps/web/server/projects/**`, `apps/web/server/workflows/**`, `apps/web/server/runs/**`, `apps/web/server/composition/**`, `apps/web/tests/platform-*.test.ts`, server environment example, lead coordination/verification documents. Evidence retrieval is included; attachment storage follows after this foundation.
- Dependencies/version: L0 v1 schemas, fixtures and HTTP contract in contracts-v1.md. Dev 3 supplies SessionFactory; missing real adapter returns 503. Fake execution is explicitly configured and labeled.
- Acceptance: create/list/read projects; atomic create-only and compare-and-save revisions; run a pinned saved revision; ordered timeline; cancellation finalizes after cleanup; cross-project access rejects; restart recovers interrupted runs as errors; report snapshot cannot drift after edits.
- Verification: unit tests with temporary persistent directories and controlled sessions covering isolation, concurrent writes, restart, assertion fail versus infrastructure error, cancellation and immutable snapshots; complete merge gate before integration.
- Budget/checkpoint: first reviewable platform slice within 60 minutes after contracts; send an exact blocker if real adapter composition cannot begin. Reserve 40% for integration/review.
- Out of scope: AI loop, Playwright implementation, UI/report rendering, authentication or distributed workers.
- PR/current commit: [open the P1-only comparison against L0](https://github.com/madacoda/veriflow/compare/codex/l0-platform-contracts...codex/p1-platform?expand=1); branch HEAD is authoritative. See platform-p1.md for evidence and limitations.
- Status: review; 35 unit tests, production build, browser checks and production HTTP/restart checks passed. L0 must land before consumer merge. No real adapter is integrated yet.

## A1 — Dev 2; reviewer Dev 3

- Branch/base: `codex/a1-agent-tools`; use the L0 merge SHA recorded by Dev 1, separate checkout.
- Outcome: objective becomes an editable, schema-valid draft; bounded model/tool loop can be tested independently.
- Allowed paths: `apps/web/server/agent/**`, `apps/web/server/context/**`, `apps/web/server/templates/**`, `apps/web/tests/agent-*.test.ts`, `apps/web/tests/context-*.test.ts`, `apps/web/tests/templates-*.test.ts`.
- Dependencies/version: L0 `DraftGenerator`, `ContextExtractor`, `AttachmentReader`, `AgentToolPort`, tool schemas and versioned template DTO. Request dependency changes through Dev 1.
- Acceptance: validate provider output; return draft without persisting; reject unknown tools/arguments before execution; enforce max calls/time/cancel; errors are safe and mapped; no fake fallback disguised as a model. Catalog starts with the shared functional fixture and explicit capability requirements. No unsupported image extraction is silently accepted.
- Verification: deterministic provider/session fixtures for good draft, malformed output, invalid tool, max calls, cancellation and missing model configuration; include a separately labeled real-provider check when configured.
- Budget/checkpoint: independent fake generation/tool test by the next checkpoint; target 45 minutes after L0. Real validated tool integration is the 12:30 WIB gate.
- Out of scope: storage writes, Playwright imports, HTTP endpoints, observed pass/fail decisions, editing saved workflows.
- PR/current commit: Dev 2 supplies on review.
- Status: planned; fixtures can begin immediately; bindings wait for L0 review.

## B1 — Dev 3; reviewer Dev 2; Dev 1 reviews cleanup/evidence

- Branch/base: `codex/b1-browser-session`; use L0 merge SHA, separate checkout and unused local test port.
- Outcome: real deterministic browser adapter executes workflow commands and captures screenshot evidence on pass/fail.
- Allowed paths: `packages/runner/src/**`, `packages/runner/unit/**`, `packages/runner/playwright.config.ts`, `packages/runner/tests/browser-*.spec.ts`.
- Dependencies/version: L0 `Command`, `SessionFactory`, `BrowserSession`, `Evidence` and capture finalization semantics. Dev 4 confirms the demo contract; use an independent local target fixture until then. Manifest changes go through Dev 1.
- Acceptance: navigate/fill/click/setChecked/assert with exact targets; enforce allowed origins including redirects; bounded observe; timeout/cancellation; known fail has expected/actual and real PNG; partial opens and pass/fail/cancel clean up; finalized evidence is available before the coordinator terminates the run. Infrastructure errors cannot masquerade as assertion failures.
- Verification: own browser fixture for pass/fail/blocked, disallowed initial/redirect origin, cancellation, timeout, media ownership and no leaked browser/session resources; full gate before merge.
- Budget/checkpoint: independent browser fixture within 45 minutes of L0; report precise unsupported capabilities rather than claim full template execution.
- Out of scope: HTTP routes, AI generation, template definition ownership, report rendering, shared contract edits without agreement.
- PR/current commit: Dev 3 supplies on review.
- Status: planned; independent fixture can begin immediately.

## U1 — Dev 4; reviewer Dev 1

- Branch/base: `codex/u1-project-workbench`; use L0 merge SHA; pure layout/demo can start from the current base in a separate checkout.
- Outcome: project/workflow editor, timeline and a switchable buggy target that tells one complete story.
- Allowed paths: `apps/web/app/page.tsx`, `apps/web/app/layout.tsx`, `apps/web/app/demo/**`, `apps/web/app/projects/**`, `apps/web/features/**`, `apps/web/server/reports/**`, `apps/web/tests/reports-*.test.ts`, `packages/runner/tests/dashboard-*.spec.ts`.
- Dependencies/version: L0 API envelopes and `RunRecord`/`ReportSnapshot`; consume labeled fixtures until P1. Confirm `/demo?bug=1|0`, SAVE10 discount and test IDs in contracts-v1.md early. Runner configuration belongs to Dev 3; dependency changes go through Dev 1.
- Acceptance: create/select project; edit draft before explicit save; run the selected saved revision; render queued/running/pass/fail/blocked/error/cancelled; expected versus actual and screenshot evidence visible; fake fixtures clearly labeled. Buggy target shows 100000 and fixed target 90000 after coupon application. Preserve inputs on server errors/conflicts.
- Verification: screenshots of fixture states and target pass/fail; own dashboard browser tests; no broken controls. Later exports must use the same immutable snapshot.
- Budget/checkpoint: confirm target IDs immediately; independent UI fixture by next checkpoint; target 45 minutes after L0.
- Out of scope: platform persistence, HTTP/storage report adapters, AI prompts, browser execution, contract/manifests changes without Dev 1.
- PR/current commit: Dev 4 supplies on review.
- Status: planned; pure UI/demo work can begin immediately.

## Merge queue and I1 release evidence

Order: L0 → P1 → ready reviewed A1/B1/U1 serially → I1 composition. Independent demo/layout may merge earlier when it does not bind unreviewed contracts. Each owner fixes their own errors; shared-contract conflicts require affected owners. Main checks must complete on the resulting merge SHA before the next merge.

I1 is not verified until a user reviews generated steps, saves a revision, executes against the buggy target with the real browser, sees an observed failure and registered screenshot, changes only the target bug mode, and reruns successfully with new run/evidence IDs. Record commits, exact commands, screenshots and any fake/unsupported capabilities. Green scaffold tests do not satisfy this gate.
