# First journey: lead task board

Dev 1 owns this board and the serial merge queue. The user explicitly reassigned this session to Dev 1 on 2026-11-07; the active GitHub/commit identity is `madacoda` / `me@madacoda.dev`. Earlier records retain their historical authors. Dev 2 is `monsieurafa`, Dev 4 is `Hyuto`, and Dev 3 owns browser/evidence implementation. Implementation sessions use separate checkouts; independent review agents may inspect the lead checkout without editing it. GitHub REST review/merge access works with the authenticated lead account.

Verified lead queue: #5 → #10 → #9 → #11 → #12 → #8 were reviewed, updated and squash-merged serially, with successful main CI between merges. Main `8df3fef016382717feaac85b1d983b6bdf072c25` passed [Linux/Windows/container CI and GHCR publication](https://github.com/madacoda/veriflow/actions/runs/42343422152). Duplicate deployment PR #7 is closed without merging or deleting its branch. Follow-ups #14 (draft/report UI) and #13 (HTTPS/runtime limits) retain their own latest-head gates; their GitHub PRs are the live status records.

The 10:00 WIB gate elapsed before L0 landed. Do not report it as achieved on time. L0 is now merged and consumers can bind to main `3c432f1`; keep the 14:00 known-fail/known-pass cutoff. The full MVP remains the scope in developer-handoff.md. These tasks cover the first journey only.

## L0 — Dev 1; reviewer Dev 4, affected reviews Dev 2/3

