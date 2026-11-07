# Team review and orchestration

## Authority and scope

Dev 1 is the single lead orchestrator and integration owner. The team has four developers total, including Dev 1. The lead assigns tasks, controls shared contracts, orders PRs, resolves integration conflicts with authors, merges into main and owns release verification.

This guide governs collaboration. [developer-handoff.md](docs/developer-handoff.md) defines ownership, full-MVP scope and the original event time gates. [project-status.md](docs/project-status.md) distinguishes integrated features, remaining work and verified release evidence. Passing fixture tests alone does not establish the live autonomous journey.

## Parallel ownership and task queue

The authoritative ownership matrix, contract gate and task dependency graph are in [developer-handoff.md](docs/developer-handoff.md). Dev 1 owns platform/integration, Dev 2 owns AI and template definitions, Dev 3 owns execution and evidence capture, and Dev 4 owns UI and report rendering. Use that exact path allocation when assigning tasks.

L0, P1, A1, B1 and U1 have landed; the task board retains their original acceptance records. New work starts from current main and reuses those contracts and fixtures. Further shared-contract changes land before their consumers. I1 still requires live AI composition to complete the generated-workflow journey. Full-MVP follow-through includes every required template, attachments, evidence and exports. The seven-hour demonstration is a milestone within that scope.

Use one checkout per developer. On one computer, use separate worktrees and ports. Never run concurrent editing sessions in the same working directory. Task owners must request permission from the lead before editing another owner's paths. Dev 1 owns manifests and bun.lock updates.

## Task assignment template

Every task issued by the lead uses this format.

```text
Task ID and owner
Branch and base commit
Outcome
Allowed paths
Dependencies and frozen contract version
Acceptance criteria
Verification command or screenshot
Time budget and checkpoint
Out-of-scope work
PR link and current commit
Status: planned | active | blocked | review | merged | verified
```

Use a GitHub issue or PR as the live task record. One owner and one reviewer per task. Report a blocker immediately with the exact error, dependency and a proposed fallback. The lead decides reassignment or scope reduction. Progress updates must include evidence, not only percentage estimates.

## Branch lifecycle

Start after the lead's baseline lands.

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/agent-tool-loop
```

Commit only the task's files and open a small PR into main. Keep the working tree clean before integrating updates. Prefer commits that deliver one verifiable behavior. Branch examples describe work and are not permanent team branches.

To update an active branch:

```sh
git fetch origin
git merge origin/main
```

The task owner resolves conflicts in owned files. Shared-contract conflicts require Dev 1 plus affected consumers. Re-run affected checks and push the resolved commit. Do not use blanket ours/theirs resolutions or force-push main.

## Serial merge protocol

1. Dev 1 selects one ready PR. Contract PRs precede their consumers; independent UI/demo work may land earlier.
2. Verify the PR names its task, allowed paths, acceptance evidence and current commit.
3. Require review from an affected consumer for every shared contract change. Dev 1's own PR requires another developer's review.
4. Update the PR against current main. Resolve conflicts with the relevant authors and regenerate bun.lock with Bun if manifests changed.
5. Run the full merge gate on the updated commit. Re-check the known-pass/known-fail demo when execution behavior changes.
6. Confirm GitHub checks belong to the latest PR commit, not an earlier revision.
7. Dev 1 squash-merges that PR. Record the resulting main commit in the task record.
8. Wait for main CI and relevant integration checks. If they fail, stop the merge queue and fix or revert the offending change with a normal reviewed commit.
9. Only then integrate the next PR. Notify affected owners to update their branches.

Passing branch CI alone is insufficient when main has moved. Serial integration and verification reduce conflict risk; semantic conflicts still require review.

## Required merge gate

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

Browser integration checks require the selected port free (1111 by default; use a separate `PORT` for each local checkout). CI uses Chromium with Linux dependencies. Tests must exercise changed behavior and failure cases. Model-dependent checks also need deterministic fixtures so CI works without API credentials.

Verify run status, assertion outcome and artifact ownership across layers. A tool error or missing prerequisite must never become a successful test report. Review cancellation, time limits, cleanup and target-origin policy whenever browser execution changes.

## Repository enforcement

The collaboration rule is that only Dev 1 merges. This document does not enforce GitHub permissions.

Before the event, the repository administrator should configure main to require PRs, the CI check job, an approving review, and an up-to-date branch. Restrict main updates to the lead where the repository plan supports it. Disable force pushes and branch deletion. Record the four developers' GitHub handles in the team task board before assigning reviewers. Do not invent CODEOWNERS entries or assume all members have equal merge access.

## Release gates

The following are the source plan's WIB targets, not a record of achieved milestones. Use the current task/PR evidence to report readiness.

- 10:00 — L0 merged and P1/A1/B1/U1 assigned.
- 11:00 — independent UI, agent fixtures and deterministic browser harness work.
- 12:30 — real validated model-to-browser actions work.
- 14:00 — feature cutoff; known-pass and known-fail vertical slice verified.
- 15:00 — critical fixes reviewed and fallback recording captured.
- 16:00 — desk and stage pitches rehearsed.
- 16:30 — Dev 1 verifies clean launch and submission.

If the 14:00 slice fails, Dev 1 pauses new features and assigns all four developers to the smallest blocking issues. Keep the last verified main commit and a clearly labeled recording available for demonstration fallback.
