# P3: integration guardrails

Task/owner: P3 — Dev 1. Reviewers: Dev 3 for admission/lifecycle and Dev 2 for shared schemas/fixtures. Branch: `codex/p3-integration-guardrails`, base main `84327a79c1e27123ee893d7a4e95779c5a652f57` after the user merged P1/P2. Status: merged in [PR #6](https://github.com/madacoda/veriflow/pull/6) as `eb02beb`; [Linux/Windows main CI passed](https://github.com/madacoda/veriflow/actions/runs/42339119726). This is the original P3 delivery record; see [project status](project-status.md) for current release evidence.

Outcome: resolve the lead-owned review and portability blockers before real adapter composition. Allowed paths: core URL/fixture definitions and tests, coordinator/composition, platform storage helpers/tests, root CI, server configuration and lead documentation. Dependencies: unchanged workflow/contract version 1, merged P1/P2. No changes to Dev 2 agent code, Dev 3 browser code or Dev 4 UI/report code. Checkpoint: complete this small prerequisite before admitting A1/B1 to the serial merge queue, preserving lead review capacity.

## Requested corrections

- [Dev 3 L0/P1 review](https://github.com/madacoda/veriflow/pull/1#issuecomment-6701980144): reject credentials in navigation, bound concurrent run admission, and preserve infrastructure failure during opening/evidence cancellation races.
- [Dev 2 L0 review](https://github.com/madacoda/veriflow/pull/1#issuecomment-6702047131): apply the URL policy to workflow/save/tool boundaries and correct the source attachment's declared byte count.
- [Dev 3 Windows gate](https://github.com/madacoda/veriflow/pull/2#issuecomment-6702100607) and [Dev 2 CI blocker](https://github.com/madacoda/veriflow/pull/5#issuecomment-6702133538): remove the timing assumption that every 10ms run reaches browser allocation; use portable directory-junction fixtures where Windows file symlinks require privileges.

## Changes and acceptance

Projects and workflow redirects now share one credential-free HTTP(S) schema. Invalid URL syntax returns validation failure instead of escaping a URL constructor. Tests cover step, workflow, save, execute-tool and project boundaries, including encoded/user-only/password-only credentials. Credential-free legacy workflows remain version 1. Shared attachment bytes are derived from the exact context source text (73 bytes) and checked through an integrity-validating fake reader/extractor round trip.

The coordinator synchronously reserves admission before persisted run creation. `VERIFLOW_MAX_CONCURRENT_RUNS` defaults to 2 and must be an integer in 1..8. Exhausted capacity returns 503 using the existing adapter_unavailable error code and a retry message; rejected requests create no run. Reservations include pending persistence, active work, evidence and cleanup; they release after job settlement or a failed persisted admission. There is no distributed scheduler or waiting queue. The bound covers admitted jobs in the one service process; physical browser supervision remains the adapter's responsibility.

Unexpected open/evidence/close failures stay lifecycle=error, outcome=null even when the user has requested cancellation. A pre-allocation abort can be cancelled when its reason is the actual user signal and no session allocation was attempted. Cooperative in-session cancellation still finalizes as cancelled after evidence/close settle. A known infrastructure failure takes precedence over a concurrent cancellation request.

The optional trusted `deadlineSignal(timeoutMs)` constructor seam makes tests deterministic. One test explicitly expires before allocation and expects no session; another waits for an execute handshake before expiry and verifies cleanup. Production still uses the bounded AbortSignal timeout. Capacity tests cover simultaneous starts, no extra persisted records, cancellation retaining admission while close is pending, and reservation release on persistence failure.

Directory alias checks always run. On Windows they use junctions, which do not require file-symlink privileges; Unix also retains its final-file symlink case. Attachment reads explicitly lstat/realpath the final file as well as using O_NOFOLLOW, so final-link protection does not rely solely on a platform-specific open flag. CI retains the existing Linux check job and adds windows-unit for frozen install, type checks and all unit tests; Windows verification passed on the resulting P3 main commit linked above.

## Verification

The full REVIEW.md gate passed locally on 7 November 2026 (WIB): frozen install, lint, formatting, types, 59 unit tests (core 9, runner 6, web 44), production build, Chromium installation and 2 browser smoke tests. Ten new cases cover the shared URL/fixture fixes, deterministic pre-open timeout, the real production deadline without an allocation assumption, pre-allocation cancellation versus storage failure, bounded admission/release and open/evidence failures racing cancellation; the existing cleanup-timeout test now uses the explicit handshake. Existing assertion, revision, storage and report tests remain active.

P1/P2 main `84327a7` [passed CI](https://github.com/madacoda/veriflow/actions/runs/42337370708), but A1 later exposed the inherited timing-sensitive test in a different run. Do not use that earlier success to waive the regression or latest-head gate. Affected-consumer review and the subsequent P3 main gate completed. A1/B1 and deterministic browser/UI composition subsequently landed. Live AI integration remains part of I1; historical P3 success does not waive checks on current main.
