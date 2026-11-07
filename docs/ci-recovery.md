# CI/CD browser and accessibility recovery

Recovery work is tracked in [PR #19](https://github.com/madacoda/veriflow/pull/19). The earlier [project audit](project-audit.md) remains a snapshot of main `43c3f3e`; this document records the browser-gate diagnosis and fix, not completion of the other MVP gaps.

## Why the runs kept failing

The main runs for `0e2d732`, `43c3f3e` and `ce23b79` failed at `bun run test:smoke`. The first two documentation updates changed no runtime behavior, so triggering another pipeline repeated the same failure. Windows unit checks passed because they use a different source-loading path.

1. `browser-coverage.spec.ts` imported Next application source directly into the ESM Playwright runner. The web package's CommonJS loading boundary then reached the core TypeScript entry and raised `SyntaxError: Unexpected token 'export'`. The suite collected zero tests. Type checks and a successful Next build did not exercise this path.
2. After replacing those imports with built HTTP calls, all 48 tests collected. A real production accessibility run then failed: bundling `axe-core` changed the function body that `axe.source` serializes for injection into the target browser. The injected script referenced a bundler closure variable (`ReferenceError: t is not defined`), so the run ended as an infrastructure error rather than an observed accessibility result.

The second failure was hidden behind the first. Direct adapter tests used the original installed axe source and could pass while the built application failed.

`container` depends on both `check` and `windows-unit`; `deploy` depends on `container`. A failing browser gate therefore **skips** image publication and deployment. These runs do not show a GHCR login or VPS-secret failure, because those jobs never reached their deployment steps. See the [failed main run](https://github.com/madacoda/veriflow/actions/runs/42346911001).

## Changes

- Browser coverage obtains templates and persistent runs/reports through an isolated built Next server, using public HTTP routes. It retains all cases and origin-policy assertions, with bounded startup and idempotent owned-process cleanup.
- Next's `serverExternalPackages` includes `axe-core`, preserving the original self-serialized source. This is the framework's supported mechanism for loading a package without server bundling: [Next.js documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).
- Container smoke creates an explicit local accessibility fixture, runs the real template through HTTP, requires an `image-alt` assertion finding and its registered PNG, then verifies the persisted report/evidence after container restart. Merely importing axe inside a container would not exercise the application bundling boundary.

No browser test is skipped to make the gate pass. The code does not require a custom `NODE_OPTIONS` loader workaround or relax target-origin restrictions.

## Verification record

On the integrated local candidate:

- Frozen Bun install, lint, formatting, type checks and production build passed.
- Unit tests: **175 passed**, with **one explicitly opt-in live-provider test skipped**.
- Before axe externalization, the focused built regression/accessibility case reproduced lifecycle `error` where `completed` was expected.
- After rebuilding with externalization, the complete browser suite passed: **48 passed, zero skipped**, using real HTTP checks, isolated storage, port 3311 and four workers.
- The new container HTTP smoke's `run` and `verify` modes also passed against an isolated local production build, including real axe findings and PNG reads. This local invocation did not perform a Docker restart; Linux container CI exercises that packaging/restart boundary.
- Deployment release/transport tests passed through Git Bash using their explicit fake Docker/SSH adapters; these checks do not contact the VPS.

Docker and ShellCheck are unavailable locally; Git Bash was invoked by its installed path. The authoritative Linux/container checks run in the PR/main pipeline. Require those checks on the final PR head before merging, then verify the resulting main run and deployment. Passing local tests alone does not establish that the standalone image contains the external dependency.

## Reproducing the merge gate

```sh
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test:unit
bun run build
bun run browsers:install
bun run test:smoke
```

Use an unused `PORT`, a fresh temporary `STORAGE_DIR`, `VERIFLOW_U1_TEST_HTTP=1` and `VERIFLOW_RUN_ADAPTER=browser` for complete local HTTP coverage. From `packages/runner`, `bunx --no-install playwright test --list` is a quick collection check, not a replacement for executing the suite. The [Playwright TypeScript guide](https://playwright.dev/docs/test-typescript) explains that its transform and type-checking are separate concerns.

On Linux, also run the existing deployment-script checks and `scripts/container-smoke.sh` against the built image. The final release evidence belongs to the exact [PR checks](https://github.com/madacoda/veriflow/pull/19/checks) and [resulting main Actions run](https://github.com/madacoda/veriflow/actions), not an earlier implementation commit.

The audit's separate readiness, AI integration, recording, export and authentication work remains open. This repair addresses the two observed CI failures and adds a regression check for the packaged accessibility runtime.
