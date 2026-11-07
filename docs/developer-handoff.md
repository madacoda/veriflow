# Developer handoff

## Shared baseline

Every developer starts from main, runs bun install --frozen-lockfile, then bun run dev. Each gets the same monolith and can run their own tests independently. Use short-lived task branches and PRs into main. Review changes to core contracts before consumers implement them.

| Developer | Branch family      | Owned paths                                                            | First deliverable                                                      |
| --------- | ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1         | feat/core-engine   | packages/core, packages/runner                                         | Real Playwright SessionFactory and worker lifecycle                    |
| 2         | feat/functionality | apps/web/features/functionality, apps/web/server/modules/functionality | Project/workflow editor, functional assertions, AI generation adapter  |
| 3         | feat/security      | apps/web/features/security, apps/web/server/modules/security           | Security QA evaluator and separate platform authentication integration |
| 4         | feat/accessibility | apps/web/features/accessibility, apps/web/server/modules/accessibility | axe evaluator, findings UI, report/export adapters                     |

Rotate the integration reviewer for shared pages, routes, manifests, bun.lock, CI and deployment. Each developer owns their feature's thin HTTP route and UI integration. Project, StoredWorkflow, WorkflowRepository and WorkflowGenerator are provided by core. Repository writes use expected revisions to reject stale updates. Use FakeWorkflowRepository and FakeWorkflowGenerator while persistence and AI adapters are developed. Product persistence remains deliberately unimplemented.

## Independent commands

- Core engine developer runs `bun run --cwd packages/core test` and `bun run --cwd packages/runner test`.
- Functionality developer runs `bun x tsx --test apps/web/tests/functionality.test.ts`.
- Security developer runs `bun x tsx --test apps/web/tests/security.test.ts`.
- Accessibility developer runs `bun x tsx --test apps/web/tests/accessibility.test.ts`.
- Everyone runs `bun run test:unit` for the shared contract suite.

## Existing integration points

Import workflowSchema, translateWorkflow, runWorkflow, SessionFactory, QaEvaluator, Finding and Evidence from @veriflow/core.

Use FakeSessionFactory and FakeEvaluator from @veriflow/runner/testing in tests. Fake sessions are isolated per run, collect commands, allow scripted step failures and expose closure state. FakeEvaluator defaults to blocked until a test supplies its expected scenario. Fakes perform no browser or AI calls and are never production success indicators.

Each module has an application/evaluate.ts entry accepting a QaEvaluator and a corresponding test. Replace the fake with your adapter through dependency injection when implementing real behavior. Module code must not import sibling implementations.

The POST /api/workflows/validate endpoint accepts a workflow document, returns a translated plan, returns 400 for invalid JSON, and 422 for invalid workflow structure. It does not execute workflows.

## First PR acceptance criteria

### Engine

Implement the SessionFactory port with one isolated browser context per run. Verify every command and assertion against local fixtures. Honor exact target matching, command timeouts and abort signals. Close sessions after success, failure and cancellation. Enforce project-origin policy across navigation and redirects. Correlate captured artifacts with run and step IDs. Add worker job persistence and recovery as a subsequent reviewed change.

### Functionality

Build a workflow form against the shared schema and validation endpoint. Preserve stable step IDs and empty fill values. Render validation paths and assertion outcomes. Build AI output validation using the same schema and a fake provider before introducing real credentials. Implement the shared revision-based WorkflowRepository contract when adding database or filesystem persistence.

### Security

Implement a QaEvaluator that returns categorized findings and blocked results when prerequisites are missing. Use fixtures for authorization and input validation checks. Verify fixtures cannot run against arbitrary destinations. Establish platform authentication and route authorization separately, with agreed session contracts shared with the UI developer.

### Accessibility

Implement a QaEvaluator adapter around axe. Map violations into stable rule IDs, severities and evidence references. Test a known violation and a clean fixture. Build findings/report UI against the shared DTOs. Define artifact retrieval and export interfaces before persisting reports. Automated results must describe the checks performed.

## Shared semantics

Finding IDs are unique within a run. ruleId is stable across runs. Evidence IDs reference artifacts within the same run. artifactPath is storage-relative, never an arbitrary client-supplied absolute path. A failed assertion fails a step. A QA evaluation can fail even if all actions passed. Missing prerequisites produce blocked, not passed.

Secrets must be supplied at runtime by future session adapters and excluded from persisted workflow values, findings and artifacts. SessionOptions.allowedOrigins is an enforcement contract for the real adapter. The fake does not make network requests.

## Merge gate

A PR must pass frozen install, formatting, lint, typecheck, unit contracts, build and browser integration tests. Include affected contract changes, test evidence and migration notes. Core contract changes require review from an affected consumer owner. Main branch protection must be enabled by a repository administrator to enforce approvals.
