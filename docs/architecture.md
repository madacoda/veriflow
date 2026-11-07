# Modular monolith

Next.js serves UI and HTTP endpoints in one application. The former Fastify app has been consolidated into apps/web.

```text
apps/web/app             pages and thin HTTP route handlers
apps/web/features        feature UI
apps/web/server/modules  functionality, security, accessibility
packages/core            workflow language, translation, execution ports
packages/runner          future browser adapter and current testing fakes
```

## Dependencies

HTTP adapters validate incoming data and call application functions. Module application code depends on local domain types and the core public contract. Infrastructure implements ports. Domain code owns business invariants. The core must remain independent of Next.js, Playwright and feature modules. Static imports are checked by ESLint; runtime imports and semantic coupling need review.

Each QA module exports createEvaluation through its index.ts. Supply a QaEvaluator implementation via dependency injection. The evaluator receives run identity, step results and evidence and returns shared Evaluation/Finding DTOs. Its initial tests use FakeEvaluator. No fake is wired into production HTTP routes.

The core workflow schema is the single source of step definitions. Translation produces ordered commands. runWorkflow accepts a SessionFactory, opens one session per run, executes sequentially and closes in finally. Adapter failures fail the current step and block the rest. Cancellation blocks remaining work. Startup, evidence collection or cleanup failures reject the run so the future job owner can persist an infrastructure failure.

Session adapters must honor cancellation and timeout signals and release partial allocations if opening fails. The engine cannot forcibly terminate an uncooperative adapter. Browser-process supervision is part of the engine developer's production adapter acceptance criteria.

## Package development

Core exports TypeScript source through its public package entry. Next.js transpiles it and tsx runs unit tests. Runner declares a workspace dependency on core. Web declares core and a development-only dependency on runner for fixtures. All consumers resolve fresh source, avoiding stale dist files and build-order races. Declaration/build checks still run for core.

The monolith build is the deployable artifact. These private packages are not published JavaScript libraries. A future standalone Node worker will need a bundle or a compiled package export strategy.

## SOLID and DDD

Keep entities and value objects around real invariants. Use small ports for session allocation, step execution and QA evaluation. Treat the three QA modules as bounded-context candidates that can evolve with domain knowledge. Keep shared workflow semantics in core, and category-specific checks in their module. Platform authentication is distinct from evaluating a target application's security.

A new step requires schema, exhaustive translation, adapter behavior and tests in the same contract change. Existing schemaVersion 1 documents remain valid. Added assert steps support exact text, visibility and checked-state expectations.

See [developer handoff](developer-handoff.md) for ownership and acceptance criteria.
