# Project audit — 7 November 2026

## Decision and scope

**Veriflow has a substantial deterministic QA implementation, but current main is not release-ready and the full AI-powered MVP is incomplete.** The monolith/Bun architecture and four-owner allocation remain appropriate. The main problems are an unusable browser-test gate, unfinished application composition, and semantic drift between independently developed contracts and consumers.

Audited source: [`43c3f3e5083a1dd1734442fc4810a98d27a0fa19`](https://github.com/madacoda/veriflow/commit/43c3f3e5083a1dd1734442fc4810a98d27a0fa19). Remote/CI inventory was checked on 7 November 2026 around 13:19 WIB (UTC+7). References and merge simulations below use that immutable baseline. Later commits require a fresh check.

This audit inspected application/core/runner source, tests, deployment configuration, all 18 non-default remote branches, all repository PRs, open issues, local branch/worktree state and the saved Git stash. Independent read-only reviews covered AI/contracts, UI/reports, and deployment/lifecycle. It records all material gaps found, not a proof that no other defects exist. Unpushed work on other developers' computers and changes outside this repository are not observable here.

No feature branch was merged, no stash applied/deleted, no runtime code changed, no credentials inspected, and no live provider or VPS operation performed for this audit. The last successful pipeline is evidence of a past deployment, not a fresh inspection of the live host.

Priorities: **P1** blocks the next trustworthy release or the central product journey; **P2** is required MVP completion, a correctness issue within a narrower feature, or an operational limitation; **P3** is maintainability or usability follow-through. A missing feature is identified separately from a confirmed defect.

## Verification evidence

| Check                                                             | Observed result                                                                                                                                          | What it establishes                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                   | Passed; no dependency changes                                                                                                                            | Installed dependencies agree with the committed lockfile                                                            |
| `bun run test:unit`                                               | **175 passed, 1 opt-in live test skipped**: core 9, runner 9, web 157 passed                                                                             | Current credential-free unit suites pass; this does not prove browser collection or live AI integration             |
| `bunx --no-install playwright test --list` from `packages/runner` | Failed; **0 tests collected**                                                                                                                            | Reproduced the main browser loader failure without starting a server or changing product data                       |
| Main CI at `43c3f3e`                                              | [Run 42346061721](https://github.com/madacoda/veriflow/actions/runs/42346061721): Linux fails at browser smoke; Windows passes; container/deploy skipped | Newer main has no successful container publication/deployment from this run                                         |
| Preceding main `0e2d732`                                          | [Run 42345424420](https://github.com/madacoda/veriflow/actions/runs/42345424420) failed at the same boundary                                             | The failure predates the documentation-only commit                                                                  |
| Last successful release pipeline                                  | [`1266309`, run 42344768665](https://github.com/madacoda/veriflow/actions/runs/42344768665): Linux, Windows, container and deployment succeeded          | Verified release baseline before the newer coverage implementation                                                  |
| In-memory contract probes                                         | Reproduced requirement-draft rejection, lost agent result fields, divergent continuation and false-positive liveness                                     | Fixtures demonstrate specific semantics; no model or real browser was used                                          |
| Deliberately stalled evidence fixture                             | Deadline aborted while finalization remained pending and close had not run                                                                               | Cooperative cleanup has no guaranteed completion deadline; this is not a claim that normal Chromium currently hangs |
| Non-mutating merge simulations                                    | Summary PR clean; generation branch has 11 conflicted paths; planning branch clean                                                                       | Text mergeability only; semantic conflicts are documented separately                                                |
| Working trees and markers                                         | All four local worktrees clean; no unresolved index entries or conflict markers found                                                                    | No currently unresolved checkout merge; stale branches and the saved stash still exist                              |
| `bun audit --json`                                                | Two moderate advisory entries: minimatch and uuid                                                                                                        | Current dependency advisories; application exploitability was not established                                       |

The exact browser failure is `SyntaxError: Unexpected token 'export'`, reached from `apps/web/server/templates/coverage.ts:2` while loading the core TypeScript entry. The new [browser coverage suite](../packages/runner/tests/browser-coverage.spec.ts) imports Next application modules directly at lines 9–13. Core and runner are ESM packages; web's package and the Playwright transform boundary differ. A successful Next build does not exercise this import path. Fix collection without removing or skipping the new tests, then run the entire gate on the resulting commit.

## Full-MVP alignment

“Integrated” below means wired in source; the failing current-main gate still applies.

| Requested capability                  | Current state                                                                     | Remaining acceptance                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Multiple projects                     | Integrated storage, HTTP and selection UI                                         | Retain restart/isolation tests; project scoping remains distinct from user authorization              |
| Title, URL, description and goals     | API/storage accept all fields; UI sends only title/URL                            | Add description/goals inputs; define correction of existing project context                           |
| PRD/BRD/story/screenshot context      | Upload/list/download integrated; extraction not orchestrated                      | Accurate pending/ready/failed transitions, usable extracted context and supported-format explanations |
| AI-generated scenarios/workflows      | Validated provider modules exist; application UI is a labeled fixture             | Real generation HTTP/composition and UI, with project/context provenance                              |
| Review/customize/save                 | Integrated JSON editor and optimistic revisions                                   | Preserve unsaved edits during real generation, conflicts and failures                                 |
| Playwright workflow execution         | Integrated deterministic runner                                                   | Repair browser gate; preserve lifecycle/error/evidence guarantees                                     |
| Functional UAT                        | Form, authentication and CRUD templates implemented                               | Real browser gate; representative business/role journey beyond the coupon demo                        |
| Responsive testing                    | Viewport matrix and horizontal-overflow/target-containment assertions             | Correct viewport reporting; broader visual comparison is not implemented                              |
| Basic security testing                | HTTP status and invalid-input assertions                                          | Explicit authentication prerequisites; broader SSO/multi-origin targets need reviewed policy          |
| Supplied-requirement compliance       | Requirement IDs/text/source and independent assertions implemented                | Attachment-derived coverage and agent/deterministic semantic parity                                   |
| Accessibility                         | Real axe checks, findings and incomplete-check blocking                           | Passing browser gate; manual checks still required for full accessibility conformance                 |
| Regression                            | Original saved revision can be rerun with new run/evidence IDs                    | Keep distinct from the separate template that copies supplied steps into a new draft                  |
| Real-time progress and outcomes       | Polling timeline, expected/actual, pass/fail/blocked and infrastructure lifecycle | Model execution must use the same authoritative result contract                                       |
| AI-assisted identification/navigation | Bounded observation/tool modules; reviewed steps/targets are immutable            | Compose the agent; decide explicit suggestion/review behavior for target recovery                     |
| PNG evidence                          | Real registered PNGs                                                              | Capture is partial; secret use suppresses subsequent screenshots                                      |
| Video and recorded execution          | Product WebM/trace recording absent                                               | Finalize and retrieve real run-owned recordings; Playwright test artifacts do not satisfy this        |
| AI failure summaries                  | Draft PR #18 implements a module; no application integration                      | Review/merge after gates; attach safe interpretations to reports and display them                     |
| CSV                                   | Real renderer and runtime download                                                | Correct responsive viewport attribution                                                               |
| XLSX/PDF                              | Transport/UI controls only; runtime returns 422                                   | Real independently readable files consistent with the immutable snapshot                              |
| PPTX / SQLite                         | Optional, not implemented                                                         | No need to block the required MVP on these                                                            |
| Stack/deployment                      | Next.js monolith, TypeScript, Bun, Node 24, Chromium, filesystem store, GHCR/VPS  | Readiness gate, current green CI, and documented operational limits                                   |
| Application username/password login   | Subsequent requested scope; issues #16/#17 assigned                               | Backend contract, sessions, route protection and UI; retain Nginx until verified cutover              |

The public `/demo` is a coupon target. Authentication/CRUD coverage uses the test-only server in [coverage-target.ts](../packages/runner/unit/coverage-target.ts); it is not a deployed HRIS demonstration. Do not present those fixture applications as finished customer integrations.

## Confirmed code and integration defects

### D1 — P1: browser tests cannot collect

Owners: Dev 1 for the shared package/test loading contract; Dev 3 for runner tests/configuration, with Dev 2 reviewing template access. Evidence and reproduction are above. The Linux pipeline correctly stops publication after this failure.

Acceptance: `playwright test --list` collects all suites; complete Linux browser tests and Windows checks pass; the container tests run and pass on the same updated SHA. Do not treat selecting only older suites, suppressing the failing import, or a previous branch's green run as closure.

### D2 — P2: valid requirement-only generation is rejected

[generate.ts](../apps/web/server/agent/generate.ts), lines 75–76, requires a literal `assert` for `requirements-acceptance`. The newer workflow language and compliance builder use `assertRequirement`. A schema-valid workflow containing those checks was rejected with `invalid_provider_output` by an in-memory provider probe.

Owner: Dev 2; Dev 1 reviews contract compatibility. Acceptance: a validated requirement-only draft succeeds with provenance and coverage warnings, while action-only drafts still reject. Add the missing positive regression case; the existing test covers removal of legacy assertions only.

### D3 — P2: the agent loop silently drops new result metadata

[tools.ts](../apps/web/server/agent/tools.ts), lines 97–108, copies legacy result fields but omits `findings` and `requirement`, now declared in [core ports](../packages/core/src/application/ports.ts), lines 10–11. The same fixture result retained one finding and requirement metadata through the deterministic engine; both properties disappeared through `runAgentLoop`.

Owner: Dev 2; Dev 3 reviews observation/evidence semantics. Acceptance: validate, defensively copy and preserve the new fields and their evidence references. Compare deterministic and agent outputs. This is a confirmed module defect and a future composition blocker; the production deterministic path does not currently call this loop.

### D4 — P2: execution continuation has conflicting definitions

[run-workflow.ts](../packages/core/src/application/run-workflow.ts), lines 47–52, continues after independent `assertRequirement`/`assertLayout` assertion failures. [tools.ts](../apps/web/server/agent/tools.ts), line 197, stops after every non-pass; [openai.ts](../apps/web/server/agent/openai.ts), line 255, also requires prior results to be passed.

Probe result: deterministic execution dispatched `req-1, req-2` and returned `failed, passed`; the agent dispatched only `req-1`. Changing the loop alone cannot reconcile the provider history validator.

Owners: Dev 1 freezes one policy; Dev 2 updates both consumers; Dev 3 reviews it. Acceptance: independent checks continue under both modes without erasing the failed outcome; dependent failures, blocked prerequisites and infrastructure errors stop according to the agreed policy. Update tests that currently enforce the old unconditional stop rule.

### D5 — P2: responsive CSV rows report the wrong viewport context

[csv.ts](../apps/web/server/reports/csv.ts), lines 55–57 and 139, repeats the initial run viewport or `1280x720` for every row. The responsive template later changes the browser to 1440×900, 768×1024 and 390×844. The exported `viewport` column therefore cannot identify the viewport of a later check, finding or screenshot.

Owner: Dev 4; Dev 1/3 review any observed-metadata extension. Acceptance: label the initial viewport explicitly and provide accurate per-step viewport context where required. A three-size run must export unambiguous findings/evidence. Existing CSV tests do not check this transition.

### D6 — P2: supported alternate ports break the default coupon journey

[fixtures.ts](../packages/core/src/fixtures.ts), lines 18 and 31, freezes the demo origin at `127.0.0.1:1111`. The workbench default and both fixture draft loaders reuse it unchanged. On `PORT=1112`, defaults target a closed port or a different checkout. Correcting only the project URL still leaves the loaded workflow pointing to 1111, which the origin policy blocks.

Owner: Dev 4; Dev 1 reviews runtime/fixture separation. Acceptance: runtime demo drafts use the selected project's intended demo origin without altering the frozen shared fixture. Exercise ordinary UI actions on another port without rewriting workflow JSON in the test. The existing [dashboard test](../packages/runner/tests/dashboard-workbench.spec.ts), lines 319–350, performs that rewriting and therefore does not cover the default experience.

### D7 — P2: template-load errors are swallowed

[workbench.tsx](../apps/web/features/workbench/workbench.tsx), lines 68–74, catches template fetch failures without an error state. The selector stays empty, and the revisions/runs refresh control does not retry this effect.

Owner: Dev 4. Acceptance: a catalog-specific error and retry control; test initial 503 followed by success while preserving the current draft and project isolation.

### D8 — P1: deployment health does not establish application readiness

[/health](../apps/web/app/health/route.ts) always returns 200. [platform.ts](../apps/web/server/composition/platform.ts), lines 85–94, initializes the store/configuration lazily when product routes are requested. [Dockerfile](../Dockerfile), lines 37–38, checks only `/health`; [vps-release.sh](../scripts/vps-release.sh), lines 34–36, promotes the release based on that result.

An in-memory probe returned health 200 while runtime creation rejected an invalid adapter with 503. Corrupt/unreadable storage or invalid runtime configuration can therefore leave product APIs failing while the container appears healthy. This is not a claim that the present VPS has those faults.

Owner: Dev 1. Acceptance: separate liveness from readiness; readiness validates configuration and initializes/checks usable persistent storage before promotion. Add negative container cases for invalid adapter/concurrency and unusable storage, and verify failed promotion preserves the prior healthy release.

## Remaining gaps and operating limits

| ID / priority              | Gap and evidence                                                                                                                                                                                                                                 | Owner                                                             | Closure criterion                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 / P1                    | No production AI generation route/provider composition or agent-run path. `platform.ts` wires browser and CSV; `coordinator.ts:180` calls deterministic `runWorkflow`; generation UI returns a seeded fixture.                                   | Dev 1 integration; Dev 2 provider; Dev 3 session bridge; Dev 4 UI | Real configured generation → review/edit → explicit save → exact saved revision → observed failure/evidence → target-only fix/rerun. Provider errors preserve edits and never become a pass.                         |
| G2 / P2                    | Project UI sends only title/URL, although `createProjectSchema` accepts description/goals. Existing project route is GET-only.                                                                                                                   | Dev 4; Dev 1 for an update contract                               | Nonempty description and multiple goals survive reload and reach generation; define how users correct existing context.                                                                                              |
| G3 / P2                    | Uploads remain extraction-pending. `setAttachmentExtraction` has no production orchestration caller. Text extraction exists; PDF/DOCX reject; images are references and generation rejects image context.                                        | Dev 2 extraction; Dev 1 orchestration; Dev 4 status UI            | Supported sources reach generation with identity/provenance and correct status; unsupported inputs give actionable explanations rather than permanent unexplained pending state.                                     |
| G4 / P2                    | Fifteen catalog definitions exist, but generation accepts only `functional-exact-total` and `requirements-acceptance`. Nine dashboard templates use separate parameter binding.                                                                  | Dev 1/2; Dev 4 consumer review                                    | Explicitly distinguish generation-capable options, parameter bindings and saved-revision prerequisites. Unsupported selections reject before paid calls.                                                             |
| G5 / P2                    | PR #18 is unmerged and not composed. Its bounded summary projection deliberately omits finding details and requirement metadata. Main has an optional snapshot field/CSV row but no summary producer or UI display contract.                     | Dev 2 module; Dev 1 report integration; Dev 4 display             | Merge only after gates; define approved bounded diagnostics and immutable summary enrichment. UI/export distinguish hypotheses from results; summary failure never hides the original report.                        |
| G6 / P2                    | Product runner records PNG only. No WebM recording or trace lifecycle exists. Test-run recordings are separate.                                                                                                                                  | Dev 3; Dev 1 completeness contract                                | Real finalized run-owned WebM/trace download, cancellation/error cleanup, stable ownership and safe secret handling. MP4 remains conditional; PPTX optional.                                                         |
| G7 / P2                    | `fillSecret` suppresses all subsequent screenshots. Coordinator labels every nonempty manifest partial with a generic warning.                                                                                                                   | Dev 3/1; Dev 4 labels                                             | Explain exactly which media is unavailable and why. Define safe evidence handling for authenticated journeys before claiming complete evidence; never remove secret protection merely to obtain a screenshot.        |
| G8 / P2                    | XLSX/PDF buttons and transport contracts exist, but runtime rejects both with 422. Test downloads use signature/placeholder bytes.                                                                                                               | Dev 4 renderer; Dev 1 composition                                 | Independently readable XLSX/PDF documents reconciled to the same pinned snapshot and observations; format-validation tests, not only successful byte transfer.                                                       |
| G9 / P2                    | Application login remains assigned work: [AUTH-1 #16](https://github.com/madacoda/veriflow/issues/16), [AUTH-UI #17](https://github.com/madacoda/veriflow/issues/17). Nginx is the current shared gate.                                          | Dev 1 backend; Dev 4 UI                                           | Freeze contract, enforce sessions on every protected boundary, verify login/logout/expiry/error cases, retain Nginx until separately verified cutover.                                                               |
| G10 / P2                   | Agent call budget is at most 100 observe/execute calls; workflows allow 1,000 steps, and a 100-requirement template produces 101 steps. Aggregate context can exceed the provider's 200,000-character payload limit before useful error mapping. | Dev 1/2                                                           | Preflight agent-mode workflows and assembled context before target mutation or paid calls. Keep safe bounds and return clear input errors. This is pending integration admission, not a current production incident. |
| G11 / P2                   | Evidence/close awaits have no bounded finalization escalation. A deliberately stalled adapter remains pending after abort; capacity stays reserved.                                                                                              | Dev 1/3                                                           | Test non-settling evidence and close, define bounded escalation/resource ownership, and avoid reporting clean success/cancellation when cleanup is incomplete.                                                       |
| G12 / P2                   | Every export download writes a new UUID-named persistent file for the same snapshot/format; no reuse/cleanup path exists (`report-downloads.ts:44`).                                                                                             | Dev 1                                                             | Stream without persistence or reuse immutable objects with retention; repeated identical downloads must not grow storage indefinitely.                                                                               |
| G13 / P2 operating limit   | Store transactions are serialized only within one process. A second writer can overwrite state or recover another process's active jobs as interrupted. Current one-container configuration respects the supported model.                        | Dev 1                                                             | Keep one writer/replica. Add exclusive ownership or transactional storage before supporting more; test second-writer refusal or correct concurrency.                                                                 |
| G14 / P2 operating limit   | Releases replace the container with no admission pause/drain. Rollback restores image/Compose, but reuses current shared runtime env files and data.                                                                                             | Dev 1                                                             | Continue releasing between runs; define drain/shutdown before promising uninterrupted deployment. Document and verify environment/data recovery separately.                                                          |
| G15 / P2 operating limit   | Projects allow one supplied origin; other origins, frames/popups and WebSockets are blocked. CDN/SSO/embedded targets can fail prerequisites.                                                                                                    | Dev 1/3                                                           | Document supported targets. Any additional-origin/resource policy needs explicit authorization and tests for redirects, frames, popups and denied destinations.                                                      |
| G16 / P2 security boundary | Project scoping is not tenant authorization. Allowed origins are not an IP/network sandbox; loopback is intentional. Runtime secret names are global, not project-bound.                                                                         | Dev 1/3                                                           | Keep trusted operators only. Before broader access, define identity/project authorization, network destinations and project-scoped secret binding. Do not advertise existing ID isolation as tenant security.        |
| G17 / P2 operating limit   | No repository-managed off-host backup, restore rehearsal or retention implementation/verification was found; live host backup configuration was not inspected. Container restart persistence does not establish backup recovery.                 | Dev 1                                                             | Restore projects, attachments, pinned reports and evidence into an isolated deployment; record retention/capacity and recovery procedures.                                                                           |
| G18 / P2                   | Two current transitive dependency advisories; details below.                                                                                                                                                                                     | Dev 1; Dev 4 for ExcelJS ownership                                | Assess affected call paths; resolve supported dependency versions or record a justified bounded mitigation, then rerun audit and gates.                                                                              |
| G19 / P3                   | Template parameters are raw JSON; invalid-input response refers to a schema the UI does not display.                                                                                                                                             | Dev 4; Dev 1 error envelope                                       | Show relevant field/schema guidance and preserve entered parameters on errors.                                                                                                                                       |
| G20 / P3                   | Active server contexts do not have the same import-boundary enforcement as the legacy QA modules. ESLint mainly protects core and inactive module layers.                                                                                        | Dev 1                                                             | Add rules for actual ownership/dependency boundaries without blocking intended ports/composition. Review cross-package tests explicitly.                                                                             |
| G21 / P3                   | CI has no artifact-upload step for Playwright failures and no dependency-audit gate. Node runtime is 24 while root Node typings are 26.                                                                                                          | Dev 1                                                             | Preserve failed-test evidence, decide dependency policy, and align runtime typings or document/test supported API assumptions. No Node-typing runtime defect was reproduced.                                         |

AI-assisted target recovery is also unfinished: the current provider validates each executed step against the exact reviewed workflow. That protects approval semantics but does not autonomously repair selectors. Define suggestions as reviewable changes before adding adaptive behavior. The six-category template surface does not by itself close that requirement.

## Unmerged work and actual conflicts

### Active and unpublished work

| Branch / head                                  | Repository state                                                                         | Relationship to audited main                                                                                                                            | Required disposition                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codex/observed-failure-summaries` / `9ba9f4b` | [PR #18](https://github.com/madacoda/veriflow/pull/18), **draft**, Dev 2 (`monsieurafa`) | Text merge is clean; main has 1 exclusive commit, branch 3. GitHub says mergeable but checks are failing/unstable; both latest push/PR Linux runs fail. | Keep draft until shared gate passes. Update to current main, affected-consumer review, rerun exact-head checks, then lead serial merge. Clean text merge does not deliver report/UI integration. |
| `codex/i1-generation-http` / `9737249`         | Remote implementation branch, **no PR**                                                  | Main has 13 exclusive commits, branch 11; old A1/I1 commits overlap work already squash-integrated. Dry merge has **11 conflicted files**.              | Port the narrow HTTP/context orchestration from tip commit onto current main; do not merge all historical copies wholesale. It still needs a real production provider.                           |
| `codex/dev4-planning` / `8699020`              | No PR; one historical planning document                                                  | Clean text merge; main has 7 exclusive commits, branch 1.                                                                                               | Reconcile useful planning notes with the authoritative handoff; this is not missing product code.                                                                                                |
| `codex/ghcr-vps-port-1111` / `33423af`         | Duplicate [PR #7](https://github.com/madacoda/veriflow/pull/7), closed without merge     | Superseded by reviewed deployment PR #8 and follow-ups                                                                                                  | Do not reopen or merge the old draft into current main. Preserve until owner-approved cleanup.                                                                                                   |

“Exclusive commits” are ancestry counts, not missing feature counts. Squash merges leave branch commits outside main ancestry even when their behavior was integrated. Counting every `git branch --no-merged` entry as unfinished work would be incorrect.

### Generation branch: 11 textual conflicts

`git merge-tree --write-tree --name-only origin/main origin/codex/i1-generation-http` returned conflicts in:

1. `apps/web/next.config.ts`
2. `apps/web/package.json`
3. `apps/web/server/agent/README.md`
4. `apps/web/server/agent/generate.ts`
5. `apps/web/server/agent/index.ts`
6. `apps/web/server/composition/platform.ts`
7. `apps/web/server/templates/catalog.ts`
8. `apps/web/tests/templates-catalog.test.ts`
9. `docs/contracts-v1.md`
10. `docs/task-board.md`
11. `packages/runner/tests/platform-integration.spec.ts`

There is an additional **semantic conflict in a file Git auto-merges**: the old branch adds `templatesGET()` for a global catalog, while main has `templatesGET(projectId)` for project-aware executable defaults. Inspection of the simulated merge tree shows both implementations in `composition/http.ts`. Resolve distinct API names/routes explicitly; text merge success is not API compatibility.

The tip commit `9737249` itself changes 11 files, adding generation/catalog routes, a draft service, HTTP handling and tests. Its ancestors account for much of the larger apparent branch diff. Port the useful tip behavior, retaining current origin checks, template capabilities, CSV composition, secret resolution and provider validation. Its production runtime does not inject `draftProvider`; merging the branch alone would still leave generation unavailable.

### Historical branches already delivered

These remote branches map to merged PRs. Their old heads are review history, not an instruction to merge them again.

| Branch                             | Merged PR | Resulting main commit |
| ---------------------------------- | --------- | --------------------- |
| `codex/l0-platform-contracts`      | #1        | `3c432f1`             |
| `codex/p1-platform`                | #2        | `aec5515`             |
| `codex/p2-attachments-reports`     | #3        | `84327a7`             |
| `codex/b1-browser-session`         | #4        | `39bd03d`             |
| `codex/a1-agent-tools`             | #5        | `8d11c70`             |
| `codex/p3-integration-guardrails`  | #6        | `eb02beb`             |
| `codex/ghcr-vps-1111-pr`           | #8        | `8df3fef`             |
| `codex/u1-project-workbench`       | #9        | `a5047f6`             |
| `codex/i1-browser-composition`     | #10       | `53d4b34`             |
| `codex/dev4-attachments-csv`       | #11       | `d8701bc`             |
| `codex/a2-openai-provider`         | #12       | `3ac293b`             |
| `codex/veriflow-nginx-deployment`  | #13       | `367fb32`             |
| `codex/dev4-draft-and-report-ui`   | #14       | `6d1dab7`             |
| `codex/versioned-template-catalog` | #15       | `1266309`             |

### Local checkout and stash inventory

| Checkout                                              | State at audit                                                                | Action before further implementation                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `C:/Users/PSM/.codex/worktrees/dev3-browser/veriflow` | Clean, `docs/current-project-state`, at audited main                          | Sole editing checkout for this documentation audit                               |
| `C:/www/veriflow`                                     | Clean, `feat/browser-session-adapter`, head `6a6d55a`, 24 main commits behind | Start a fresh task from current main; do not implement against this old scaffold |
| `C:/Users/PSM/.codex/worktrees/ghcr-deploy/veriflow`  | Clean, old duplicate deployment branch `33423af`                              | Historical checkout; coordinate reuse/cleanup with its owner                     |
| `C:/Users/PSM/.codex/worktrees/ghcr-vps-pr/veriflow`  | Clean, merged deployment head `57e193a`                                       | Historical review checkout; update baseline before new work                      |

The local `main` branch also remains at `6a6d55a`; `origin/main` is authoritative for this audit. Other local review branch heads are reachable from fetched remote history. A saved stash remains: `stash@{0}` / `6d1748b`, “GHCR and port 1111 draft before B1 review fix”, touching 19 deployment/configuration/test/doc paths. It was preserved, not applied or assumed to be needed. Reconcile it against delivered #8/#13 before any owner-approved deletion; blindly applying it would reintroduce obsolete configuration.

## Governance and documentation alignment

GitHub reports `main.protected=false`, required-status-check enforcement `off`, and repository rulesets `[]`. The lead-only, reviewed, serial merge process in [REVIEW.md](../REVIEW.md) is therefore a team rule, not an enforced repository constraint. The user's earlier direct documentation push was authorized; it does not establish branch protection.

The coverage changes arrived through `2e6930f` and merge commit `c69bd6d`; the associated-PR lookup for these commits and `0e2d732` returned no PRs. This is an evidence gap in the intended consumer-review/serial-merge record. Their runtime changes crossed core, browser, templates, UI, reports and deployment paths. Require affected owners to review those boundaries while resolving D1–D8; do not infer approval merely from the presence of the code on main.

The task board identifies Dev 1 `madacoda`, Dev 2 `monsieurafa`, and Dev 4 `Hyuto`. Dev 3's distinct GitHub reviewer handle is still unrecorded; PR #18 explicitly requests this routing. The lead must record the actual handle or the explicit dual-role assignment, rather than invent a CODEOWNERS entry.

Documentation corrections accompanying this audit:

- The current README must not imply description/goals are available in the project form; they are API fields awaiting UI binding.
- Current status links to this detailed gap/conflict record and to the latest failed main run.
- Browser handoff notes distinguish original B1 acceptance from newer axe/security/layout implementation and secret-suppressed screenshots.
- Workbench/report notes state CSV is composed, XLSX/PDF are not, and fixed demo origins need manual adjustment today.
- Deployment rollback wording distinguishes image/Compose restoration from shared runtime environment and data recovery.
- The seven-hour timetable remains a planning target, not a completed milestone or a promise that the full MVP fits the remaining time.

## Dependency findings

`bun audit --json` returned two moderate advisory entries. `bun why` established these installed paths:

| Package            | Installed dependency path                         | Advisory and follow-up                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimatch@10.2.6` | TypeScript ESLint → typescript-estree → minimatch | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): pattern amplification. The advisory lists 11.0.1 as patched; assess a supported parent upgrade instead of forcing an incompatible transitive major.   |
| `uuid@8.3.2`       | runner → ExcelJS 4.4.0 → uuid                     | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq): bounds handling in specific UUID APIs with caller-supplied buffers. Audit the actual call path; the report feature currently does not implement XLSX. |

These are dependency findings, not evidence of exploitation or proof that an HTTP request reaches the vulnerable methods. ExcelJS is currently a runner dependency even though report rendering belongs to Dev 4's server report module; reconcile ownership and actual use in the dependency follow-up. Do not hide the findings by suppressing audit output or claim a clean dependency gate.

## Four-developer execution plan

These are proposed next task boundaries for lead dispatch, not a claim that implementation has started. Each task still needs the exact current base SHA, a working branch, reviewer and verification evidence in its issue/PR. One editing session per checkout; one active task per owned file. The lead retains integration/review capacity.

| Lane            | First task and exclusive edit scope                                                                                                                                                                                                             | Dependencies / reviewer                                                                                                                                                                                                      | Acceptance and next task                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev 1 — lead    | `L1`: freeze the browser-loading and agent/result contracts; own shared configuration, core contract changes and release gates. Coordinate GitHub protection setup and review routing.                                                          | Dev 3 reviews runner-loading effects; Dev 2 reviews agent semantics; Dev 4 reviews consumed fields. Dev 1 retains `platform-integration.spec.ts`; Dev 3 owns runner config and `browser-*` tests, Dev 4 `dashboard-*` tests. | D1 green on exact main, D8 readiness before promotion, agreed D3/D4 semantics and named reviewer. Then port G1's narrow generation service/routes from `9737249`, preserving current composition. |
| Dev 2 — AI      | `A3`: fix D2/D3/D4 in `apps/web/server/agent/**`; reconcile catalog/context preflight in owned `server/templates/**`, `server/context/**` and `agent-*`, `templates-*`, `context-*` test files. Update PR #18 serially in the owner's checkout. | Shared continuation/result contract from L1; Dev 3 reviewer. Do not edit HTTP/storage/browser files.                                                                                                                         | Passing positive/negative requirement drafts and execution parity probes, bounded provider/context preflight. Summary module review can proceed independently; merge waits for current gates.     |
| Dev 3 — browser | `B2`: repair `packages/runner/tests/browser-*`, owned fixture/unit files and `playwright.config.ts` at the import boundary agreed with L1; review A3 observation/evidence semantics.                                                            | Dev 1 reviews lifecycle/package effects. Dev 3 owns runner config and `browser-*` tests; dashboard and platform integration tests remain with Dev 4 and Dev 1 respectively.                                                  | All browser suites collect and run without omissions. Then implement G6/G7 recording/completeness and G11 bounded finalization against reviewed core contracts.                                   |
| Dev 4 — product | `U2`: project context fields, template-load error/retry, dynamic runtime demo origin, and D5 CSV viewport clarity in UI/report-owned files, `reports-*` unit tests and `dashboard-*` browser tests.                                             | Existing create-project contract supports initial context; any update/metadata contract belongs to Dev 1. Dev 1 reviews integration; Dev 3 reviews viewport meaning.                                                         | Real HTTP create/reload/context assertions; alternate-port UI journey without rewriting fixtures; responsive CSV parity. Then XLSX/PDF renderers and AUTH-UI after its backend contract freezes.  |

Independent work can continue while the release gate is repaired: Dev 2 uses explicit provider/tool fixtures, Dev 4 tests pure UI/renderers, and Dev 3 tests the owned adapter boundary. Do not make all four developers wait for one lead PR, and do not bypass the failing gate to merge unfinished integrations.

Release sequencing: resolve D8 readiness in the first verified release update, or have Dev 1 explicitly hold VPS deployment until it lands. Repairing D1 alone can resume automatic main publication/deployment; a written release hold is not a configuration change, and no hold was applied by this audit.

Suggested integration order: shared loader/contracts and readiness gate → agent semantic fixes and independent UI fixes → narrow generation HTTP/provider/context composition → reviewed summary module and report integration → required recordings/exports → authenticated product journey and final release verification. AUTH-1 remains Dev 1-owned; AUTH-UI can bind only after its contract is frozen. If the event cutoff arrives before the AI journey works, focus all owners on that smallest complete journey and label all remaining capabilities honestly.

## Closure and release criteria

Before calling the project aligned and ready, record evidence for all of the following:

1. Current main passes Linux/Windows/unit/browser/container checks, including the new coverage suites. Keep the known-pass and known-fail outcomes and registered evidence on the exact SHA.
2. Generation uses actual project description/goals and supported attachment context; a real provider returns a draft that remains editable until explicit save. Fixture UI cannot satisfy this gate.
3. Deterministic and agent modes agree on result fields, independent-check continuation, errors and finalization. Models never set the authoritative outcome.
4. One reviewed revision executes against the intended target, yields an observed failure and evidence, then passes after a target-only fix with new run/evidence identities. The old report remains unchanged.
5. Required recordings and export formats are real artifacts tied to the same snapshot, with accurate viewport/capture labels and safe secret handling.
6. Each pending branch has an explicit disposition; the generation service is ported with semantic reconciliation, PR #18 has current checks and affected review, and historical branches/stash are preserved or cleaned only by their owners.
7. Release readiness checks product configuration/storage, not just HTTP liveness. Runtime environment/data recovery, one-writer operation and release-between-runs limits remain explicit.
8. AUTH-1/AUTH-UI verify actual login, logout, expiry and direct protected API/attachment/evidence/report access, including rejection without a session. Keep Nginx until the separately verified cutover.
9. Task board, reviewer handles, GitHub enforcement and documentation agree with the implemented workflow. Remaining gaps are tracked with owners and evidence rather than described as complete.

The audit document aligns the evidence and work plan. It does not repair the runtime defects or close the implementation gaps listed above.