- Branch/base: `codex/l0-platform-contracts`, base `6a6d55a3bdf60db4baca8d234be32e704974b281`.
- Outcome: one shared v1 contract and frozen fixture set for every consumer.
- Allowed paths: `packages/core/**`, `docs/contracts-v1.md`, this board, required manifests and lockfile.
- Dependencies/version: existing workflow v1; additive `CONTRACT_VERSION = 1`.
- Acceptance: legacy fixtures remain valid; click translates; project/context/template/tool/run/evidence/report DTOs are exported; untrusted boundary failures are tested; infrastructure failure is distinguishable from observed assertions; consumers review names and lifecycle semantics.
- Verification: frozen install, lint, formatting, type checks, unit tests, build, browser installation and smoke tests. Record exact results on the PR.
- Budget/checkpoint: immediate first review; consumers review in parallel with fixture/layout work. Review/integration retains 40% of Dev 1 capacity.
- Out of scope: real AI/browser/UI implementation, storage adapters, complete MVP claims.
- PR/current commit: [PR #1](https://github.com/madacoda/veriflow/pull/1), merged by the user as main `3c432f1`; contract head `36feb2d` is unchanged.
- Status: merged; local verification passed (18 unit tests, 2 browser tests), PR CI passed, and [main CI passed on the resulting merge commit](https://github.com/madacoda/veriflow/actions/runs/42336421826). No formal review submissions are visible through the connector; further changes still need affected-owner review.

## P1 — Dev 1; reviewer Dev 3 for lifecycle, Dev 4 for HTTP shape

- Branch/base: `codex/p1-platform`, updated with main `3c432f1` in merge commit `0dd05f2`. The local L0 baseline and merged main have identical trees.
- Outcome: persistent projects/revisions and run create/status/cancel APIs; real adapter injected at composition.
- Allowed paths: `apps/web/app/api/**`, `apps/web/server/projects/**`, `apps/web/server/workflows/**`, `apps/web/server/runs/**`, `apps/web/server/composition/**`, `apps/web/tests/platform-*.test.ts`, server environment example, lead coordination/verification documents. Evidence retrieval is included; attachment storage follows after this foundation.
- Dependencies/version: L0 v1 schemas, fixtures and HTTP contract in contracts-v1.md. Dev 3 supplies SessionFactory; missing real adapter returns 503. Fake execution is explicitly configured and labeled.
- Acceptance: create/list/read projects; atomic create-only and compare-and-save revisions; run a pinned saved revision; ordered timeline; cancellation finalizes after cleanup; cross-project access rejects; restart recovers interrupted runs as errors; report snapshot cannot drift after edits.
- Verification: unit tests with temporary persistent directories and controlled sessions covering isolation, concurrent writes, restart, assertion fail versus infrastructure error, cancellation and immutable snapshots; complete merge gate before integration.
- Budget/checkpoint: first reviewable platform slice within 60 minutes after contracts; send an exact blocker if real adapter composition cannot begin. Reserve 40% for integration/review.
- Out of scope: AI loop, Playwright implementation, UI/report rendering, authentication or distributed workers.
- PR/current commit: [PR #2](https://github.com/madacoda/veriflow/pull/2), merged by the user as `aec5515`.
- Status: merged; P3 resolved the subsequent lifecycle/portability findings. The real browser adapter is now integrated through I1-B (#10).

## P2 — Dev 1; reviewer Dev 4; affected review Dev 2

- Branch/base: `codex/p2-attachments-reports`, stacked on P1 `1762fcc` with L0 main `3c432f1` included.
- Outcome: durable project-scoped attachments and binary report delivery ready for the owner's renderer.
- Allowed paths: attachment API routes; `apps/web/server/attachments/**`; platform metadata/storage helpers; `apps/web/server/runs/report-downloads.ts`; composition; `apps/web/tests/platform-*.test.ts`; lead coordination documents. No core or other developer-owned implementation changes.
- Dependencies/version: L0 v1 AttachmentMetadata, AttachmentReader and ReportRenderer; P1 persistence and immutable snapshots. Dev 2 supplies extraction; Dev 4 supplies real renderers.
- Acceptance: enforce upload limits without Content-Length; keep reads project-scoped; survive restart and old P1 database migration; rollback failed registration; deliver and persist renderer output from the pinned snapshot; safe filenames and explicit unavailable-adapter errors.
- Verification: full merge gate, 14 added transport/storage tests and production multipart/restart checks. See platform-p2.md.
- Budget/checkpoint: one independent platform slice while other owners review/start; reserve lead capacity for integration.
- Out of scope: AI extraction/generation, browser adapter, UI and report content rendering.
- PR/current commit: [PR #3](https://github.com/madacoda/veriflow/pull/3), merged by the user as `84327a7`; [main CI passed](https://github.com/madacoda/veriflow/actions/runs/42337370708).
- Status: merged; original full local gate passed (49 unit tests and 2 browser tests), plus production upload/download/restart checks. P3 addresses portability discovered on Windows. Real extraction and rendering remain owner integrations.

## P3 — Dev 1; reviewers Dev 3 and Dev 2

- Branch/base: `codex/p3-integration-guardrails`, main `84327a7`.
- Outcome: resolve affected-consumer review and inherited CI blockers before real adapter wiring.
- Allowed paths: core URL/fixtures and tests, coordinator/composition, platform storage/tests, CI, server configuration and lead documents. No agent/browser/UI implementation edits.
- Dependencies/version: shared version 1 and merged P1/P2. Acceptance: credential URLs rejected throughout shared inputs; fixture byte integrity; atomic bounded admission; cleanup errors distinct from cancellation; deterministic pre/post-allocation deadlines; Windows junction coverage.
- Verification: complete merge gate and Linux/Windows CI on the latest head. See integration-guardrails.md for exact findings and tests.
- Budget/checkpoint: first integration prerequisite; hold further merge admission while the inherited gate is red.
- Out of scope: AI provider, browser implementation, UI and report rendering.
- PR/current commit: [PR #6](https://github.com/madacoda/veriflow/pull/6), user merged as `eb02beb608d7e52422f17561d491800a9be3bbac`.
- Status: verified; full local gate passed with 59 unit tests and 2 browser checks, affected-consumer findings were resolved, and [Linux/Windows main CI passed](https://github.com/madacoda/veriflow/actions/runs/42339119726).

## A1 — Dev 2; reviewer Dev 3

- Branch/base: `codex/a1-agent-tools`; use the L0 merge SHA recorded by Dev 1, separate checkout.
- Outcome: objective becomes an editable, schema-valid draft; bounded model/tool loop can be tested independently.
- Allowed paths: `apps/web/server/agent/**`, `apps/web/server/context/**`, `apps/web/server/templates/**`, `apps/web/tests/agent-*.test.ts`, `apps/web/tests/context-*.test.ts`, `apps/web/tests/templates-*.test.ts`.
- Dependencies/version: L0 `DraftGenerator`, `ContextExtractor`, `AttachmentReader`, `AgentToolPort`, tool schemas and versioned template DTO. Request dependency changes through Dev 1.
- Acceptance: validate provider output; return draft without persisting; reject unknown tools/arguments before execution; enforce max calls/time/cancel; errors are safe and mapped; no fake fallback disguised as a model. Catalog starts with the shared functional fixture and explicit capability requirements. No unsupported image extraction is silently accepted.
- Verification: deterministic provider/session fixtures for good draft, malformed output, invalid tool, max calls, cancellation and missing model configuration; include a separately labeled real-provider check when configured.
- Budget/checkpoint: independent fake generation/tool test by the next checkpoint; target 45 minutes after L0. Real validated tool integration is the 12:30 WIB gate.
- Out of scope: storage writes, Playwright imports, HTTP endpoints, observed pass/fail decisions, editing saved workflows.
- PR/current commit: [PR #5](https://github.com/madacoda/veriflow/pull/5), reviewed head `5728daddfb71c520790bb9c491c55881eb4b4394`, merged as `8d11c70786dd6b5c69f63a8618e918597a9464c2`.
- Status: verified; full local gate, independent AI review, latest-head and main CI passed. Follow-up provider PR #12 merged as `3ac293bf8b75edc3cdff2360527bc06eef001599`. Its revised Chat Completions transport has deterministic HTTP fixture coverage; historical Responses live checks do not verify that transport. AI HTTP/agent composition remains separate integration work.

## B1 — Dev 3; reviewer Dev 2; Dev 1 reviews cleanup/evidence

- Branch/base: `codex/b1-browser-session`; use L0 merge SHA, separate checkout and unused local test port.
- Outcome: real deterministic browser adapter executes workflow commands and captures screenshot evidence on pass/fail.
- Allowed paths: `packages/runner/src/**`, `packages/runner/unit/**`, `packages/runner/playwright.config.ts`, `packages/runner/tests/browser-*.spec.ts`.
- Dependencies/version: L0 `Command`, `SessionFactory`, `BrowserSession`, `Evidence` and capture finalization semantics. Dev 4 confirms the demo contract; use an independent local target fixture until then. Manifest changes go through Dev 1.
- Acceptance: navigate/fill/click/setChecked/assert with exact targets; enforce allowed origins including redirects; bounded observe; timeout/cancellation; known fail has expected/actual and real PNG; partial opens and pass/fail/cancel clean up; finalized evidence is available before the coordinator terminates the run. Infrastructure errors cannot masquerade as assertion failures.
- Verification: own browser fixture for pass/fail/blocked, disallowed initial/redirect origin, cancellation, timeout, media ownership and no leaked browser/session resources; full gate before merge.
- Budget/checkpoint: independent browser fixture within 45 minutes of L0; report precise unsupported capabilities rather than claim full template execution.
- Out of scope: HTTP routes, AI generation, template definition ownership, report rendering, shared contract edits without agreement.
- PR/current commit: [PR #4](https://github.com/madacoda/veriflow/pull/4), reviewed head `afee170f6d452903bcba99f3cf88704efc26dc27`; squash-merged by Dev 1 as `39bd03ddc2ed5104738bf787b85588e1270033f7`.
- Status: verified; Dev 1 and Dev 2 approved the same updated head after full gates (62 units, 18 browser tests). Exact test-ID round-trips and P3 credential-validation semantics are fixed. [Linux/Windows main CI passed](https://github.com/madacoda/veriflow/actions/runs/42340226085). Runtime wiring follows in I1-B.

## U1 — Dev 4; reviewer Dev 1

- Branch/base: `codex/u1-project-workbench`; use L0 merge SHA; pure layout/demo can start from the current base in a separate checkout.
- Outcome: project/workflow editor, timeline and a switchable buggy target that tells one complete story.
- Allowed paths: `apps/web/app/page.tsx`, `apps/web/app/layout.tsx`, `apps/web/app/demo/**`, `apps/web/app/projects/**`, `apps/web/features/**`, `apps/web/server/reports/**`, `apps/web/tests/reports-*.test.ts`, `packages/runner/tests/dashboard-*.spec.ts`.
- Dependencies/version: L0 API envelopes and `RunRecord`/`ReportSnapshot`; consume labeled fixtures until P1. Confirm `/demo?bug=1|0`, SAVE10 discount and test IDs in contracts-v1.md early. Runner configuration belongs to Dev 3; dependency changes go through Dev 1.
- Acceptance: create/select project; edit draft before explicit save; run the selected saved revision; render queued/running/pass/fail/blocked/error/cancelled; expected versus actual and screenshot evidence visible; fake fixtures clearly labeled. Buggy target shows 100000 and fixed target 90000 after coupon application. Preserve inputs on server errors/conflicts.
- Verification: screenshots of fixture states and target pass/fail; own dashboard browser tests; no broken controls. Later exports must use the same immutable snapshot.
- Budget/checkpoint: confirm target IDs immediately; independent UI fixture by next checkpoint; target 45 minutes after L0.
- Out of scope: platform persistence, HTTP/storage report adapters, AI prompts, browser execution, contract/manifests changes without Dev 1.
- PR/current commit: [PR #9](https://github.com/madacoda/veriflow/pull/9), owner `Hyuto`, merged as `a5047f6197a8a16c22a7608323382eda3354a004`.
- Status: verified; the actual UI saves revisions, executes the known-fail/known-pass target, retrieves owned PNGs and preserves the earlier failed report. Main CI passed. Attachment UI and the pure CSV renderer followed in #11 (`d8701bc76f6ac6a44e87117f3211d81a176fb889`); extraction and renderer composition remain separate tasks.

## I1-B — Dev 1; reviewer Dev 3

- Branch/base: `codex/i1-browser-composition`, B1 main `39bd03d`.
- Outcome: production project/run routes use the reviewed real Chromium factory by default; explicit fixture mode stays labeled.
- Allowed paths: manifests/lockfile, Next and TypeScript shared configuration, `apps/web/server/composition/**`, server environment example, `packages/runner/tests/platform-integration.spec.ts` and lead documents. Browser/AI/UI implementation remains with its owners.
- Dependencies/version: merged P1/P2/P3/B1; shared contract version 1. AI provider, bounded-loop composition and U1 remain separate prerequisites for the complete I1 journey.
- Acceptance: built Next routes save pinned revisions, execute real failed/passed assertions, retrieve registered run-owned PNGs, reject cross-project evidence and preserve the failed report after a later save and process restart. Fixture mode never fabricates evidence. Unknown adapter modes reject explicitly.
- Verification: standard REVIEW.md gate; production-route tests launch isolated Next servers on OS-assigned ports with temporary storage. Browser assertions, not model output, determine outcomes. Test target is Dev 3's independent fixture.
- Budget/checkpoint: finish browser composition while A1 peer review proceeds; reserve time for latest-main verification and owner review.
- Out of scope: AI/provider implementation, UI/report rendering, additional browser capabilities, deployment release and full-MVP completion claims.
- PR/current commit: [PR #10](https://github.com/madacoda/veriflow/pull/10), reviewed head `796ac3d239931c5636851403fe0a9bfa3b9b83d5`, merged as `53d4b34eaafaf7cc8148f3679649c0e56ace8608`.
- Status: verified; full gate, affected review and main CI passed. Production HTTP pass/fail, PNG ownership, isolation, restart and labeled fixtures are covered. #8 additionally verifies the packaged standalone application through those HTTP boundaries before publication.

## Merge queue and I1 release evidence

L0/P1/P2/P3/A1/B1/U1/I1-B and the follow-ups above have landed. The current main/release evidence is at the top of this board. Each owner fixes their own errors; shared-contract conflicts require affected owners. Main checks must complete on the resulting merge SHA before the next merge.

I1 is not verified until a user reviews generated steps, saves a revision, executes against the buggy target with the real browser, sees an observed failure and registered screenshot, changes only the target bug mode, and reruns successfully with new run/evidence IDs. Record commits, exact commands, screenshots and any fake/unsupported capabilities. Green scaffold tests do not satisfy this gate.

## AUTH-1 — Dev 1; reviewers Dev 3 and Dev 4

- User request: application password login, explicitly delegated in the deployment chat on 2026-11-07. The current Nginx Basic Auth gate remains active until a separately verified cutover.
- Branch/base: planned `feat/application-auth`, planning baseline main `8df3fef016382717feaac85b1d983b6bdf072c25`; record the exact updated main SHA when implementation starts. Use an isolated checkout.
- Outcome: application login and session enforcement for the trusted team. Freeze the session/API contract with Dev 4 before UI implementation starts.
- Allowed paths: `apps/web/server/auth/**`, auth API routes, shared route guards/composition, server-only configuration, auth/transport tests and lead-owned contract documentation. Dev 1 coordinates any shared schema or test-harness changes with affected owners.
- Dependencies/version: current platform v1; authentication is an additional boundary, not a workflow version change. Define login/session/logout DTOs, error envelopes, safe return paths and session expiry semantics before dispatching AUTH-UI.
- Acceptance: server-only password hash; no credentials in bundles, logs, workflows or evidence; Secure/HttpOnly/SameSite production session cookies with expiry and logout invalidation; bounded login attempts and generic errors; same-origin/CSRF protection; unauthenticated project/run/AI/attachment/evidence/report requests reject directly; missing configuration fails closed; return URLs stay local.
- Verification: credential-free deterministic auth tests plus authenticated real browser fail/pass and evidence retrieval. Adapt CI and container smoke with explicit fixture authentication, preserving production guards. Review secret handling, session expiry/invalidation, origin checks and every protected route on the exact PR head.
- Budget/checkpoint: contract review first, then a reviewable backend slice; reserve lead merge/release capacity. Report exact blockers at the contract and end-to-end checkpoints.
- Out of scope: self-registration, OAuth, multi-tenant roles and removal of the Nginx gate.
- PR/current commit: not yet opened; no application-auth implementation is claimed by this review task.
- Status: planned and assigned to Dev 1; contract freeze is the next action.

## AUTH-UI — Dev 4; reviewer Dev 1

- Branch/base: planned `feat/application-login-ui`; base the exact reviewed AUTH-1 contract commit recorded at dispatch, in Dev 4's isolated checkout.
- Outcome: accessible application login/logout screens using the frozen contract.
- Allowed paths: `apps/web/app/login/**`, `apps/web/features/auth/**` and dedicated auth UI tests. Request an explicit integration slot for existing layout/workbench mounts; those remain with their current owner until coordinated.
- Dependencies/version: AUTH-1 contract freeze. Do not invent or duplicate server session/security policy while waiting.
- Acceptance: keyboard-accessible form, loading/invalid-password/rate-limit/unavailable states, safe local return navigation, logout confirmation and no secret persistence in localStorage, URLs, analytics or logs. Existing draft/run state must not leak between authenticated and unauthenticated views.
- Verification: fixture UI tests against the frozen envelopes, followed by actual session-cookie login/logout and protected API/evidence checks after AUTH-1 integration. Include screenshots and exact commands in the PR.
- Budget/checkpoint: UI work begins immediately after contract review; deliver a small independently reviewable PR before cutover testing.
- Out of scope: password verification, cookie signing/session storage, auth route guards, deployment credentials and Nginx configuration.
- PR/current commit: not yet opened; dispatch waits for the reviewed contract commit.
- Status: planned for Dev 4; not yet authorized to edit shared integration paths.
