// Runs through public HTTP routes only, without app source or model credentials.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const origin = process.env.CONTAINER_SMOKE_ORIGIN || "http://127.0.0.1:1111";
async function request(path, status = 200, body) {
  const response = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(10000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  assert.equal(response.status, status, `${path}: unexpected HTTP status`);
  return response;
}
async function json(path, status = 200, body) {
  return (await request(path, status, body)).json();
}
async function completed(path) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const { run } = await json(path);
    if (!["queued", "running"].includes(run.lifecycle)) {
      assert.equal(run.lifecycle, "completed", JSON.stringify(run.error));
      return run;
    }
    await delay(250);
  }
  assert.fail("Browser run did not complete within 60 seconds");
}
async function evidence(projectPath, run) {
  assert.equal(run.evidence.capture, "complete");
  assert.equal(run.evidence.artifacts.length, 4);
  assert.equal(new Set(run.evidence.artifacts.map((item) => item.id)).size, 4);
  assert.deepEqual(run.evidence.artifacts.map((item) => item.stepId).sort(), [
    "apply",
    "coupon",
    "open",
    "total",
  ]);
  for (const item of run.evidence.artifacts) {
    assert.equal(item.runId, run.id);
    assert.equal(item.mediaType, "image/png");
    const response = await request(
      `${projectPath}/runs/${run.id}/evidence/${item.id}`,
    );
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer()).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  }
}
function outcome(run, revision, expectedOutcome, actual) {
  assert.equal(run.adapter, "browser");
  assert.equal(run.revision, revision);
  assert.equal(run.outcome, expectedOutcome);
  assert.equal(run.steps.length, 4);
  assert.ok(run.steps.slice(0, 3).every((step) => step.status === "passed"));
  assert.equal(run.steps[3].stepId, "total");
  assert.equal(run.steps[3].status, expectedOutcome);
  assert.equal(run.steps[3].expected, "90000");
  assert.equal(run.steps[3].actual, actual);
  if (expectedOutcome === "failed")
    assert.equal(run.steps[3].failureKind, "assertion");
}
async function verify(state) {
  const projectPath = `/api/projects/${state.projectId}`;
  const { project } = await json(projectPath);
  assert.equal(project.title, "Container persistence smoke");
  const { snapshot } = await json(
    `${projectPath}/runs/${state.failedRunId}/report`,
  );
  assert.equal(snapshot.workflow.revision, 1);
  assert.equal(snapshot.workflow.workflow.steps[0].url, `${origin}/demo?bug=1`);
  outcome(snapshot.run, 1, "failed", "100000");
  await evidence(projectPath, snapshot.run);
  const { run: passed } = await json(
    `${projectPath}/runs/${state.passedRunId}`,
  );
  assert.equal(passed.lifecycle, "completed");
  outcome(passed, 2, "passed", "90000");
  await evidence(projectPath, passed);
}
async function run() {
  const { project } = await json("/api/projects", 201, {
    title: "Container persistence smoke",
    url: `${origin}/demo?bug=1`,
  });
  const projectPath = `/api/projects/${project.id}`;
  const workflow = {
    schemaVersion: "1",
    id: "container-checkout",
    name: "Container discount check",
    steps: [
      { id: "open", code: "redirect", url: `${origin}/demo?bug=1` },
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
    ].map((step) => ({ ...step, timeoutMs: 4000 })),
  };
  await json(`${projectPath}/workflows`, 201, {
    workflow,
    expectedRevision: null,
  });
  const { run: failedQueued } = await json(`${projectPath}/runs`, 202, {
    workflowId: workflow.id,
    revision: 1,
  });
  const failed = await completed(`${projectPath}/runs/${failedQueued.id}`);
  outcome(failed, 1, "failed", "100000");
  await evidence(projectPath, failed);
  workflow.steps[0].url = `${origin}/demo?bug=0`;
  await json(`${projectPath}/workflows`, 201, {
    workflow,
    expectedRevision: 1,
  });
  const { run: passedQueued } = await json(`${projectPath}/runs`, 202, {
    workflowId: workflow.id,
    revision: 2,
  });
  const passed = await completed(`${projectPath}/runs/${passedQueued.id}`);
  outcome(passed, 2, "passed", "90000");
  assert.notEqual(passed.id, failed.id);
  assert.ok(
    passed.evidence.artifacts.every(
      (item) =>
        !failed.evidence.artifacts.some((previous) => previous.id === item.id),
    ),
  );
  await evidence(projectPath, passed);
  return {
    projectId: project.id,
    failedRunId: failed.id,
    passedRunId: passed.id,
  };
}

if (process.argv[2] === "run") console.log(JSON.stringify(await run()));
else if (process.argv[2] === "verify")
  await verify(JSON.parse(process.argv[3]));
else throw new Error("Expected run or verify mode");
