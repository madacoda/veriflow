# Modular architecture

Veriflow starts as a modular monolith. Functionality, security and accessibility are initial bounded-context candidates with separate vocabulary and ownership. Refine their boundaries as real use cases emerge. Each module owns its business rules and persistence contracts.

`packages/core` owns all workflow definitions, step codes, validation and translation. See its [workflow contract](../packages/core/README.md). Feature modules depend on the core public API. The core is independent of feature modules, HTTP servers and browser libraries. `packages/runner` will implement the core execution port with Playwright. Project adapters will store workflow instances using this common contract.

## Dependency direction

```text
Next.js routes -> feature UI -> HTTP
API composition root -> module public entry point
presentation -> application -> domain
infrastructure -> application ports + domain
QA modules -> core workflow contract -> execution plan
runner adapter -> core execution port
```

`apps/api/src/app.ts` composes the HTTP server. `index.ts` owns process startup, storage initialization and shutdown. `platform` holds platform HTTP concerns. Importing `createApp` allows isolated HTTP tests without opening a port.

Each module under `apps/api/src/modules` has four layers.

| Layer          | Responsibility                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| domain         | Entities, value objects, invariants and policies using the module's vocabulary |
| application    | Use cases and small interfaces for external capabilities                       |
| infrastructure | Implementations of those interfaces using storage, OpenAI, Playwright or axe   |
| presentation   | Request validation, HTTP mapping and response DTOs                             |

Create each module's `index.ts` when its first capability is implemented. Export only the module registration function and explicitly reviewed public contracts. The composition root supplies concrete dependencies. Cross-module orchestration belongs in application services with injected ports. Keep imports of another module's implementation private. Avoid a generic shared entity or repository abstraction until there is a demonstrated common requirement.

`apps/web/features/{functionality,security,accessibility}` owns feature-specific UI and HTTP adapters. The Next.js `app` directory composes pages and layouts. Server implementation types must stay out of browser imports.

`packages/runner` owns browser tooling and its smoke test. Future reusable Playwright adapters belong there, while each QA module owns its evaluation policies. Platform authentication and permissions belong to platform work. The security module evaluates security scenarios on target applications.

## SOLID in implementation

- Give each use case one business operation and each adapter one external capability.
- Extend behavior through injected policy or execution ports when a second implementation is needed.
- Require adapters to honor the same success, failure and cancellation semantics. Verify these with contract tests.
- Define narrow ports around actual use-case needs, such as executing a scenario or saving evidence.
- Have application code depend on these ports. Instantiate concrete SDKs in infrastructure and wire them at the composition root.

Prefer functions and plain TypeScript interfaces where sufficient. Add entities and value objects when they enforce actual invariants. The initial module directories are intentionally ready for feature implementation.

## Four-developer workflow

| Branch               | Primary ownership                                                                      |
| -------------------- | -------------------------------------------------------------------------------------- |
| `feat/functionality` | Functionality API module and frontend feature                                          |
| `feat/security`      | Security QA API module and frontend feature                                            |
| `feat/accessibility` | Accessibility API module and frontend feature                                          |
| `feat/platform`      | Composition, project management, execution tooling, AI, reporting and shared contracts |

Start each branch from the latest `main` using `git switch -c feat/functionality` or the relevant branch name. Push with `git push -u origin HEAD`. Open pull requests into `main`, merge reviewed changes, and regularly incorporate `origin/main`. For later tasks use names such as `feat/security-input-validation` rather than keeping permanent feature branches.

Agree request/response DTOs and port semantics in a small contract PR before parallel implementation. Keep changes within the owned module where possible. Coordinate edits to `app.ts`, root manifests, `bun.lock`, CI and runner configuration with the platform developer. Regenerate the lockfile with Bun after resolving manifest conflicts.

## Verification

Run `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build` and `bun run test:smoke` before a PR. ESLint rejects direct framework imports in domain/application layers, outward layer imports and sibling-module implementation imports. These static-import checks complement review; runtime imports and semantic coupling still need review. Add use-case tests with fake ports, adapter contract tests and HTTP tests as modules gain behavior.
