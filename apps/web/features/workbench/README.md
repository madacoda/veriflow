# U1 project workbench

Open `/` to create or select a project, load the coupon fixture or review a selected saved revision, and save edits explicitly. The editor uses the v1 workflow schema. A revision conflict leaves the editor intact and offers the latest saved draft for comparison before the user changes the save base.

The run panel sends the chosen workflow ID and exact revision to P1. It polls active runs and presents lifecycle, test outcome, ordered events, expected and actual values, evidence, and capture warnings. The default platform uses the real Chromium adapter; unavailable-adapter responses remain visible without creating a run. The fixture preview remains available and clearly labels sample artifact references. The two demo links preview target modes without changing a saved revision.

## Dashboard verification

Run the [repository merge gate](../../../../REVIEW.md#required-merge-gate) from the checkout root. The dashboard tests capture screenshots under the Playwright test results directory for each fixture state and both coupon targets.

The real HTTP test is opt-in so regular smoke runs can leave existing project data alone. Point `STORAGE_DIR` to an isolated temporary directory, leave `VERIFLOW_RUN_ADAPTER` unset or set it to `browser`, and set `VERIFLOW_U1_TEST_HTTP=1` before running `bun run test:smoke`. This test covers project creation, revision conflicts without lost edits, the actual demo's observed failure and corrected pass, registered PNG retrieval, and immutable earlier reports. Target URLs use the running server's origin. A separate mocked test verifies 503 recovery and preserved selections.
