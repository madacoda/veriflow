# PDF export

Terminal runs expose **Download PDF** in the **Run report** section. The authenticated `GET /api/projects/:projectId/runs/:runId/report?format=pdf` endpoint returns an attachment named `veriflow-<runId>.pdf` with `application/pdf` and `Cache-Control: no-store`.

The renderer consumes the existing immutable `ReportSnapshot` contract. Editing the workflow or rerunning it does not change an earlier report. Downloads retain the existing project/run ownership, terminal-run checks, output validation and safe storage adapter. JSON and CSV remain available; XLSX still returns an explicit 422 error.

The PDF includes project, workflow revision and run identity; lifecycle and observed outcome; step results and expected/actual details; requirement and finding metadata; registered evidence references and capture warnings. Fake execution and any optional AI summary are labeled. Evidence files remain available through the app; the PDF does not embed screenshot bytes or filesystem paths. An error, cancellation or missing outcome is never presented as a passed run.

Rendering uses `pdf-lib`, `@pdf-lib/fontkit` and a bundled OFL Noto Sans font, without network requests, browser launch or filesystem reads. Long text wraps across numbered pages. Unsupported font characters appear as explicit Unicode codepoint references with an explanation instead of silently disappearing. The font's source and license are retained beside its bundled data. `pdfjs-dist` is a development dependency used to independently verify PDF text and structure.

## PDF-1 task record

- Owner: Dev 4 for the renderer, report controls and renderer/UI tests; Dev 1 for runtime composition, dependency manifests, HTTP integration checks and documentation.
- Reviewer: Dev 1 reviews Dev 4 output; Dev 4 reviews the lead's integration changes.
- Branch/base: `codex/pdf-export` from `29f813148717b76479232f4882f1f002308efba5`; Dev 4 works in the isolated `codex/pdf-renderer` checkout.
- Frozen dependency: contract v1 `ReportSnapshot` and `ReportRenderer`; no shared contract changes.
- Acceptance: real readable PDF downloaded through the existing control/API; pinned revision and observed result parity; clear failed/blocked/error/cancelled states; multipage/Unicode handling; ownership and active-run rejection; no snapshot mutation; retained CSV/JSON compatibility.
- Verification: renderer tests parse output with an independent PDF reader; runtime tests verify download headers, persisted bytes and snapshot parity; Chromium checks exercise the built routes and UI; exported sample pages receive visual review.
- Out of scope: XLSX, screenshot embedding, new AI composition, browser execution changes and deployment configuration.
- Status: implementation and verification in progress on the feature branch.

Verification results are recorded after the full local gate completes. These local checks do not establish a deployed release.
