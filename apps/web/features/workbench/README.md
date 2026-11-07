# U1 project workbench

Open `/` to create or select a project, load the coupon fixture or review a selected saved revision, and save edits explicitly. The editor uses the v1 workflow schema. A revision conflict leaves the editor intact and offers the latest saved draft for comparison before the user changes the save base.

The run panel sends the chosen workflow ID and exact revision to P1. It polls active runs and presents lifecycle, test outcome, ordered events, expected and actual values, evidence, and capture warnings. The default platform uses the real Chromium adapter; unavailable-adapter responses remain visible without creating a run. The fixture preview remains available and clearly labels sample artifact references. The two demo links preview target modes without changing a saved revision.

The attachment panel lists files for the selected project and uploads one file at a time through P2. A successful upload starts at **Extraction pending**. Refresh the list to see updated extraction status or a failure reason. The browser checks the file size and supported formats before upload and keeps the selected file available for retry after a failed request.

Open **Preview draft generation** to select an objective, the shared fixture template, and attachment references. The preview shows its fixture provider, source references, warnings, and workflow steps. The editor changes when the user explicitly opens the preview. Saving remains a separate action.

Terminal runs expose CSV, XLSX, and PDF download controls through P2. Each format requires a configured renderer. The UI displays an unavailable renderer response and allows retry. Dashboard tests use labeled transport fixtures to verify response handling and downloaded bytes.

## Dashboard verification

Run the [repository merge gate](../../../../REVIEW.md#required-merge-gate) from the checkout root. The dashboard tests capture screenshots under the Playwright test results directory for each fixture state and both coupon targets.

The real HTTP tests are opt-in so regular smoke runs can leave existing project data alone. Point `STORAGE_DIR` to an isolated temporary directory, leave `VERIFLOW_RUN_ADAPTER` unset or set it to `browser`, and set `VERIFLOW_U1_TEST_HTTP=1` before running `bun run test:smoke`. These tests cover project creation, revision conflicts without lost edits, the actual demo's observed failure and corrected pass, registered PNG retrieval, immutable earlier reports, and attachment upload/reload through P2. Target URLs use the running server's origin. Separate mocked tests verify 503 recovery, poll recovery, upload errors and project isolation. CI enables the real HTTP checks with isolated storage.
