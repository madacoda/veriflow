import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Evidence } from "@veriflow/core";
import { demoWorkflow } from "@veriflow/core/fixtures";
import { createPlatform } from "../server/composition/platform.ts";
import { createFakeSessionFactory } from "../server/runs/fake-session.ts";
import { validateEvidence } from "../server/runs/evidence.ts";

const request = (body: unknown) =>
  new Request("http://localhost/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

test("HTTP maps malformed, invalid, oversized and missing resources to stable JSON errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { http } = await createPlatform(root);
  const cases = [
    [
      await http.projectsPOST(
        new Request("http://localhost", { method: "POST", body: "{" }),
      ),
      400,
      "invalid_json",
    ],
    [
      await http.projectsPOST(
        request({ title: "", url: "file:///etc/passwd" }),
      ),
      422,
      "validation_error",
    ],
    [
      await http.projectsPOST(
        request({
          title: "Valid",
          url: "https://example.com",
          owner: "client-owned",
        }),
      ),
      422,
      "validation_error",
    ],
    [
      await http.projectsPOST(
        request({ description: "x".repeat(1024 * 1024) }),
      ),
      413,
      "payload_too_large",
    ],
    [await http.projectGET("unknown"), 404, "not_found"],
  ] as const;
  for (const [response, status, code] of cases) {
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error.code, code);
  }
  assert.deepEqual((await (await http.projectsGET()).json()).projects, []);
});

test("HTTP creates projects, saves reviewed revisions, rejects stale writes and pins runs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-api-flow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { http, store, coordinator } = await createPlatform(
    root,
    createFakeSessionFactory("passed"),
    "fake",
  );
  const response = await http.projectsPOST(
    request({ title: "HTTP project", url: "https://example.com" }),
  );
  assert.equal(response.status, 201);
  const { project } = await response.json();
  const saved = await http.workflowsPOST(
    request({ workflow: demoWorkflow, expectedRevision: null }),
    project.id,
  );
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).workflow.revision, 1);
  const conflict = await http.workflowsPOST(
    request({ workflow: demoWorkflow, expectedRevision: null }),
    project.id,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "revision_conflict");
  assert.equal(
    (
      await http.workflowGET(
        new Request("http://localhost?revision=1x"),
        project.id,
        demoWorkflow.id,
      )
    ).status,
    422,
  );
  assert.equal(
    (await http.runsPOST(request({ workflowId: demoWorkflow.id }), project.id))
      .status,
    422,
  );
  const started = await http.runsPOST(
    request({ workflowId: demoWorkflow.id, revision: 1 }),
    project.id,
  );
  assert.equal(started.status, 202);
  const { run } = await started.json();
  assert.equal(run.adapter, "fake");
  await store.saveWorkflow(project.id, {
    workflow: { ...demoWorkflow, name: "Changed later" },
    expectedRevision: 1,
  });
  await coordinator.wait(run.id);
  const fetched = await (await http.runGET(project.id, run.id)).json();
  assert.equal(fetched.run.lifecycle, "completed");
  assert.equal(fetched.run.outcome, "passed");
  assert.equal(
    (
      await (
        await http.reportGET(
          new Request("http://localhost/report"),
          project.id,
          run.id,
        )
      ).json()
    ).snapshot.workflow.revision,
    1,
  );
  assert.equal(
    (
      await http.reportGET(
        new Request("http://localhost/report?format=pdf"),
        project.id,
        run.id,
      )
    ).status,
    503,
  );
  const other = await store.createProject({
    title: "Another",
    url: "https://example.org",
  });
  assert.equal((await http.runGET(other.id, run.id)).status, 404);
  assert.equal(
    (
      await http.workflowGET(
        new Request("http://localhost"),
        other.id,
        demoWorkflow.id,
      )
    ).status,
    404,
  );
  assert.equal((await http.cancelPOST(other.id, run.id)).status, 404);
});

test("HTTP missing-adapter response is 503 with no fabricated run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-no-adapter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { http, store } = await createPlatform(root);
  const project = await store.createProject({
    title: "Unavailable",
    url: "https://example.com",
  });
  await store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const response = await http.runsPOST(
    request({ workflowId: demoWorkflow.id, revision: 1 }),
    project.id,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "adapter_unavailable");
  assert.deepEqual(await store.listRuns(project.id), []);
});

test("evidence resolves registered IDs, rejects cross-project access and confines artifact paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { http, store } = await createPlatform(root);
  const project = await store.createProject({
    title: "Evidence",
    url: "https://example.com",
  });
  const other = await store.createProject({
    title: "Other",
    url: "https://example.org",
  });
  await store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const { run } = await store.createRun(
    project.id,
    { workflowId: demoWorkflow.id, revision: 1 },
    "fake",
  );
  const directory = join(root, "runs", run.id);
  await mkdir(directory, { recursive: true });
  const artifact: Evidence = {
    id: "capture-1",
    runId: run.id,
    stepId: "total",
    kind: "screenshot",
    artifactPath: `runs/${run.id}/total.png`,
    mediaType: "image/png",
  };
  const fixtureBytes = new Uint8Array([1, 2, 3]); // Metadata/retrieval fixture, not a real screenshot.
  await writeFile(join(directory, "total.png"), fixtureBytes);
  await validateEvidence(root, run.id, new Set(["total"]), [artifact]);
  await store.updateRun(project.id, run.id, (record) => {
    record.lifecycle = "completed";
    record.outcome = "failed";
    record.evidence = {
      contractVersion: "1",
      runId: run.id,
      artifacts: [artifact],
      capture: "partial",
      warnings: ["Unit fixture only"],
    };
  });
  const retrieved = await http.evidenceGET(project.id, run.id, artifact.id);
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await retrieved.arrayBuffer()), fixtureBytes);
  assert.equal(
    (await http.evidenceGET(project.id, run.id, "unregistered")).status,
    404,
  );
  assert.equal(
    (await http.evidenceGET(other.id, run.id, artifact.id)).status,
    404,
  );
  const invalid = [
    { ...artifact, artifactPath: "../platform-v1.json" },
    { ...artifact, runId: "another-run" },
    { ...artifact, stepId: "unknown" },
    { ...artifact, mediaType: "text/html" },
    { ...artifact, artifactPath: `runs/${run.id}/../platform-v1.json` },
  ];
  for (const entry of invalid)
    await assert.rejects(
      validateEvidence(root, run.id, new Set(["total"]), [entry]),
    );
  await assert.rejects(
    validateEvidence(root, run.id, new Set(["total"]), [artifact, artifact]),
  );
  // Directory junctions exercise the escape on Windows without symlink privileges.
  await symlink(
    root,
    join(directory, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    validateEvidence(root, run.id, new Set(["total"]), [
      { ...artifact, artifactPath: `runs/${run.id}/alias/platform-v1.json` },
    ]),
  );
});
