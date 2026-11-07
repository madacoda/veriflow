import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import { workflowSchema } from "@veriflow/core";
import { createPlatform } from "../server/composition/platform.ts";
import { AgentError, type DraftProvider } from "../server/agent/index.ts";
import { errorResponse } from "../server/composition/http.ts";

const request = (body: unknown, signal?: AbortSignal) =>
  new Request("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  provider?: DraftProvider,
  timeoutMs?: number,
) {
  const root = await mkdtemp(join(tmpdir(), "veriflow-generation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = await createPlatform(root, undefined, "browser", {
    draftProvider: provider,
    generationTimeoutMs: timeoutMs,
  });
  const project = await platform.store.createProject({
    title: "Generation",
    url: demoProject.url,
  });
  return { ...platform, project };
}

test("HTTP generation delivers uploaded context and returns an editable draft without changing reviewed revisions or sources", async (t) => {
  let calls = 0;
  const provider: DraftProvider = {
    kind: "fixture",
    async generate(input) {
      calls++;
      assert.equal(input.project.id, project.id);
      assert.deepEqual(input.request.attachmentIds, [source.id, source.id]);
      assert.deepEqual(input.documents, [
        {
          kind: "text",
          attachmentId: source.id,
          text: "SAVE10 discounts the total to 90000.",
        },
      ]);
      assert.equal(input.templates[0].id, "functional-exact-total");
      return { ...demoWorkflow, name: "New draft" };
    },
  };
  const { store, attachments, http, project } = await setup(t, provider);
  const source = await attachments.upload(project.id, {
    filename: "requirement.md",
    mediaType: "text/markdown",
    bytes: new TextEncoder().encode("SAVE10 discounts the total to 90000."),
  });
  const saved = await store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const before = await attachments.read(project.id, source.id);
  const response = await http.generatePOST(
    request({
      objective: "Verify SAVE10",
      attachmentIds: [source.id, source.id],
      templateIds: ["functional-exact-total"],
    }),
    project.id,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { draft } = await response.json();
  assert.equal(calls, 1);
  assert.equal(draft.provider, "fixture");
  assert.deepEqual(draft.sourceAttachmentIds, [source.id]);
  assert.ok(draft.warnings.some((warning: string) => /fixture/i.test(warning)));
  draft.workflow.steps[0].url = "https://elsewhere.example";
  assert.deepEqual(await store.listWorkflows(project.id), [saved]);
  assert.deepEqual(await attachments.read(project.id, source.id), before);
  assert.deepEqual(await store.listRuns(project.id), []);
});

test("HTTP source failures and unknown templates reject before provider dispatch", async (t) => {
  let calls = 0;
  const { store, attachments, http, project } = await setup(t, {
    kind: "model",
    async generate() {
      calls++;
      return demoWorkflow;
    },
  });
  const other = await store.createProject({
    title: "Other",
    url: "https://example.org",
  });
  const foreign = await attachments.upload(other.id, {
    filename: "other.txt",
    mediaType: "text/plain",
    bytes: new TextEncoder().encode("Private other project"),
  });
  for (const id of [foreign.id, "missing"]) {
    const response = await http.generatePOST(
      request({ objective: "Check", attachmentIds: [id] }),
      project.id,
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "not_found");
  }
  const sources = [
    [
      "application/pdf",
      "source.pdf",
      new TextEncoder().encode("%PDF fixture"),
      415,
    ],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "source.docx",
      new Uint8Array([80, 75, 3, 4]),
      415,
    ],
    [
      "image/png",
      "source.png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      415,
    ],
    [
      "application/json",
      "source.json",
      new TextEncoder().encode("not json"),
      422,
    ],
    ["text/plain", "source.txt", new Uint8Array([255]), 422],
    ["text/plain", "empty.txt", new TextEncoder().encode("   \n  "), 422],
    [
      "text/plain",
      "long.txt",
      new TextEncoder().encode("x".repeat(100001)),
      422,
    ],
  ] as const;
  for (const [mediaType, filename, bytes, status] of sources) {
    const source = await attachments.upload(project.id, {
      filename,
      mediaType,
      bytes,
    });
    const response = await http.generatePOST(
      request({ objective: "Check", attachmentIds: [source.id] }),
      project.id,
    );
    assert.equal(response.status, status);
    assert.equal(
      (await store.getAttachment(project.id, source.id)).extraction.status,
      "pending",
    );
  }
  const template = await http.generatePOST(
    request({ objective: "Check", templateIds: ["missing"] }),
    project.id,
  );
  assert.equal(template.status, 422);
  assert.equal(calls, 0);
});

