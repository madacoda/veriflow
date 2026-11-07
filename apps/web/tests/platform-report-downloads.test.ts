import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ReportFormat,
  ReportRenderer,
  ReportSnapshot,
} from "@veriflow/core";
import { demoWorkflow } from "@veriflow/core/fixtures";
import { createPlatform } from "../server/composition/platform.ts";
import { createFakeSessionFactory } from "../server/runs/fake-session.ts";

const mediaTypes: Record<ReportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
// Transport fixtures only: these bytes are not actual rendered PDF/XLSX documents.
function fixtureRenderer(received: ReportSnapshot[] = []): ReportRenderer {
  return {
    render: async (snapshot, format) => {
      received.push(structuredClone(snapshot));
      return {
        bytes: new TextEncoder().encode(
          `fixture:${format}:${snapshot.workflow.revision}:${snapshot.run.outcome}`,
        ),
        mediaType: mediaTypes[format],
        filename: "untrusted\r\nfilename",
      };
    },
  };
}
async function setup(renderer?: ReportRenderer) {
  const root = await mkdtemp(join(tmpdir(), "veriflow-reports-"));
  const platform = await createPlatform(
    root,
    createFakeSessionFactory("failed"),
    "fake",
    { reportRenderer: renderer },
  );
  const project = await platform.store.createProject({
    title: "Reports",
    url: "https://example.com",
  });
  await platform.store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const run = await platform.coordinator.start(project.id, {
    workflowId: demoWorkflow.id,
    revision: 1,
  });
  await platform.coordinator.wait(run.id);
  return { root, project, run, ...platform };
}
const request = (format?: string) =>
  new Request(
    `http://localhost/report${format === undefined ? "" : `?format=${format}`}`,
  );

test("all export formats render the same immutable snapshot and persist the returned bytes", async (t) => {
  const received: ReportSnapshot[] = [];
  const { root, project, run, store, http } = await setup(
    fixtureRenderer(received),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = await store.report(project.id, run.id);
  await store.saveWorkflow(project.id, {
    workflow: { ...demoWorkflow, name: "Edited after run" },
    expectedRevision: 1,
  });
  for (const format of ["csv", "xlsx", "pdf"] as const) {
    const response = await http.reportGET(request(format), project.id, run.id);
    assert.equal(response.status, 200);
    assert.ok(
      response.headers.get("content-type")!.startsWith(mediaTypes[format]),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      response.headers.get("content-disposition")!,
      new RegExp(`veriflow-${run.id}\\.${format}`),
    );
    assert.equal(
      response.headers.get("content-disposition")!.includes("untrusted"),
      false,
    );
    const text = await response.text();
    assert.equal(text, `fixture:${format}:1:failed`);
    const names = await readdir(join(root, "reports", run.id));
    const filename = names.find((name) => name.endsWith(`.${format}`))!;
    assert.equal(
      filename.startsWith(
        createHash("sha256").update(JSON.stringify(original)).digest("hex"),
      ),
      true,
    );
    assert.equal(
      await readFile(join(root, "reports", run.id, filename), "utf8"),
      text,
    );
  }
  assert.equal(received.length, 3);
  received.forEach((snapshot) => assert.deepEqual(snapshot, original));
  assert.deepEqual(
    (await (await http.reportGET(request(), project.id, run.id)).json())
      .snapshot,
    original,
  );
});

test("export preconditions reject active/cross-project runs, unsupported formats and missing adapters", async (t) => {
  const { root, project, run, store, http } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const format of ["", "pptx", "csv&format=pdf"])
    assert.equal(
      (await http.reportGET(request(format), project.id, run.id)).status,
      422,
    );
  const unavailable = await http.reportGET(request("pdf"), project.id, run.id);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, "adapter_unavailable");
  const other = await store.createProject({
    title: "Other",
    url: "https://example.org",
  });
  assert.equal(
    (await http.reportGET(request("csv"), other.id, run.id)).status,
    404,
  );
  const queued = await store.createRun(
    project.id,
    { workflowId: demoWorkflow.id, revision: 1 },
    "fake",
  );
  const active = await http.reportGET(
    request("csv"),
    project.id,
    queued.run.id,
  );
  assert.equal(active.status, 409);
  assert.equal((await active.json()).error.code, "run_not_finished");
});

test("renderer failures do not leak provider details or change observed outcomes", async (t) => {
  const { root, project, run, store, http } = await setup({
    render: async () => {
      throw new Error("private-provider-key and local-file-path");
    },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const response = await http.reportGET(request("pdf"), project.id, run.id);
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes("private-provider"), false);
  assert.equal((await store.getRun(project.id, run.id)).outcome, "failed");
});

test("invalid output is rejected and renderer input mutation cannot rewrite the snapshot", async (t) => {
  const received: ReportSnapshot[] = [];
  const renderer: ReportRenderer = {
    render: async (snapshot) => {
      received.push(structuredClone(snapshot));
      snapshot.run.outcome = "passed";
      return {
        bytes: new Uint8Array([1]),
        mediaType: "text/html",
        filename: "bad.html",
      };
    },
  };
  const { root, project, run, store, http } = await setup(renderer);
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(
    (await http.reportGET(request("pdf"), project.id, run.id)).status,
    500,
  );
  assert.equal((await store.report(project.id, run.id)).run.outcome, "failed");
  assert.deepEqual(await store.report(project.id, run.id), received[0]);
  await assert.rejects(readdir(join(root, "reports")), { code: "ENOENT" });
});

test("empty or oversized report buffers are rejected before storage", async (t) => {
  for (const size of [0, 25 * 1024 * 1024 + 1]) {
    const { root, project, run, http } = await setup({
      render: async () => ({
        bytes: new Uint8Array(size),
        mediaType: "application/pdf",
        filename: "fixture.pdf",
      }),
    });
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.equal(
      (await http.reportGET(request("pdf"), project.id, run.id)).status,
      500,
    );
    await assert.rejects(readdir(join(root, "reports")), { code: "ENOENT" });
  }
});

test("report storage cannot write through a symlink into another directory", async (t) => {
  const { root, project, run, http } = await setup(fixtureRenderer());
  const outside = await mkdtemp(join(tmpdir(), "veriflow-report-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  await symlink(outside, join(root, "reports"));
  const response = await http.reportGET(request("pdf"), project.id, run.id);
  assert.equal(response.status, 500);
  assert.deepEqual(await readdir(outside), []);
});
