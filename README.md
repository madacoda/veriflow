# Veriflow

A modular Next.js monolith for developing AI-powered UAT and QA automation.

## Start

Install Node.js 24 and Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:1111. Health is at /health and workflow validation at /api/workflows/validate. Copy apps/web/.env.example to apps/web/.env.local when configuring server integrations. Startup requires no AI key or browser download.

Set `PORT` in your shell to override the default for both the app and browser tests. For example, PowerShell: `$env:PORT = '2222'; bun run dev`; Bash: `PORT=2222 bun run dev`.

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

Browser tests start the production app on port 1111, which must be free. Run the build first. CI installs Chromium and its Linux dependencies. Run `bun run start` after building to serve the production monolith.

## Developer handoff

Read [architecture](docs/architecture.md), [team ownership and first tasks](docs/developer-handoff.md), and [workflow contracts](packages/core/README.md).

- apps/web owns pages, HTTP routes and server-side QA modules.
- packages/core owns workflow schemas, translation, execution orchestration and shared ports.
- packages/runner owns browser adapter development, deterministic testing fakes and integration tests.

The scaffold supplies a working validation endpoint, typed assertions, sequential orchestration, module evaluation entry points, and fakes.

The P1 platform adds persistent projects/workflow revisions, run create/status/cancel APIs, ordered timelines, immutable report snapshots and registered evidence retrieval. See [platform verification and integration status](docs/platform-p1.md), [v1 HTTP contracts](docs/contracts-v1.md) and the [team task board](docs/task-board.md). Real AI/browser adapters, product UI, attachment storage and report rendering are still separate integration tasks. Without a configured browser adapter, run creation returns 503; explicitly enabled fake runs are labeled in their records.

[P2 attachment and report delivery](docs/platform-p2.md) adds project-scoped multipart uploads, attachment metadata/content reads, a reader port for extraction, and binary report delivery through an injected renderer. Uploads remain pending until extraction is integrated. The default service still returns 503 for binary reports until the real renderer is connected.

## Deployment

Build and start one long-running Next.js service with Node.js 24 and one writer process. Configure STORAGE_DIR to a persistent volume for projects, revisions, runs and evidence. Unfinished runs recover as interrupted infrastructure errors after a process restart. A future supervised worker will need durable job coordination before separating execution from the service. The validation endpoint performs no execution or storage writes.

CI builds and tests a non-root Docker image on port 1111, including Chromium and persistent storage. Successful `main` pushes publish the tested image to `ghcr.io/madacoda/veriflow:sha-<commit>`. VPS deployment uses image digests, persistent storage and health-checked rollback. It remains disabled until the documented `VPS_*` secrets and `VPS_DEPLOY_ENABLED` variable are configured. See [GHCR and VPS setup](docs/deployment.md).

## Dependency review

The prior audit identified transitive advisories in TypeScript ESLint and ExcelJS. Review current results with `bun audit` before shipping the product.
