# Veriflow

A modular Next.js monolith for developing AI-powered UAT and QA automation.

## Start

Install Node.js 24 and Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000. Health is at /health and workflow validation at /api/workflows/validate. Copy apps/web/.env.example to apps/web/.env.local when configuring server integrations. Startup requires no AI key or browser download.

Workspace packages export TypeScript source. Next.js transpiles core directly and tests use tsx, so a fresh checkout needs no preliminary package build or background compiler.

## Verify

```sh
bun run lint
bun run format:check
bun run typecheck
bun run test:unit
bun run build
bun run browsers:install
bun run test:smoke
```

Browser tests start the production app on port 3000, which must be free. Run the build first. CI installs Chromium and its Linux dependencies. Run `bun run start` after building to serve the production monolith.

## Developer handoff

Read [architecture](docs/architecture.md), [team ownership and first tasks](docs/developer-handoff.md), and [workflow contracts](packages/core/README.md).

- apps/web owns pages, HTTP routes and server-side QA modules.
- packages/core owns workflow schemas, translation, execution orchestration and shared ports.
- packages/runner owns browser adapter development, deterministic testing fakes and integration tests.

The scaffold supplies a working validation endpoint, typed assertions, sequential orchestration, module evaluation entry points, and fakes. Product UI, real browser execution adapters, authentication, AI generation, persistence and exports are assigned development work.

## Deployment

Build and start one long-running Next.js service with Node.js 24. Use persistent storage for later project/evidence adapters. Workflow execution should eventually use a supervised worker with job tracking, sharing the repository and release. The validation endpoint performs no execution or storage writes. Deployment hosting and CD remain unconfigured.

## Dependency review

The prior audit identified transitive advisories in TypeScript ESLint and ExcelJS. Review current results with `bun audit` before shipping the product.