test("HTTP generation retains bounded input errors and explicit missing configuration", async (t) => {
  const { http, project, store } = await setup(t);
  const cases = [
    [
      new Request("http://localhost", { method: "POST", body: "{" }),
      400,
      "invalid_json",
    ],
    [request({ objective: "" }), 422, "validation_error"],
    [
      request({ objective: "Check", provider: "fixture" }),
      422,
      "validation_error",
    ],
    [request({ objective: "x".repeat(1024 * 1024) }), 413, "payload_too_large"],
    [request({ objective: "Check" }), 503, "adapter_unavailable"],
  ] as const;
  for (const [input, status, code] of cases) {
    const response = await http.generatePOST(input, project.id);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  assert.equal(
    (await http.generatePOST(request({ objective: "Check" }), "missing"))
      .status,
    404,
  );
  assert.deepEqual(await store.listWorkflows(project.id), []);
});

test("catalog HTTP returns versioned defensive snapshots and fixed safe error messages", async (t) => {
  const { http, project } = await setup(t, {
    kind: "model",
    async generate() {
      throw new Error("sensitive credential and provider details");
    },
  });
  const catalog = await (await http.templateCatalogGET()).json();
  assert.equal(catalog.templates[0].version, "1.0.0");
  catalog.templates[0].title = "Mutated";
  assert.notEqual(
    (await (await http.templateCatalogGET()).json()).templates[0].title,
    "Mutated",
  );
  const response = await http.generatePOST(
    request({ objective: "Check" }),
    project.id,
  );
  assert.equal(response.status, 500);
  assert.equal(
    JSON.stringify(await response.json()).includes("sensitive"),
    false,
  );
  const tampered = new AgentError("provider_failed");
  tampered.message = "sensitive override";
  assert.equal(
    (await errorResponse(tampered).json()).error.message,
    new AgentError("provider_failed").message,
  );
});

test("global catalog and project template drafts retain distinct contracts", async (t) => {
  const { http, project, store } = await setup(t);
  const catalog = await (await http.templateCatalogGET()).json();
  assert.equal(catalog.templates.length, 15);
  assert.equal(
    new Set(
      catalog.templates.map((item: { category: string }) => item.category),
    ).size,
    6,
  );
  const options = await (await http.templatesGET(project.id)).json();
  assert.equal(options.templates.length, 9);
  const responsive = options.templates.find(
    (item: { id: string }) => item.id === "responsive-viewports",
  );
  const response = await http.templatesPOST(
    request({
      templateId: responsive.id,
      parameters: responsive.defaults,
    }),
    project.id,
  );
  assert.equal(response.status, 200);
  const { workflow } = await response.json();
  assert.ok(
    workflow.steps.some((step: { code: string }) => step.code === "viewport"),
  );
  assert.equal((await http.templatesGET("missing")).status, 404);
  assert.deepEqual(await store.listWorkflows(project.id), []);
});

test("HTTP generation preserves main's prerequisite and outbound HTTP guards", async (t) => {
  let calls = 0;
  const { http, project } = await setup(t, {
    kind: "fixture",
    async generate() {
      calls++;
      return workflowSchema.parse({
        ...demoWorkflow,
        steps: [
          {
            id: "foreign-http",
            code: "assertHttp",
            url: "https://foreign.example/private",
            statuses: [200],
            timeoutMs: 1000,
          },
        ],
      });
    },
  });
  for (const templateId of [
    "requirements-acceptance",
    "compliance-checklist",
    "responsive-viewports",
  ]) {
    const response = await http.generatePOST(
      request({
        objective: "Check behavior",
        templateIds: [templateId],
      }),
      project.id,
    );
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
  const response = await http.generatePOST(
    request({ objective: "Check behavior" }),
    project.id,
  );
  assert.equal(response.status, 500);
  assert.equal(
    (await response.json()).error.message,
    "The provider returned an invalid workflow draft",
  );
  assert.equal(calls, 1);
});

test("pre-aborted generation performs no source reads or provider calls", async (t) => {
  let calls = 0;
  const platform = await setup(t, {
    kind: "model",
    async generate() {
      calls++;
      return demoWorkflow;
    },
  });
  platform.attachments.read = async () => {
    throw new Error("Should not read");
  };
  const controller = new AbortController();
  controller.abort(new Error("sensitive cancellation reason"));
  const response = await platform.http.generatePOST(
    request(
      { objective: "Check", attachmentIds: ["source"] },
      controller.signal,
    ),
    platform.project.id,
  );
  assert.equal(response.status, 500);
  assert.equal(
    (await response.json()).error.message,
    "The operation was cancelled",
  );
  assert.equal(calls, 0);
});

test(
  "abort during context read prevents subsequent sources and provider dispatch",
  { timeout: 5000 },
  async (t) => {
    let calls = 0,
      reads = 0;
    const entered = deferred(),
      release = deferred();
    t.after(async () => release.resolve());
    const platform = await setup(t, {
      kind: "model",
      async generate() {
        calls++;
        return demoWorkflow;
      },
    });
    const read = platform.attachments.read.bind(platform.attachments);
    const source = await platform.attachments.upload(platform.project.id, {
      filename: "source.txt",
      mediaType: "text/plain",
      bytes: new TextEncoder().encode("Requirement"),
    });
    platform.attachments.read = async (...args) => {
      reads++;
      entered.resolve();
      await release.promise;
      return read(...args);
    };
    const controller = new AbortController();
    const pending = platform.http.generatePOST(
      request(
        { objective: "Check", attachmentIds: [source.id, "later"] },
        controller.signal,
      ),
      platform.project.id,
    );
    await entered.promise;
    controller.abort(new Error("sensitive reason"));
    assert.equal((await pending).status, 500);
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 1);
    assert.equal(calls, 0);
  },
);

test(
  "abort during a noncooperative provider settles promptly and cannot save its late result",
  { timeout: 5000 },
  async (t) => {
    const entered = deferred(),
      release = deferred();
    t.after(async () => release.resolve());
    let providerSignal!: AbortSignal;
    const platform = await setup(t, {
      kind: "model",
      async generate(_input, signal) {
        providerSignal = signal;
        entered.resolve();
        await release.promise;
        return demoWorkflow;
      },
    });
    const controller = new AbortController();
    const pending = platform.http.generatePOST(
      request({ objective: "Check" }, controller.signal),
      platform.project.id,
    );
    await entered.promise;
    controller.abort(new Error("sensitive reason"));
    const response = await pending;
    assert.equal(response.status, 500);
    assert.equal(
      (await response.json()).error.message,
      "The operation was cancelled",
    );
    assert.equal(providerSignal.aborted, true);
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      await platform.store.listWorkflows(platform.project.id),
      [],
    );
  },
);

test(
  "one generation deadline includes a stalled streamed body and cancels its reader",
  { timeout: 5000 },
  async (t) => {
    let calls = 0,
      cancelled = false;
    const platform = await setup(
      t,
      {
        kind: "model",
        async generate() {
          calls++;
          return demoWorkflow;
        },
      },
      1000,
    );
    const input = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit);
    const response = await platform.http.generatePOST(
      input,
      platform.project.id,
    );
    assert.equal(response.status, 500);
    assert.equal(
      (await response.json()).error.message,
      "The operation exceeded its time limit",
    );
    assert.equal(cancelled, true);
    assert.equal(calls, 0);
  },
);

test(
  "stream overflow returns 413 and unlocks the body without waiting for source cancellation",
  { timeout: 5000 },
  async (t) => {
    const release = deferred();
    t.after(async () => release.resolve());
    let cancelled = false;
    const platform = await setup(t);
    const input = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
          return release.promise;
        },
      }),
      duplex: "half",
    } as RequestInit);
    const response = await platform.http.generatePOST(
      input,
      platform.project.id,
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "payload_too_large");
    assert.equal(cancelled, true);
    assert.equal(input.body?.locked, false);
  },
);
