# Dev 4 implementation plan

This plan is ready for Dev 1 review. The planning baseline is `6a6d55a`. Dev 1 records the implementation base, branch, reviewer, and applicable contract version in the task or PR before implementation. Use the Dev 4 checkout and a separate port when other developers are running the app.

Use **English** for documentation, user-facing UI and demo copy, and code identifiers, comments, and test descriptions. Preserve existing contract values, IDs, and fixture inputs when compatibility requires them.

## Demo milestone

1. **U1 demo target.** Start immediately. Share the route, initial state, labels, `data-testid` values, and expected outcomes with Dev 3 before the 11:00 WIB independent checks. The proposed scenario checks a terms checkbox and asserts the resulting status text. Agree on how to switch between buggy and corrected target states at the same URL so the same workflow revision can run against both. Record the target contract and capture both states.
2. **U1 editor and timeline.** Start layouts and local display fixtures immediately. Bind to Dev 1's shared workflow revision and run fixtures once L0 lands. Show the independent UI by 11:00 WIB. The editor displays the draft and lets the user edit existing steps. The timeline covers `running`, `passed`, `failed`, and `blocked`. Show expected and actual values and a screenshot when the failure fixture supplies them. Label fixture results, capture screenshots, and add dashboard browser coverage for editing and the four states.
3. **P1 UI connection.** Connect after Dev 1 delivers the project, workflow, and run endpoints. Verify that a user can create a project, save the reviewed workflow, and start, check, or cancel a run from the UI. Record test output and identify the P1 fake adapter.
4. **I1 integrated demo.** Dev 1 coordinates P1, A1, B1, and U1. Check the real model-to-browser path at 12:30 WIB and verify the full journey by 14:00 WIB. Review and save a generated draft, run it against the buggy target, and see a failed assertion with expected and actual values and a real screenshot. Correct the target and rerun the same saved revision. The rerun passes and has its own run record. Record the commit, commands, run IDs, and screenshots.

Display the outcome supplied by the run result and keep infrastructure errors, blocked steps, and AI summaries distinct in the result view.

At 14:00 WIB, freeze demo features and focus on reliability. Review critical fixes and capture a labeled fallback recording by 15:00 WIB, rehearse by 16:00 WIB, and hand off launch and submission verification to Dev 1 by 16:30 WIB.

## Full MVP after I1

- **Projects, attachments, and workflow review.** Use Dev 1's project history, attachment, and revision APIs and Dev 2's extraction and generation outputs. Verify project switching and run history, supported uploads and visible rejection errors, and persistence of edited workflows. Check that a stale save shows a conflict and preserves the user's edits. Confirm that regeneration opens a separate draft and that the selected saved revision executes.
- **Run details and evidence.** Use Dev 1's run results and evidence retrieval and Dev 3's evidence manifest and artifacts. Show step outcomes, expected and actual values, available PNG, WebM, and trace links, and incomplete capture status. Verify that the evidence shown belongs to the selected run and that reruns have separate records.
- **CSV, XLSX, and PDF reports.** Build the renderers against Dev 1's frozen `ReportSnapshot` fixture. Render all three formats from the same snapshot. Verify that workflow revision, outcomes, and evidence references reconcile across exports and the UI. Attach sample exports or test output to the PR and verify downloads when Dev 1's routes are available.

## Paths and verification

- Demo and UI work may use `apps/web/app/demo/`, `apps/web/app/projects/`, `apps/web/app/page.tsx`, `apps/web/app/layout.tsx`, and `apps/web/features/`. Dashboard browser specs go under `packages/runner/tests/dashboard-*`.
- Pure report renderers go under `apps/web/server/reports/` and report tests under `apps/web/tests/reports-*`. Route, storage, shared contract, manifest, and lockfile changes go through Dev 1. Dev 2 owns AI generation and Dev 3 owns browser execution and capture.
- For each PR, record exact paths, one reviewer, the current commit, the acceptance checks, and screenshots or command output. Identify which runs used fakes and which used real adapters. Keep credentials out of fixtures, screenshots, and logs.
- Run the [merge gate](../REVIEW.md#required-merge-gate) on the updated PR. Dev 1 owns the serial merge and verifies the latest checks. Browser smoke tests require a production build and port 3000 free.

The [developer handoff](developer-handoff.md) defines ownership and milestone gates. [REVIEW.md](../REVIEW.md) defines task assignment and integration.
