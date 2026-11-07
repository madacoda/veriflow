# Six-category workflow coverage

Source status and the unresolved baseline CI gate are recorded in [project status](project-status.md). This implementation extends workflow schema version 1 additively. Existing workflows and saved revisions remain valid. Template definitions use version 1.1.0; the legacy coupon template remains 1.0.0.

## Acceptance and verification

| Category       | Acceptance                                                                                | Real-browser verification                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Functional UAT | Forms, navigation, sign-in, create/read/update/delete, observed business result           | Browser coverage fixture performs real DOM actions and HTTP sign-in, then checks private/member-only access        |
| Responsive     | Desktop 1440×900, tablet 768×1024, mobile 390×844; optional exact target containment      | All sizes pass on a fluid page; all three fail on an overflowing target                                            |
| Security       | Expected unauthenticated/unauthorized HTTP statuses, authenticated access, rejected input | Anonymous 401, member 200, member admin 403; an unexpectedly public endpoint fails                                 |
| Compliance     | Explicit supplied requirements, IDs, source references, expected/actual results           | Unmet requirement fails; later independent requirement still executes; source appears in UI/CSV                    |
| Accessibility  | Real axe scan with configured WCAG tags, rule findings and evidence                       | Clean page passes; missing image alternative fails with `image-alt`; incomplete axe checks block for manual review |
| Regression     | Re-execute the exact saved revision with new run/evidence IDs and preserved viewport      | Unchanged saved workflow fails on buggy target, passes after target-only fix; previous report remains unchanged    |

`packages/runner/tests/browser-coverage.spec.ts` uses a deterministic local **target application fixture**, a real Chromium session, real HTTP and real assertions. It does not use a fake execution adapter. `dashboard-coverage.spec.ts` verifies the production API and UI with `VERIFLOW_U1_TEST_HTTP=1` and isolated storage. Existing explicitly labeled fake-adapter unit suites remain for lifecycle/error testing.

## Using the workbench

Choose a project, select **Testing template**, edit its parameters to match the target's exact labels or test IDs, and create a draft. Review/edit the steps and explicitly save before starting. Run viewport presets apply to ordinary workflows; responsive workflows contain their own viewport matrix. **Rerun revision** reuses the run's saved workflow ID, revision and initial viewport. Steps, findings, requirement sources and screenshots are shown in the timeline and CSV report.

The template API is `GET/POST /api/projects/:projectId/templates`. POST accepts `{templateId, parameters}` and returns an unsaved `{workflow}`. Parameters are validated and navigation is confined to the project origins. No model call is needed for these deterministic templates.

## New steps

- `viewport`: width and height within shared viewport bounds.
- `assertLayout`: horizontal document overflow, optionally a visible exact target inside viewport width.
- `assertHttp`: browser navigation followed by an assertion against explicit HTTP statuses. Expected 401/403 responses can pass; ordinary redirect steps retain their prior behavior.
- `accessibility`: axe-core checks, default WCAG 2 A/AA and 2.1 A/AA tags. Findings include rule, severity, affected-element count and screenshot IDs. Automated checks do not prove full WCAG conformance.
- `assertRequirement`: requirement ID, supplied text, optional source, exact target and ordinary visibility/checked/text expectation. Independent requirement/layout assertion failures allow later checks to run; infrastructure errors stop execution.
- `fillSecret`: exact target and uppercase secret reference. Set `VERIFLOW_SECRET_<REFERENCE>` on the server, e.g. USERNAME and PASSWORD. Values are never stored in the workflow. Missing values block. Once secrets are used, subsequent screenshots are deliberately omitted because target pages may echo credentials anywhere; observations/results redact known values and capture remains partial. Configure accounts for testing only.

Compliance checks validate the supplied checklist only. Security templates are basic target-application checks, not a penetration test. Regression is manually triggered; scheduling and baseline-diff analysis are outside this scope. CSV is connected to the runtime; PDF/XLSX remain unconfigured.

## Verification evidence

The original coverage implementation recorded local verification with frozen Bun install, lint, formatting, type checking, 110 passing unit tests, production build, Chromium installation and 46 passing Chromium tests in the complete browser suite with isolated storage and `VERIFLOW_U1_TEST_HTTP=1`. Runtime artifact paths are excluded from Turbopack dependency tracing. Run `bun run test:dev` against the running development server to check for reload loops and lost form state. Those local counts describe the original implementation session. The later main `0e2d732` browser gate failed during test-module loading, before these cases executed; no successful CI or deployment of this coverage extension is claimed.
