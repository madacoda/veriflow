import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAX_ATTACHMENT_BYTES, type AttachmentMetadata } from "@veriflow/core";
import { demoWorkflow } from "@veriflow/core/fixtures";
import { createPlatform } from "../server/composition/platform.ts";
import { PlatformStore } from "../server/projects/platform-store.ts";
import { AttachmentStore } from "../server/attachments/store.ts";

function uploadRequest(file: File) {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/projects/p/attachments", {
    method: "POST",
    body: form,
  });
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "veriflow-attachments-"));
  const platform = await createPlatform(root);
  const project = await platform.store.createProject({
    title: "Requirements",
    url: "https://example.com",
  });
  return { root, project, ...platform };
}

test("multipart uploads persist pending metadata and exact bytes across reopening", async (t) => {
  const { root, project, http } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const response = await http.attachmentsPOST(
    uploadRequest(
      new File(["SAVE10 reduces total by 10%."], "persyaratan-é.md", {
        type: "text/markdown",
      }),
    ),
    project.id,
  );
  assert.equal(response.status, 201);
  const { attachment } = await response.json();
  assert.equal(attachment.projectId, project.id);
  assert.deepEqual(attachment.extraction, { status: "pending" });
  assert.equal(JSON.stringify(attachment).includes(root), false);
  const reopened = await createPlatform(root);
  assert.deepEqual(
    (await (await reopened.http.attachmentsGET(project.id)).json()).attachments,
    [attachment],
  );
  assert.deepEqual(
    (
      await (
        await reopened.http.attachmentGET(project.id, attachment.id)
      ).json()
    ).attachment,
    attachment,
  );
  const content = await reopened.http.attachmentContentGET(
    project.id,
    attachment.id,
  );
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "text/markdown");
  assert.match(
    content.headers.get("content-disposition")!,
    /filename\*=UTF-8''persyaratan-%C3%A9.md/,
  );
  assert.equal(content.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await content.text(), "SAVE10 reduces total by 10%.");
  const read = await reopened.attachments.read(project.id, attachment.id);
  read.bytes.fill(0);
  assert.equal(
    Buffer.from(
      (await reopened.attachments.read(project.id, attachment.id)).bytes,
    ).toString(),
    "SAVE10 reduces total by 10%.",
  );
});

test("attachment metadata and bytes are project-scoped and only registered IDs resolve", async (t) => {
  const { root, project, http, store, attachments } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const other = await store.createProject({
    title: "Other",
    url: "https://example.org",
  });
  const attachment = await attachments.upload(project.id, {
    filename: "story.txt",
    mediaType: "text/plain",
    bytes: new TextEncoder().encode("A requirement"),
  });
  for (const response of [
    await http.attachmentGET(other.id, attachment.id),
    await http.attachmentContentGET(other.id, attachment.id),
    await http.attachmentContentGET(project.id, "../platform-v1.json"),
  ]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "not_found");
  }
  assert.deepEqual(await store.listAttachments(other.id), []);
  await assert.rejects(attachments.read(other.id, attachment.id), /not found/);
});

test("upload input errors reject unsupported, empty, oversized and path-like files without metadata", async (t) => {
  const { root, project, http, store, attachments } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    [
      new File(["zip"], "archive.zip", { type: "application/zip" }),
      415,
      "unsupported_format",
    ],
    [
      new File([], "empty.txt", { type: "text/plain" }),
      422,
      "validation_error",
    ],
    [
      new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.txt", {
        type: "text/plain",
      }),
      413,
      "payload_too_large",
    ],
  ] as const;
  for (const [file, status, code] of cases) {
    const response = await http.attachmentsPOST(
      uploadRequest(file),
      project.id,
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  await assert.rejects(
    attachments.upload(project.id, {
      filename: "../escape.md",
      mediaType: "text/markdown",
      bytes: new Uint8Array([1]),
    }),
    /filename/,
  );
  assert.deepEqual(await store.listAttachments(project.id), []);
});

