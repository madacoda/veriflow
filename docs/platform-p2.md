# P2: attachment storage and report delivery

Task ID/owner: P2 — Dev 1. Primary reviewer: Dev 4 (HTTP/download consumption); Dev 2 reviews the AttachmentReader integration. Branch: `codex/p2-attachments-reports`, stacked on P1 updated against L0 main `3c432f1`. The base is P1 documentation head `1762fcc`; implementation contracts remain v1 with no core changes. [P1 CI passed on that base](https://github.com/madacoda/veriflow/actions/runs/42336880852).

Outcome: project-scoped attachment upload/read persistence and a report HTTP/storage adapter ready for Dev 4's renderer. Allowed paths: `apps/web/app/api/**`, `apps/web/server/attachments/**`, `apps/web/server/projects/**`, `apps/web/server/runs/report-downloads.ts`, `apps/web/server/composition/**`, `apps/web/tests/platform-*.test.ts` and lead coordination documents. AI extraction, browser execution, UI and business-report rendering are outside this task.

Acceptance: multipart limits hold for streamed requests; only registered project-owned attachment IDs resolve; source bytes and metadata survive restart; legacy P1 data migrates additively; metadata failure rolls back its unregistered blob; export formats share the immutable ReportSnapshot and cannot change observed results; safe filenames and explicit adapter errors reach HTTP callers. Budget/checkpoint: one independently verified slice while Devs 2–4 review/start their layers, retaining lead capacity for integration. Status: merged in [PR #3](https://github.com/madacoda/veriflow/pull/3) as `84327a7`. Verification below records the original P2 behavior; [project status](project-status.md) covers subsequent UI/CSV integration and the current release gate.

## Attachment HTTP surface

| Method/path under `/api/projects/:projectId` | Request                                       | Response                                          |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| GET `/attachments`                           | none                                          | `{ attachments: AttachmentMetadata[] }`           |
| POST `/attachments`                          | multipart/form-data; exactly one `file` field | 201 `{ attachment: AttachmentMetadata }`          |
| GET `/attachments/:attachmentId`             | none                                          | `{ attachment: AttachmentMetadata }`              |
| GET `/attachments/:attachmentId/content`     | none                                          | Binary attachment with original download filename |

Accepted declared media types are the L0 whitelist: TXT/MD/CSV/JSON/PDF/DOCX/PNG/JPEG. A file must be nonempty and at most 10 MiB. The total multipart body is capped at 10 MiB plus 64 KiB for framing, including when Content-Length is absent. Unknown media return 415, invalid multipart/fields/filenames return 422, overflow returns 413 and cross-project/unregistered IDs return 404. The shared ApiError envelope is unchanged.

Uploaded metadata always starts with extraction=pending. Upload validates the declared media type and storage constraints; it does not claim to parse document contents, OCR screenshots or complete extraction. Dev 2 owns those operations. Stored bytes are immutable and addressed by server-generated IDs, never original filenames. The additive attachments field is optional only when loading older P1 databases; subsequent writes retain existing projects, revisions, runs and snapshots.

The composition result exposes `attachments`, which implements L0 AttachmentReader:

```ts
const { metadata, bytes } = await platform.attachments.read(
  projectId,
  attachmentId,
);
```

Dev 1 will pass that reader into Dev 2's context pipeline. After actual extraction, Dev 1 can persist ready/failed metadata via `store.setAttachmentExtraction`; no public endpoint lets a client claim successful extraction. Until the pipeline is integrated, uploads remain pending. Missing stored content, changed byte sizes and symlink aliases return a safe storage error rather than unrelated files or empty content.

## Report HTTP/storage adapter

Existing `GET .../runs/:runId/report` still returns `{ snapshot }`. Adding exactly one `format=csv|xlsx|pdf` requests a binary download. Unsupported/duplicate format parameters return 422. Unknown/cross-project runs return 404 and nonterminal runs return 409 before rendering. A custom instance with no renderer returns 503. The current runtime wires CSV and rejects XLSX/PDF with 422 `unsupported_format`. Renderer failures or invalid output return a safe 500 and do not change the run result.

Dev 4 supplies the L0 ReportRenderer. Dev 1 wires it through the fourth createPlatform argument:

```ts
createPlatform(storageRoot, browserFactory, "browser", { reportRenderer });
```

The renderer receives a clone of the persisted immutable snapshot. Expected media types are text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet and application/pdf. Nonempty output is capped at 25 MiB. The adapter uses its own safe `veriflow-<runId>.<format>` filename instead of trusting a renderer-provided header value.

Each successful output is synced into private managed storage under `reports/<runId>/<snapshot-sha256>-<export-id>.<format>`, then returned with no-store caching and an attachment disposition. The bytes delivered match the stored bytes. Exports are not served as arbitrary filesystem paths. CSV content generation is now enabled in runtime composition. XLSX/PDF implementation and real-format validation remain Dev 4's work, with Dev 1 wiring their HTTP/storage integration.

The storage model is still one long-running Node process with one writer and a persistent volume. Bytes are completely written before attachment metadata is published. A process crash between writing a blob and metadata registration can leave an unregistered orphan file; such files are not listed or downloadable through attachment IDs. Automatic orphan/old-export garbage collection is not implemented.

## Original P2 verification

The complete merge gate from REVIEW.md passed locally on 7 November 2026 (WIB): frozen dependency install, lint, format check, type checks, unit tests, production build, browser installation and smoke tests. The two new test files add 14 cases: 8 attachment tests and 6 report transport tests. With P1 and L0, the unit total is 49 (core 7, runner 6, web 36); both existing browser smoke tests pass.

Attachment coverage includes restart persistence, metadata/content scoping, malformed multipart and duplicate fields, streamed body limits, unsupported/empty/oversized uploads, legacy migration, rollback, immutable reader results, stored-size mismatch, symlink confinement and persisted extraction failures. Report coverage includes all three transport formats using the same pinned snapshot, exact persisted bytes, safe headers, format/state/access checks, missing renderer, redacted failures, malformed/oversized output, renderer input mutation and symlink confinement.

Production HTTP checks ran through the actual Next.js routes on port 3001 against an isolated temporary storage directory. A Markdown requirement and PNG screenshot uploaded with pending extraction and downloaded with identical bytes; access from another project returned 404. ZIP returned 415, a file exceeding 10 MiB returned 413, and neither rejection registered an attachment. A clearly labeled fake run produced an immutable revision-1 report snapshot; missing PDF renderer returned 503 and an unsupported format returned 422. After restarting the production service with default adapters, both uploads, their exact content, pending status and the prior fake result/snapshot remained available.

The original report transport test bytes are explicitly fake fixtures, not actual PDF/XLSX documents. Later CSV tests exercise the real renderer. Original missing-renderer 503 checks do not describe the current CSV-enabled composition. The full AI/browser journey and remaining real-format exports still need integration evidence.
