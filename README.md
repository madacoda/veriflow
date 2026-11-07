# Veriflow

An AI-powered UAT and QA automation platform under development. One Next.js application serves the dashboard and HTTP API; a shared TypeScript engine executes reviewed workflows through Playwright. Bun manages the workspace, and Node.js runs the application.

The current implementation supports persistent projects, editable workflow revisions, real browser execution, six testing categories, evidence capture and CSV reports. Live AI generation and agent execution still need application integration. See [implementation and release status](docs/project-status.md), including the existing browser-test CI failure on the documentation baseline.

## Quick start

Install **Node.js 24** and **Bun 1.4.4**, then run from the repository root:

```sh
bun install --frozen-lockfile
bun run browsers:install
bun run dev
```

Open [localhost:1111](http://localhost:1111). Chromium is required for real runs; starting the dashboard alone needs neither Chromium nor an AI key. Linux hosts may need `bun run browsers:install --with-deps`.

Local development defaults to Next.js Webpack mode with Fast Refresh. This avoids the repeated Turbopack `HMR hash mismatch` reloads reproduced in this workspace. Explicit `bun run dev --turbopack` remains available for diagnosis; production builds keep their existing configuration.

Optional server configuration belongs in `apps/web/.env.local`; copy [the example](apps/web/.env.example) before editing it. Keep credentials out of Git. Workspace packages export TypeScript source, which Next.js transpiles directly; no preliminary package build or background compiler is required.

## First workflow

1. Create a project with its title, target URL, description and goals. The project URL establishes its allowed origin.
2. Choose **Testing template**, edit its parameters for the target's exact labels or test IDs, and create a draft. Templates are deterministic and make no model call.
3. Review/edit the workflow, explicitly save it, and run that saved revision.
4. Inspect the ordered timeline, expected/actual results, findings and available evidence. Download CSV from the terminal run's report.
5. Use **Rerun revision** to execute the same saved steps again with a new run ID.

The bundled coupon target at `/demo?bug=1` returns the incorrect total `100000`; `/demo?bug=0` returns `90000` after applying `SAVE10`. Both pages expose `coupon-input`, `apply-coupon` and `order-total` test IDs. Target URLs must be reachable from the server running Chromium. For the deployed monolith, use its internal `http://127.0.0.1:1111/demo` URL, as explained in [deployment](docs/deployment.md).

## Current capabilities

| Area                   | Available in the application                                                                                             | Remaining work or limits                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Projects and workflows | Multiple projects, immutable revisions, explicit draft review/save                                                       | Single trusted team; project scoping is not user authorization                                                       |
| Templates              | Functional, responsive, basic security, supplied-requirement compliance, axe accessibility and saved-revision regression | Exact target parameters and prerequisites must match the application under test                                      |
| Execution              | Real Chromium, ordered steps, cancellation, pass/fail/blocked results, expected/actual observations                      | One process; bounded concurrency; no distributed job queue                                                           |
| Evidence and reports   | Registered PNG screenshots, report snapshots, CSV downloads                                                              | Product video/trace recording and PDF/XLSX are unfinished; capture can be partial; PPTX is optional                  |
| Attachments            | Project-scoped upload/list/download for supported formats                                                                | Text extraction is wired to draft generation; stored metadata remains pending; PDF/DOCX/image generation unsupported |
| AI                     | Validated draft generation, OpenAI-compatible provider and bounded tool-loop modules                                     | Generation HTTP is integrated; runtime provider, live agent composition and UI binding remain pending                |

Read [testing coverage](docs/testing-coverage.md) for step semantics, secret references and the limits of automated checks. Template execution and fixture previews must not be presented as live AI generation.

## Configuration

| Setting                                             | Purpose                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PORT`                                              | Local server and browser-test port; default `1111`                                                      |
| `STORAGE_DIR`                                       | Persistent storage root; default `../../data` relative to `apps/web`                                    |
| `VERIFLOW_MAX_CONCURRENT_RUNS`                      | Admission limit; default `2`; use `1` on the shared VPS                                                 |
| `VERIFLOW_RUN_ADAPTER`                              | `browser` by default; `fake` is explicit, labeled fixture execution                                     |
| `VERIFLOW_SECRET_<REFERENCE>`                       | Server-only values for `fillSecret` steps; values never belong in workflow JSON                         |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Server-only provider configuration; setting these alone does not enable the unfinished HTTP integration |

Health is at `/health`; standalone workflow validation is at `/api/workflows/validate`. The [HTTP contract](docs/contracts-v1.md) lists the project, template, workflow, run, attachment and report endpoints.

## Four-developer workflow

| Owner           | Responsibility                                                                          |
| --------------- | --------------------------------------------------------------------------------------- |
| Dev 1 — lead    | Shared contracts, persistence, HTTP adapters, integration, deployment and serial merges |
| Dev 2 — AI      | Generation, context extraction, template definitions and bounded model/tool decisions   |
| Dev 3 — browser | Actions, observations, assertions, browser lifecycle and evidence capture               |
| Dev 4 — product | Dashboard, workflow review, report renderers and demo target                            |

Use separate branches/checkouts and nonconflicting local ports. [AGENTS.md](AGENTS.md), [the allocation](docs/developer-handoff.md) and [REVIEW.md](REVIEW.md) define exclusive paths, acceptance criteria and the lead's merge gates. [The task board](docs/task-board.md) records delivery history and follow-ups; GitHub issues/PRs hold live task status.

## Verification

```sh
bun run lint
bun run format:check
bun run typecheck
bun run test:unit
bun run build
bun run browsers:install
bun run test:smoke
```

Browser tests start the production app, so build first and leave the selected port free. CI enables the production HTTP dashboard checks with `VERIFLOW_U1_TEST_HTTP=1` and isolated `STORAGE_DIR`. The optional live-provider test is separate; credential-free tests do not prove live AI integration.

For a shared Windows machine, set `$env:PORT = '1112'` in that checkout's PowerShell before starting the app or tests. For development reload checks, run `bun run test:dev` in another terminal against the running dev server, with the same `PORT`. It checks two tabs for 30 seconds after catalog/API requests, including unsaved form state, navigation, reload messages and runtime errors. To serve a production build locally, use `bun run start`.

## Deployment and architecture

Deploy one long-running Node.js service with persistent storage. The [architecture](docs/architecture.md) describes the core engine, adapters and lifecycle. CI tests the Linux container before publishing an immutable GHCR image. Optional VPS deployment uses `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` and related settings, health checks and rollback. See [deployment setup](docs/deployment.md) for the complete configuration.

The deployed site uses an Nginx HTTPS access gate. Application username/password sessions are planned, not implemented. Keep the gate in place until their end-to-end verification. Releases can interrupt active runs, which recover as infrastructure errors; schedule deployments between runs. Run `bun audit` when reviewing dependency changes and record current findings.
