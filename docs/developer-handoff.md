# MVP delivery handoff

## Planning baseline

The full MVP in the user's latest brief is the product scope. The seven-hour event is the first demonstration milestone. Features deferred from that demonstration remain required MVP work. This allocation supersedes the earlier feature-category team split.

Dev 1 is the single lead orchestrator and merge owner. [REVIEW.md](../REVIEW.md) defines the merge process. The team contains four developers including the lead. Keep the existing Next.js monolith and Bun toolchain. [Current implementation status](project-status.md) separates the original allocation below from completed delivery and remaining integrations.

## Exclusive implementation ownership

| Developer                       | Owns                                                                                                                                       | Explicit boundary                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Dev 1 — platform and lead       | Project/workflow persistence, attachment upload/storage, run APIs and lifecycle, composition, deployment and shared contracts              | Integrates adapters; does not implement the AI loop, browser adapter or report renderer                                      |
| Dev 2 — AI and test definitions | Attachment text extraction, context assembly, scenario generation, versioned template catalog, AI target suggestions and failure summaries | Does not write files to attachment storage, execute browser actions, decide observed pass/fail or overwrite edited workflows |
| Dev 3 — execution               | Browser actions, observations, assertions, viewport modes, security/a11y check adapters, PNG/WebM/trace capture                            | Does not generate template definitions, expose HTTP routes or render downloadable business reports                           |
| Dev 4 — product UI and reports  | Project/editor/dashboard UI, demo target, result presentation, pure CSV/XLSX/PDF renderers                                                 | Does not implement persistence, AI prompts or browser execution; report HTTP routes are thin Dev 1 adapters                  |

Reserve approximately 40 percent of Dev 1's capacity for review, integration and release work. Reduce assigned platform implementation in each milestone if that reserve is consumed. Every owner implements and tests their own error mapping before integration.

## File ownership

These paths define ownership for existing and future work; a path allocation is not a completion claim. Dev 1 also owns `apps/web/server/auth/**` and authentication HTTP adapters; Dev 4 owns `apps/web/app/login/**` and `apps/web/features/auth/**` when the AUTH-1 contract is frozen.

| Owner | Paths                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev 1 | packages/core; apps/web/app/api; apps/web/server/projects; apps/web/server/workflows; apps/web/server/attachments; apps/web/server/runs; apps/web/server/composition; root configuration; all package manifests; bun.lock; CI; shared fixtures |
| Dev 2 | apps/web/server/agent; apps/web/server/context; apps/web/server/templates; apps/web/tests/agent-_; apps/web/tests/context-_; apps/web/tests/templates-*                                                                                        |
| Dev 3 | packages/runner/src; packages/runner/unit; packages/runner/playwright.config.ts; packages/runner/tests/browser-*                                                                                                                               |
| Dev 4 | apps/web/app/page.tsx; apps/web/app/layout.tsx; apps/web/app/demo; apps/web/app/projects; apps/web/features; apps/web/server/reports; apps/web/tests/reports-_; packages/runner/tests/dashboard-_                                              |

Legacy functionality/security/accessibility server directories are not active work areas. Dev 1 assigns any reuse or movement explicitly. No task may own a parent path that includes another active task's files. Dev 4 owns dashboard browser tests; Dev 3 owns runner configuration. Dependencies and lockfile edits are requested through Dev 1.

## Shared contract gate

L0 was merged in PR #1. Start from current main and the [v1 contract](contracts-v1.md). For each extension, Dev 1 authors a small contract change reviewed by affected implementers. Freeze one happy-path fixture and failure fixtures before consumer implementation.

| Contract                        | Producer → consumer                  | Required semantics                                                                                    |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Project and attachment metadata | Dev 1 → Dev 2/4                      | Project ownership, supported formats, size limits, extraction status and rejection behavior           |
| ContextDocument                 | Dev 2 → generation                   | Source attachment ID, extracted text, supported-format errors; screenshots handled explicitly         |
| Workflow and revision           | Dev 2 drafts / Dev 1 saves → Dev 3/4 | Stable IDs, typed actions/assertions, optimistic updates; regeneration creates a draft                |
| TemplateDefinition              | Dev 2 → Dev 3/4                      | Version, category, prerequisites, parameter schema, required executor capabilities                    |
| Browser tools and observations  | Dev 3 → Dev 2                        | Validated arguments, bounded observation, timeout/cancellation, permitted targets and origins         |
| RunEvent and RunResult          | Dev 1 composes Dev 3 output → Dev 4  | Sequence, timestamps, lifecycle state, per-step expected/actual data, outcome and artifact references |
| EvidenceManifest                | Dev 3 → Dev 1/4                      | Run/step identity, media type, storage-relative path, capture completeness                            |
| ReportSnapshot                  | Dev 1 → Dev 4 renderer               | Immutable workflow revision, observed results, evidence metadata and optional AI summary              |

The shared contracts and fixtures are implemented. Browser execution, platform routes and UI are integrated; AI modules still need runtime composition. Reuse those interfaces instead of creating competing contracts. New additive workflow steps preserve schema version 1; see [testing coverage](testing-coverage.md).

The intended AI integration must share the coordinator-owned session lifetime used by deterministic execution. Dev 2 requests validated actions through Dev 3's adapter; it never imports Playwright directly. Run finalization happens only after checks and evidence capture finish.

