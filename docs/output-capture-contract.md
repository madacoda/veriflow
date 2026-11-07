# G2: optional run capture and on-demand exports

Frozen by Dev 1 on 7 November 2026; implement after G1 and PDF27 integration. This contract is additive and all consumers ship atomically.

- Optional `startRun.capture` accepts screenshots/video booleans; omitted values resolve to screenshots=true, video=false. New runs persist resolved preferences. `RunRecord.capture` and `SessionOptions.capture` remain optional for legacy consumers. Reruns retain original preferences unless explicitly overridden.
- Reports remain on demand. CSV, XLSX and PDF selection does not remove workflow assertions or alter observed outcomes.
- Add optional per-media capture status: `not_requested`, `complete`, `partial`, `suppressed`, `unavailable`, with fixed safe reason codes. Do not fabricate detailed status for historical records. Aggregate `not_requested` applies when neither medium is selected; otherwise aggregate complete/partial/unavailable describes requested capture only.
- Preserve `evidence()` returning the artifact array. An optional `captureSummary()` may return finalized per-media status after evidence/close. The coordinator must not infer suppression from missing artifacts; old/fake adapters remain explicitly supported or unavailable.
- Disable video before creating a context for known secret-bearing workflows. If secret use appears later, discard the entire quarantined recording before registration. No secret-bearing recording may become downloadable. Preserve post-secret screenshot suppression and distinguish it from unselected capture. Inspection turns both media off.
- WebM initially, finalized before terminal artifact registration. Enforce ownership, path and size validation; clean up on error/cancellation. Do not promise MP4 or trace capture. Optional recording cannot turn an execution error into a pass.

Acceptance: legacy defaults and reruns; none/PNG/video/both selections; valid finalized owned WebM; cleanup on failure/cancellation; secret suppression. Reuse the existing container smoke run for an opt-in recording check. Dev 4 owns the pure XLSX renderer and isolated tests; Dev 1 reviews shared contracts, storage/HTTP integration, dependency additions and final merge.
