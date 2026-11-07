# PDF export

Terminal runs expose **Download PDF** in the **Run report** section. The authenticated `GET /api/projects/:projectId/runs/:runId/report?format=pdf` endpoint returns an attachment named `veriflow-<runId>.pdf` with `application/pdf` and `Cache-Control: no-store`.

The renderer consumes the existing immutable `ReportSnapshot` contract. Editing the workflow or rerunning it does not change an earlier report. Downloads retain the existing project/run ownership, terminal-run checks, output validation and safe storage adapter. JSON and CSV remain available; XLSX still returns an explicit 422 error.

The PDF includes project, workflow revision and run identity; lifecycle and observed outcome; step results and expected/actual details; requirement and finding metadata; registered evidence references and capture warnings. Fake execution and any optional AI summary are labeled. Evidence files remain available through the app; the PDF does not embed screenshot bytes or filesystem paths. An error, cancellation or missing outcome is never presented as a passed run.

Rendering uses `pdf-lib`, `@pdf-lib/fontkit` and a bundled OFL Noto Sans font, without network requests, browser launch or filesystem reads. These modules load only when PDF export is requested. Long text wraps across numbered pages. Expected/actual values use quoted escapes to preserve empty strings, tabs, line breaks and significant whitespace. Unsupported font characters appear as explicit Unicode codepoint references with an explanation instead of silently disappearing. The font's source and license are retained beside its bundled data. `pdfjs-dist` is a development dependency used to independently verify PDF text and structure.

## PDF-1 task record

- Owner: Dev 4 for the renderer, report controls and renderer/UI tests; Dev 1 for runtime composition, dependency manifests, HTTP integration checks and documentation.
- Reviewer: Dev 1 reviews Dev 4 output; Dev 4 reviews the lead's integration changes.
- Branch/base: `codex/pdf-export` from `29f813148717b76479232f4882f1f002308efba5`, updated with main `9ae1126`; Dev 4 worked in the isolated `codex/pdf-renderer` checkout.
- Frozen dependency: contract v1 `ReportSnapshot` and `ReportRenderer`; no shared contract changes.
- Acceptance: real readable PDF downloaded through the existing control/API; pinned revision and observed result parity; clear failed/blocked/error/cancelled states; multipage/Unicode handling; ownership and active-run rejection; no snapshot mutation; retained CSV/JSON compatibility.
- Verification: renderer tests parse output with an independent PDF reader; runtime tests verify download headers, persisted bytes and snapshot parity; Chromium checks exercise the built routes and UI; exported sample pages receive visual review.
- Out of scope: XLSX, screenshot embedding, new AI composition, browser execution changes and deployment configuration.
- Status: implementation reviewed and locally verified on the feature branch; not merged or deployed.

## Verification

The frozen install, lint, formatting, type checks, production build and Chromium installation passed. Unit suites passed 291 tests (9 core, 9 runner, 273 web); three opt-in live-provider tests were skipped. This includes six independent PDF parser tests and a real runtime download/storage/pinning test. Deployment and transport shell fixture checks also passed.

The final Chromium check passed all 116 cases in 2.6 minutes: two complete runs with four workers and zero retries (`PORT=1133 VERIFLOW_U1_TEST_HTTP=1 VERIFLOW_RUN_ADAPTER=browser bun run test:smoke --workers=4 --retries=0 --repeat-each=2`, with isolated temporary `STORAGE_DIR`). Logs are retained locally under `/tmp/veriflow-pdf.ZpfgeE/`; visual samples are under ignored `test-results/pdf-export-preview/`.

The built HTTP check downloads a PDF after a workflow edit and server restart, compares stored bytes and verifies that the earlier snapshot is unchanged. The real UI journey downloads both CSV and PDF, checking the PDF response, filename, file structure and success message. Normal two-page and long Unicode/error four-page samples were rendered to PNG and visually inspected for margins, pagination and readable text.

Initial parallel runs exposed two separate test issues. The full generation/UI journey exceeded its default 30-second total budget during the final accessibility scan after its substantive assertions passed. Its total budget is now 60 seconds, including the added PDF download; individual execution and poll deadlines remain unchanged. The PDF library is also loaded lazily to avoid overhead on unrelated API requests.

A later regression fixture reported a terminal infrastructure error; its original trace lacked the underlying command details. It passed three subsequent parallel repetitions without deadline changes. Dev 3 reviewed the updated test helper, which still requires `completed`, fails immediately on a terminal error and attaches the observed run before fixture cleanup. The cause of that original error is not established, and its 10-second step budgets are unchanged.

Dev 1 reviewed the renderer and all preview pages. Dev 4 reviewed runtime integration and lazy loading; Dev 3 reviewed the diagnostic-only coverage helper. These are agent reviews, not GitHub user approvals.

`bun audit --json` reports existing `deepmerge`, `minimatch` and `uuid` advisories. Their affected versions and dependency paths already exist in main's lockfile; none are introduced by the PDF dependencies. Docker's daemon is unavailable locally, so container verification remains a remote CI check. Local verification does not establish a deployed release.
