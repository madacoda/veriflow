# Generation HTTP integration

Reviewed source: `codex/i1-generation-http` at `9737249`, reviewed against main `0e2d732` and rebased onto its documentation update `43c3f3e`. The branch supplies missing HTTP composition, while main already contains newer OpenAI adapters, template prerequisites, six-category execution, CSV exports and deployment configuration. Those main implementations are preserved.

## Behavior and acceptance

- POST `/api/projects/:projectId/workflows/generate` validates the request, reads only that project's registered attachments and returns `{ draft }`. It never saves a workflow, starts a run or modifies extraction metadata.
- One deadline covers project/input reads, attachment context and generation. Abort and timeout settle even if an injected provider ignores cancellation; oversized streams return 413 without waiting for source cancellation.
- Provider diagnostics and abort reasons stay private. Public errors use canonical fixed messages. Missing production provider configuration returns 503, including in explicit fake run mode.
- GET `/api/templates` returns all 15 versioned definitions. The existing project GET/POST `.../templates` still provides nine executable templates and parameter-bound drafts. Distinct handler names prevent the two catalog contracts from overriding one another.
- Main's generation prerequisites, permitted-origin checks (including `assertHttp`), OpenAI exports, secret resolver, CSV renderer, port 1111 and refresh-loop fix are retained. Saved workflows whose ID is `generate` remain readable through GET with a revision.

## Verification

The required gate covers frozen installation, lint, formatting, type checks, unit tests, production build, Chromium installation and the complete Playwright suite. Dedicated generation tests use clearly labeled injected fixture providers, including project isolation, invalid sources, prerequisites, foreign HTTP assertions, cancellation and stalled request bodies. Built-route tests cover both catalogs, unavailable generation, forbidden provider overrides and the saved-workflow ID collision. Existing Chromium tests verify real browser fail/pass outcomes, evidence, six testing categories and the UI.

Local integration gate: frozen install, lint, formatting, types and production build passed; 186 unit tests passed with one opt-in live OpenAI test skipped; all 49 Chromium tests passed. `bun run test:dev` also passed with no reloads or runtime errors and form state retained for ten seconds. The browser regression test explicitly loads ESM fixtures before the web package to support Playwright’s mixed module loader. These are local results, not a claim of new remote CI or deployment.

## Runtime configuration

`createRuntimePlatform` resolves `OPENAI_API_KEY`, `OPENAI_MODEL` and optional `OPENAI_BASE_URL` from trusted server environment settings when each draft request starts. It uses the existing OpenAI adapter; no default model or fixture fallback is selected. Keep configuration in ignored `apps/web/.env.local` or `apps/web/.env`, and restart the server after editing these files so Next.js reloads them. The resolver avoids retaining old provider configuration inside the platform singleton, without replacing active run coordination.

Missing or malformed settings return the canonical generation-only 503; project, workflow and run APIs remain usable. An upstream failure still returns the existing fixed public error without credentials or provider diagnostics. Context, deadlines, allowed origins, output validation and explicit review/save behavior are unchanged.

The default unit/browser suites explicitly disable inherited model credentials; the runtime regression uses a labeled local OpenAI-compatible HTTP fixture through the real SDK and built Next.js routes. Live verification is separate and must be identified as such.

## Remaining work

PDF/DOCX extraction, image generation and the bounded AI-session bridge remain separate work. Draft generation does not run browser tests or save a workflow; the user reviews and saves it before execution.
