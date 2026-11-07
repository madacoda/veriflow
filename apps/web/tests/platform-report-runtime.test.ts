import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import { createRuntimePlatform } from "../server/composition/platform.ts";

// The execution adapter is an explicit fake; PDF rendering and storage are real.
test("runtime PDF export downloads the pinned report and preserves CSV and JSON", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-runtime-pdf-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { http, store, coordinator } = await createRuntimePlatform({
    STORAGE_DIR: root,
    VERIFLOW_RUN_ADAPTER: "fake",
    VERIFLOW_FAKE_OUTCOME: "failed",
  });
  const project = await store.createProject({
    title: "PDF export fixture",
    url: demoProject.url,
  });
  await store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const run = await coordinator.start(project.id, {
    workflowId: demoWorkflow.id,
    revision: 1,
  });
  await coordinator.wait(run.id);
  const snapshot = await store.report(project.id, run.id);
  await store.saveWorkflow(project.id, {
    workflow: { ...demoWorkflow, name: "Later edit excluded from report" },
    expectedRevision: 1,
  });

  const download = (format?: string, projectId = project.id, runId = run.id) =>
    http.reportGET(
      new Request(
        `http://localhost/report${format ? `?format=${format}` : ""}`,
      ),
      projectId,
      runId,
    );
  const response = await download("pdf");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="veriflow-${run.id}.pdf"; filename*=UTF-8''veriflow-${run.id}.pdf`,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.match(new TextDecoder().decode(bytes.slice(0, 8)), /^%PDF-1\./);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    const text = pages.join(" ");
    assert.ok(text.includes(project.title));
    assert.ok(text.includes(demoWorkflow.name));
    assert.ok(text.includes(run.id));
    assert.match(text, /failed/i);
    assert.match(text, /fake|fixture/i);
    assert.doesNotMatch(text, /Later edit excluded/);
  } finally {
    await task.destroy();
  }
  const reportFiles = await readdir(join(root, "reports", run.id));
  assert.equal(reportFiles.length, 1);
  assert.ok(reportFiles[0].endsWith(".pdf"));
  assert.deepEqual(
    new Uint8Array(
      await readFile(join(root, "reports", run.id, reportFiles[0])),
    ),
    bytes,
  );
  assert.deepEqual((await (await download()).json()).snapshot, snapshot);
  const csv = await download("csv");
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Discount updates total/);
  const xlsx = await download("xlsx");
  assert.equal(xlsx.status, 422);
  assert.equal((await xlsx.json()).error.code, "unsupported_format");
  const other = await store.createProject({
    title: "Other",
    url: demoProject.url,
  });
  assert.equal((await download("pdf", other.id)).status, 404);
  const queued = await store.createRun(
    project.id,
    {
      workflowId: demoWorkflow.id,
      revision: 2,
    },
    "fake",
  );
  assert.equal((await download("pdf", project.id, queued.run.id)).status, 409);
  assert.deepEqual(await store.report(project.id, run.id), snapshot);
});
