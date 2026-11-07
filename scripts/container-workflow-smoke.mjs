import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const origin = "http://127.0.0.1:1111";
async function json(path, body) {
  const response = await fetch(origin + path, {
    ...(body && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
const { project } = await json("/api/projects", {
  title: "Deployment verification: real browser fail and pass",
  url: `${origin}/demo`,
});
const path = `/api/projects/${project.id}`;
for (const [index, bug] of [1, 0].entries()) {
  await json(`${path}/workflows`, {
    expectedRevision: index || null,
    workflow: {
      schemaVersion: "1",
      id: "deployment-coupon",
      name: "Verify coupon total",
      steps: [
        { id: "open", code: "redirect", url: `${origin}/demo?bug=${bug}` },
        {
          id: "coupon",
          code: "fill",
          target: { by: "testId", value: "coupon-input" },
          value: "SAVE10",
        },
        {
          id: "apply",
          code: "click",
          target: { by: "testId", value: "apply-coupon" },
        },
        {
          id: "total",
          code: "assert",
          target: { by: "testId", value: "order-total" },
          expectation: { kind: "text", value: "90000" },
        },
      ].map((step) => ({ ...step, timeoutMs: 5000 })),
    },
  });
  let { run } = await json(`${path}/runs`, {
    workflowId: "deployment-coupon",
    revision: index + 1,
  });
  const runPath = `${path}/runs/${run.id}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    ({ run } = await json(runPath));
    if (!["queued", "running"].includes(run.lifecycle)) break;
    await setTimeout(500);
  }
  assert.equal(run.lifecycle, "completed", JSON.stringify(run));
  assert.equal(run.adapter, "browser");
  assert.equal(run.outcome, bug ? "failed" : "passed", JSON.stringify(run));
  if (bug) {
    assert.equal(run.steps.at(-1).expected, "90000");
    assert.equal(run.steps.at(-1).actual, "100000");
  }
  assert.equal(run.evidence.artifacts.length, 4);
  for (const artifact of run.evidence.artifacts) {
    const response = await fetch(`${origin}${runPath}/evidence/${artifact.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  }
  console.log(`Real browser ${run.outcome}: ${run.id}, four verified PNGs`);
}