Browser/check adapters produce observed results. AI summarizes them and cannot replace them. The run coordinator computes the final outcome. A skipped prerequisite is blocked. Transport/infrastructure lifecycle errors are distinct from failed test assertions.

## First milestone — one complete journey

| Task                                     | Owner                                      | Depends on      | Acceptance                                                                                                             |
| ---------------------------------------- | ------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| L0 contracts and fixtures                | Dev 1; consumer review                     | None            | All consumers compile against one agreed contract version                                                              |
| P1 minimal project/workflow/run APIs     | Dev 1                                      | L0              | Create project, save reviewed workflow, start/status/cancel a fake run; project separation verified                    |
| A1 generation and bounded fake tool loop | Dev 2                                      | L0              | Objective becomes schema-valid editable draft; invalid tool input rejected; max calls enforced                         |
| B1 deterministic browser adapter         | Dev 3                                      | L0              | Local target executes actions and assertions, captures PNG, closes on pass/fail/cancel                                 |
| U1 editor, timeline and buggy target     | Dev 4                                      | L0 for bindings | Fixture UI covers running/pass/fail/blocked; demo labels/test IDs stable                                               |
| I1 real integration                      | Dev 1 coordinates; owners fix their layers | P1, A1, B1, U1  | User reviews generated workflow, executes it, sees a real failure and screenshot, fixes target and reruns successfully |

A1 and B1 are independently testable. Neither must wait for the other's real implementation. U1 uses shared API fixtures while P1 is developed. Dev 4 supplies the target contract early; Dev 3 keeps an independent local test fixture.

## Full MVP follow-through

These are full-MVP acceptance requirements. Some are already implemented; use [project status](project-status.md) for completion and gaps rather than reassigning completed tasks.

| Task group                    | Primary owner                             | Required acceptance                                                                                                                               |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple projects and history | Dev 1                                     | Isolation across projects; data survives restart; revisions reject stale writes                                                                   |
| Attachments                   | Dev 1 storage; Dev 2 extraction; Dev 4 UI | Supported PRD/BRD/story/screenshot inputs reach generation with source references; unsupported inputs give clear errors                           |
| Template catalog              | Dev 2                                     | Functional, responsive, basic security, supplied-requirement compliance, accessibility and regression definitions have fixtures and prerequisites |
| Template execution            | Dev 3                                     | Each catalog capability has a tested implementation or explicit blocked result; viewport and axe checks verified                                  |
| AI assistance and summaries   | Dev 2                                     | Bounded validated tool use; no unsupported action executes; summaries distinguish observation from interpretation                                 |
| Evidence                      | Dev 3 capture; Dev 1 retrieval            | PNG, WebM and traces tied to a run; access resolves registered artifacts; incomplete capture surfaced                                             |
| Workflow review and result UI | Dev 4                                     | User edits persist; the selected revision is executed; expected/actual and blocked states displayed                                               |
| CSV/XLSX/PDF                  | Dev 4 rendering; Dev 1 HTTP/storage       | All formats derive from the same ReportSnapshot and reconcile with UI results                                                                     |

PPTX and SQLite remain optional. WebM satisfies the initial video requirement; MP4 is conditional on supported conversion. Regression reruns pin a workflow revision and create new run/evidence records. Compliance refers to supplied requirements and never implies legal certification.

## Reviews and integration

Dev 1 assigns tasks using REVIEW.md's template and merges serially. Each task has one implementer, one reviewer, exact paths, base commit, dependency fixtures and acceptance evidence.

- Dev 2 and Dev 3 cross-review tool and observation semantics.
- Dev 1 reviews execution lifecycle, persistence and evidence ownership.
- Dev 4 reviews contracts consumed by the UI and report rendering.
- Dev 1's changes receive an affected consumer's review.
- All authors retain responsibility for correcting their layer after integration.

Template and workflow contract changes use explicit versions. Additive changes preserve prior fixtures. Breaking changes require a small coordinated contract PR before consumers change. No developer resolves another owner's semantic conflict without their review.

## Time-boxed event overlay

The source plan uses WIB. By 10:00, land L0. By 11:00, fake agent, browser fixture and UI run independently. By 12:30, connect real model-driven actions. By 14:00, verify I1 and freeze new demonstration features. By 15:00, review critical fixes and record fallback. Rehearse by 16:00 and submit by 16:30.

The complete MVP is not promised within seven hours. The lead reports demonstration readiness and full-MVP completion separately. Distributed queues, complex analytics, autonomous code fixing and multi-user account management remain outside this allocation. A subsequent request adds trusted-team username/password login: Dev 1 owns [AUTH-1](https://github.com/madacoda/veriflow/issues/16), and Dev 4 owns [AUTH-UI](https://github.com/madacoda/veriflow/issues/17). The backend contract precedes UI binding; keep the Nginx access gate until a separately verified cutover.

## Verification

Run bun install --frozen-lockfile, bun run lint, bun run format:check, bun run typecheck, bun run test:unit, bun run build and bun run test:smoke. Install Chromium first with bun run browsers:install. Browser tests need the selected port free (1111 by default); use distinct `PORT` values for local checkouts.

For every milestone, verify the integrated result with real adapters as well as deterministic fixtures. Record current commit, commands, screenshots and limitations. Green scaffold CI alone does not prove any unimplemented capability.
