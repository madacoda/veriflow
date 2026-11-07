# Veriflow

Initial workspace for an AI-powered UAT and QA automation platform.

## Requirements

- Node.js 24 and npm
- Chromium installed through Playwright

## Getting started

```sh
npm ci
npm run browsers:install
```

Copy `apps/api/.env.example` to `apps/api/.env`, then run `npm run dev`.
The frontend runs at http://localhost:3000 and the API health endpoint at http://127.0.0.1:4000/health.
API environment variables load from `apps/api/.env`. AI credentials are server-only and are optional for startup. Set the provider URL and model when implementing generation.

## Workspace ownership

Suggested areas for four developers, adjustable by the team.

| Developer | Area                                     | Location                                |
| --------- | ---------------------------------------- | --------------------------------------- |
| 1         | Frontend and workflow editor             | `apps/web`                              |
| 2         | Project API, attachments and persistence | `apps/api`                              |
| 3         | Browser execution and accessibility      | `packages/runner`                       |
| 4         | AI integration, exports and evidence     | API and runner, coordinated with owners |

Next.js App Router powers the frontend. Fastify provides the Node.js API. The runner includes Playwright, axe-core integration and ExcelJS. The API includes the OpenAI SDK for later provider integration. Runtime files belong in the ignored `data` directory. SQLite can be added when persistence contracts are agreed.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
npm run test:smoke
npm run format:check
```

`npm run format` formats the workspace. The browser smoke test uses a local intercepted page and checks browser startup plus axe integration. Playwright retains traces, screenshots and WebM video on failure. Open reports with `npm exec -w @veriflow/runner -- playwright show-report`.

## Development scope

This scaffold supplies a placeholder homepage, API health endpoint, storage directory setup and tooling verification. Product development includes project management and attachments, AI workflow generation and editing, execution orchestration, QA templates, result comparison, evidence management and CSV/XLSX/PDF exports. PPTX and SQLite are optional. MP4 requires a later conversion choice.

## Collaboration

Branch from `main` using `feat/short-description` or `fix/short-description`. Submit pull requests with verification results and request a teammate review. Coordinate API shapes before implementing consumers. Commit dependency lockfile changes with their package manifests. Each developer keeps credentials in their own ignored environment files.

CI runs formatting, lint, type checks, builds and the browser smoke test. Repository administrators should configure main-branch protection with the `check` job and one approving review when enabling the team's workflow.

## Dependency review

The initial npm audit reports moderate transitive advisories in minimatch through TypeScript ESLint and uuid through ExcelJS. Compatible `npm audit fix` does not resolve these. Review upstream updates before implementing reporting or exposing the application. The suggested forced fixes downgrade major tooling dependencies and require separate validation.