test("multipart shape, malformed boundaries and streamed limits are enforced", async (t) => {
  const { root, project, http, store } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const invalidForms = [new FormData(), new FormData(), new FormData()];
  invalidForms[0].set("file", "not a file");
  invalidForms[1].append(
    "file",
    new File(["a"], "a.txt", { type: "text/plain" }),
  );
  invalidForms[1].append(
    "file",
    new File(["b"], "b.txt", { type: "text/plain" }),
  );
  invalidForms[2].append(
    "file",
    new File(["a"], "a.txt", { type: "text/plain" }),
  );
  invalidForms[2].set("projectId", "spoofed");
  for (const form of invalidForms)
    assert.equal(
      (
        await http.attachmentsPOST(
          new Request("http://localhost", { method: "POST", body: form }),
          project.id,
        )
      ).status,
      422,
    );
  assert.equal(
    (
      await http.attachmentsPOST(
        new Request("http://localhost", {
          method: "POST",
          body: "not multipart",
        }),
        project.id,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await http.attachmentsPOST(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "multipart/form-data; boundary=missing" },
          body: "broken",
        }),
        project.id,
      )
    ).status,
    422,
  );
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_ATTACHMENT_BYTES + 65537));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=test" },
    body,
    duplex: "half",
  } as RequestInit);
  assert.equal(streamed.headers.has("content-length"), false);
  assert.equal((await http.attachmentsPOST(streamed, project.id)).status, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(await store.listAttachments(project.id), []);
});

test("legacy P1 metadata migrates additively while retaining projects and revisions", async (t) => {
  const { root, project, store } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  await store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const filename = join(root, "platform-v1.json");
  const legacy = JSON.parse(await readFile(filename, "utf8"));
  delete legacy.attachments;
  await writeFile(filename, JSON.stringify(legacy));
  const reopened = await createPlatform(root);
  assert.deepEqual(
    await reopened.store.getProject(project.id),
    legacy.projects[0],
  );
  assert.equal(
    (await reopened.store.getWorkflow(project.id, demoWorkflow.id)).revision,
    1,
  );
  assert.deepEqual(await reopened.store.listAttachments(project.id), []);
  await reopened.attachments.upload(project.id, {
    filename: "new.md",
    mediaType: "text/markdown",
    bytes: new TextEncoder().encode("New requirement"),
  });
  assert.equal((await reopened.store.listProjects()).length, 1);
  assert.equal((await reopened.store.listAttachments(project.id)).length, 1);
});

test("metadata registration failure removes the newly written unregistered object", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  class FailingStore extends PlatformStore {
    override async registerAttachment(
      _input: AttachmentMetadata,
    ): Promise<AttachmentMetadata> {
      throw new Error("Metadata unavailable");
    }
  }
  const platform = new FailingStore(root);
  const project = await platform.createProject({
    title: "Rollback",
    url: "https://example.com",
  });
  await assert.rejects(
    new AttachmentStore(platform).upload(project.id, {
      filename: "data.txt",
      mediaType: "text/plain",
      bytes: new Uint8Array([1]),
    }),
    /unavailable/,
  );
  assert.deepEqual(await readdir(join(root, "attachments", project.id)), []);
  assert.deepEqual(await platform.listAttachments(project.id), []);
});

test("symlink aliases and mismatched stored sizes cannot expose other content", async (t) => {
  const { root, project, http, attachments } = await setup();
  const outside = await mkdtemp(join(tmpdir(), "veriflow-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  const attachment = await attachments.upload(project.id, {
    filename: "safe.txt",
    mediaType: "text/plain",
    bytes: new Uint8Array([1, 2]),
  });
  const blob = join(root, "attachments", project.id, `${attachment.id}.bin`);
  await writeFile(blob, new Uint8Array([1]));
  assert.equal(
    (await http.attachmentContentGET(project.id, attachment.id)).status,
    500,
  );
  const secret = join(outside, "private.txt");
  await writeFile(secret, "must not be disclosed");
  await unlink(blob);
  await symlink(secret, blob);
  const response = await http.attachmentContentGET(project.id, attachment.id);
  assert.equal(response.status, 500);
  assert.equal(
    (await response.text()).includes("must not be disclosed"),
    false,
  );
  await mkdir(join(outside, "uploads"));
  await rm(join(root, "attachments"), { recursive: true });
  await symlink(join(outside, "uploads"), join(root, "attachments"));
  assert.equal(
    (
      await http.attachmentsPOST(
        uploadRequest(new File(["hello"], "safe.txt", { type: "text/plain" })),
        project.id,
      )
    ).status,
    500,
  );
  assert.deepEqual(await readdir(join(outside, "uploads")), []);
});

test("extraction status changes persist without modifying source bytes", async (t) => {
  const { root, project, store, attachments } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const attachment = await attachments.upload(project.id, {
    filename: "story.txt",
    mediaType: "text/plain",
    bytes: new TextEncoder().encode("Source"),
  });
  await store.setAttachmentExtraction(project.id, attachment.id, {
    status: "failed",
    code: "unsupported_format",
    message: "Extractor fixture does not support this input",
  });
  const read = await new AttachmentStore(new PlatformStore(root)).read(
    project.id,
    attachment.id,
  );
  assert.equal(read.metadata.extraction.status, "failed");
  assert.equal(Buffer.from(read.bytes).toString(), "Source");
});
