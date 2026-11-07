// Runs through public HTTP routes only, without app source or model credentials.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const origin = process.env.CONTAINER_SMOKE_ORIGIN || "http://127.0.0.1:1111";
const anonymous = await fetch(`${origin}/api/projects`);
assert.equal(anonymous.status, 401);
const signedIn = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({
    username: process.env.AUTH_USERNAME,
    password: process.env.AUTH_PASSWORD,
  }),
});
assert.equal(signedIn.status, 200);
const cookie = signedIn.headers.get("set-cookie").split(";")[0];
async function request(path, status = 200, body) {
  const response = await fetch(new URL(path, origin), {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Cookie: cookie,
            Origin: origin,
          },
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
async function evidence(
  projectPath,
  run,
  stepIds = ["apply", "coupon", "open", "total"],
) {
  // The current adapter provides PNGs, not a completeness declaration for all media.
  assert.equal(run.evidence.capture, "partial");
  assert.ok(run.evidence.warnings.length > 0);
  assert.equal(run.evidence.artifacts.length, stepIds.length);
  assert.equal(
    new Set(run.evidence.artifacts.map((item) => item.id)).size,
    stepIds.length,
  );
  assert.deepEqual(
    run.evidence.artifacts.map((item) => item.stepId).sort(),
    [...stepIds].sort(),
  );
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
async function pdfReport(projectPath, runId) {
  // Exercise the lazy renderer and bundled font in the actual standalone image.
  const response = await request(
    `${projectPath}/runs/${runId}/report?format=pdf`,
  );
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /^attachment;.*\.pdf/i,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(bytes.subarray(-64).toString("ascii"), /%%EOF\s*$/);
  return createHash("sha256").update(bytes).digest("hex");
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
  assert.equal(
    await pdfReport(projectPath, state.failedRunId),
    state.failedPdfSha256,
    "The pinned report must render consistently after container restart",
  );
  const { run: passed } = await json(
    `${projectPath}/runs/${state.passedRunId}`,
  );
  assert.equal(passed.lifecycle, "completed");
  outcome(passed, 2, "passed", "90000");
  await evidence(projectPath, passed);
  await verifyAccessibility(state.accessibility);
}
async function verifyAccessibility(state) {
  const projectPath = `/api/projects/${state.projectId}`;
  const { snapshot } = await json(`${projectPath}/runs/${state.runId}/report`);
  const run = snapshot.run;
  assert.equal(run.id, state.runId);
  assert.equal(run.adapter, "browser");
  assert.equal(run.lifecycle, "completed");
  assert.equal(run.outcome, "failed");
  assert.equal(snapshot.workflow.revision, 1);
  assert.equal(run.steps[0].status, "passed");
  const check = run.steps.find((step) => step.stepId === "wcag");
  assert.equal(check?.status, "failed");
  assert.equal(check.failureKind, "assertion");
  const finding = snapshot.findings.find(
    (item) => item.category === "accessibility" && item.ruleId === "image-alt",
  );
  assert.ok(finding, "The packaged application must execute the real axe scan");
  assert.equal(finding.stepId, "wcag");
  assert.ok(finding.evidenceIds.length > 0);
  for (const id of finding.evidenceIds)
    assert.ok(
      run.evidence.artifacts.some(
        (item) =>
          item.id === id && item.runId === run.id && item.stepId === "wcag",
      ),
      "Axe findings must reference their own registered screenshots",
    );
  await evidence(projectPath, run, ["open", "wcag"]);
}
async function accessibility() {
  // Explicit test target, served inside the container. No external site or model.
  const target = createServer((request, response) => {
    if (request.url === "/pixel.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      );
    } else {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><html lang="en"><head><title>Axe container fixture</title></head><body><main><h1>Accessibility fixture</h1><img src="/pixel.svg"></main></body></html>',
      );
    }
  });
  try {
    await new Promise((resolve, reject) => {
      target.once("error", reject);
      target.listen(0, "127.0.0.1", resolve);
    });
    const targetOrigin = `http://127.0.0.1:${target.address().port}`;
    const { project } = await json("/api/projects", 201, {
      title: "Container axe fixture",
      url: targetOrigin,
    });
    const projectPath = `/api/projects/${project.id}`;
    const { workflow } = await json(`${projectPath}/templates`, 200, {
      templateId: "accessibility-wcag",
      parameters: { url: targetOrigin },
    });
    await json(`${projectPath}/workflows`, 201, {
      workflow,
      expectedRevision: null,
    });
    const { run } = await json(`${projectPath}/runs`, 202, {
      workflowId: workflow.id,
      revision: 1,
    });
    await completed(`${projectPath}/runs/${run.id}`);
    const state = { projectId: project.id, runId: run.id };
    await verifyAccessibility(state);
    return state;
  } finally {
    if (target.listening)
      await new Promise((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve())),
      );
  }
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
    failedPdfSha256: await pdfReport(projectPath, failed.id),
    accessibility: await accessibility(),
  };
}

if (process.argv[2] === "run") console.log(JSON.stringify(await run()));
else if (process.argv[2] === "verify")
  await verify(JSON.parse(process.argv[3]));
else throw new Error("Expected run or verify mode");
