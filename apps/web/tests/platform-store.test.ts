import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoWorkflow } from "@veriflow/core/fixtures";
import {
  PlatformStore,
  PlatformError,
} from "../server/projects/platform-store.ts";

test("durable project-scoped revisions survive reopening and isolate returned values", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PlatformStore(root);
  const first = await store.createProject({
    title: "First",
    url: "https://example.com/path",
  });
  const second = await store.createProject({
    title: "Second",
    url: "https://example.org",
  });
  assert.deepEqual(first.allowedOrigins, ["https://example.com"]);
  first.title = "Client mutation";
  assert.equal((await store.getProject(first.id)).title, "First");
  const revision1 = await store.saveWorkflow(first.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  await store.saveWorkflow(second.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const revision2 = await store.saveWorkflow(first.id, {
    workflow: { ...demoWorkflow, name: "Edited" },
    expectedRevision: 1,
  });
  assert.equal(revision2.revision, 2);
  const reopened = new PlatformStore(root);
  assert.deepEqual(
    await reopened.getWorkflow(first.id, demoWorkflow.id, 1),
    revision1,
  );
  assert.equal(
    (await reopened.getWorkflow(second.id, demoWorkflow.id)).revision,
    1,
  );
  assert.equal((await reopened.listWorkflows(first.id)).length, 1);
  assert.equal(
    (await reopened.listWorkflows(first.id))[0].workflow.name,
    "Edited",
  );
  await assert.rejects(
    reopened.getWorkflow(second.id, demoWorkflow.id, 2),
    (error: unknown) => error instanceof PlatformError && error.status === 404,
  );
});

test("two store instances serialize competing optimistic writes without losing data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-concurrent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const left = new PlatformStore(root),
    right = new PlatformStore(root);
  const project = await left.createProject({
    title: "Concurrent",
    url: "https://example.com",
  });
  await left.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const results = await Promise.allSettled([
    left.saveWorkflow(project.id, {
      workflow: { ...demoWorkflow, name: "Left" },
      expectedRevision: 1,
    }),
    right.saveWorkflow(project.id, {
      workflow: { ...demoWorkflow, name: "Right" },
      expectedRevision: 1,
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(
    rejected?.status === "rejected" && rejected.reason.code,
    "revision_conflict",
  );
  assert.equal(
    (await left.getWorkflow(project.id, demoWorkflow.id)).revision,
    2,
  );
  await assert.rejects(
    left.saveWorkflow(project.id, {
      workflow: demoWorkflow,
      expectedRevision: null,
    }),
    /changed/,
  );
});

test("snapshots pin a revision and restart recovery never turns interrupted runs into passes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PlatformStore(root);
  const project = await store.createProject({
    title: "Pinned",
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
  const context = await store.createRun(
    project.id,
    { workflowId: demoWorkflow.id, revision: 1 },
    "fake",
  );
  await assert.rejects(
    store.report(project.id, context.run.id),
    (error: unknown) =>
      error instanceof PlatformError && error.code === "run_not_finished",
  );
  await assert.rejects(
    store.getRun(other.id, context.run.id),
    (error: unknown) => error instanceof PlatformError && error.status === 404,
  );
  await store.saveWorkflow(project.id, {
    workflow: { ...demoWorkflow, name: "New revision" },
    expectedRevision: 1,
  });
  const restarted = new PlatformStore(root);
  assert.equal(await restarted.recoverInterruptedRuns(), 1);
  assert.equal(await restarted.recoverInterruptedRuns(), 0);
  const recovered = await restarted.getRun(project.id, context.run.id);
  assert.equal(recovered.lifecycle, "error");
  assert.equal(recovered.outcome, null);
  assert.equal(recovered.error?.code, "interrupted");
  const snapshot = await restarted.report(project.id, context.run.id);
  assert.equal(snapshot.workflow.revision, 1);
  assert.equal(snapshot.workflow.workflow.name, demoWorkflow.name);
  assert.deepEqual(snapshot.project, context.project);
  assert.deepEqual(snapshot.run, recovered);
  await restarted.updateRun(project.id, context.run.id, (run) => {
    run.lifecycle = "completed";
    run.outcome = "passed";
  });
  assert.equal(
    (await restarted.getRun(project.id, context.run.id)).lifecycle,
    "error",
  );
});

test("corrupt persisted state is never replaced with a new empty database", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-corrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = join(root, "platform-v1.json");
  await writeFile(filename, "{broken");
  await assert.rejects(
    new PlatformStore(root).createProject({
      title: "No overwrite",
      url: "https://example.com",
    }),
    /could not be read/,
  );
  assert.equal(await readFile(filename, "utf8"), "{broken");
});
