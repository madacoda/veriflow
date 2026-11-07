# U1 project workbench

Open `/` to create or select a project, load the coupon fixture or review a selected saved revision, and save edits explicitly. The form currently accepts title and URL only; description/goals exist in the API contract but still need UI binding. Frozen coupon fixtures target `127.0.0.1:1111`; alternate ports currently require correcting both project and workflow URLs. See [the audit](../../../../docs/project-audit.md) for these gaps and the silent template-load error. The editor uses the v1 workflow schema. A revision conflict leaves the editor intact and offers the latest saved draft for comparison before the user changes the save base.

The run panel sends the chosen workflow ID and exact revision to P1. It polls active runs and presents lifecycle, test outcome, ordered events, expected and actual values, evidence, and capture warnings. The default platform uses the real Chromium adapter; unavailable-adapter responses remain visible without creating a run. The fixture preview remains available and clearly labels sample artifact references. The two demo links preview target modes without changing a saved revision.

The attachment panel lists files for the selected project and uploads one file at a time through P2. A successful upload starts at **Extraction pending**. Refresh the list to see updated extraction status or a failure reason. The browser checks the file size and supported formats before upload and keeps the selected file available for retry after a failed request.

Open **Preview draft generation** to enter an objective and select templates and attachment references. **API generation** reads the template catalog and requests a project-scoped draft. The preview displays the returned provider, source references, warnings, and workflow steps. **Fixture preview** is a separate mode for reviewing seeded steps. The editor changes when the user explicitly opens a draft. Saving remains a separate action.

API generation requires `GET /api/templates` and `POST /api/projects/:projectId/workflows/generate`. These platform routes are pending. **Testing template** uses the existing project template API to build a deterministic draft from parameters. Catalog and provider errors stay visible with the entered inputs available for retry. Dashboard tests exercise the generation response contract with mock HTTP routes.

Terminal runs expose CSV, XLSX, and PDF download controls through P2. CSV is configured in the runtime; XLSX/PDF return 422 `unsupported_format`. The UI displays the server error and allows retry. Mocked download tests use labeled transport fixtures and do not prove valid XLSX/PDF documents. The current CSV viewport field describes the initial viewport even after responsive steps change it; this is an open audit finding.

## UI components

The web workspace uses shadcn/ui Radix Nova with Tailwind CSS v4. Theme tokens are in `apps/web/app/globals.css`. From the repository root, use `bun run --cwd apps/web shadcn add <component>` to add a registry component to `apps/web/features/ui/`. [shadcn/ui installation](https://ui.shadcn.com/docs/installation/manual) · [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)

## Dashboard verification

Run the [repository merge gate](../../../../REVIEW.md#required-merge-gate) from the checkout root. The dashboard tests capture screenshots under the Playwright test results directory for each fixture state and both coupon targets.

The real HTTP tests are opt-in so regular smoke runs can leave existing project data alone. Point `STORAGE_DIR` to an isolated temporary directory, leave `VERIFLOW_RUN_ADAPTER` unset or set it to `browser`, and set `VERIFLOW_U1_TEST_HTTP=1` before running `bun run test:smoke`. These tests cover project creation, revision conflicts without lost edits, the actual demo's observed failure and corrected pass, registered PNG retrieval, immutable earlier reports, and attachment upload/reload through P2. Target URLs use the running server's origin. Separate mocked tests verify 503 recovery, poll recovery, upload errors and project isolation. CI enables the real HTTP checks with isolated storage.
