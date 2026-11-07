import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import { createRuntimePlatform } from "../server/composition/platform.ts";

// Local OpenAI-compatible HTTP fixture; never reads real credentials or calls a model.
test("runtime generation refreshes trusted provider configuration without recreating the platform", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-runtime-generation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const received: {
    authorization?: string;
    path?: string;
    body: Record<string, unknown>;
  }[] = [];
  let upstreamStatus = 200;
  let output: unknown = demoWorkflow;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      authorization: request.headers.authorization,
      path: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    response.writeHead(upstreamStatus, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify(
        upstreamStatus === 200
          ? {
              id: "local-http-fixture",
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: JSON.stringify(output),
                  },
                },
              ],
            }
          : { error: { message: "PRIVATE UPSTREAM DIAGNOSTIC" } },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    STORAGE_DIR: root,
    VERIFLOW_RUN_ADAPTER: "fake",
    OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  };
  const { http, store } = await createRuntimePlatform(env);
  const project = await store.createProject({
    title: "Runtime fixture",
    url: demoProject.url,
  });
  const generate = () =>
    http.generatePOST(
      new Request("http://localhost/generate", {
        method: "POST",
        body: JSON.stringify({ objective: "Check SAVE10" }),
      }),
      project.id,
    );
  const unavailable = async () => {
    const response = await generate();
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json()).error, {
      code: "adapter_unavailable",
      message: "A generation provider is not configured",
    });
    assert.equal((await http.projectsGET()).status, 200);
  };
  await unavailable();
  env.OPENAI_API_KEY = "fixture-key";
  await unavailable(); // No silent default model or fixture fallback.
  env.OPENAI_MODEL = "bad model";
  await unavailable();
  env.OPENAI_MODEL = "fixture-model";
  const endpoint = env.OPENAI_BASE_URL;
  env.OPENAI_BASE_URL = "http://untrusted.example/v1";
  await unavailable();
  assert.equal(received.length, 0);
  env.OPENAI_BASE_URL = endpoint;
  const response = await generate();
  assert.equal(response.status, 200);
  const { draft } = await response.json();
  assert.equal(draft.provider, "model"); // Real SDK path, fixture HTTP response.
  assert.deepEqual(draft.workflow, demoWorkflow);
  assert.deepEqual(draft.sourceAttachmentIds, []);
  assert.equal(received[0].path, "/v1/chat/completions");
  assert.equal(received[0].authorization, "Bearer fixture-key");
  assert.equal(received[0].body.model, "fixture-model");
  assert.equal(received[0].body.store, false);

  env.OPENAI_API_KEY = "rotated-fixture-key";
  env.OPENAI_MODEL = "rotated-fixture-model";
  assert.equal((await generate()).status, 200);
  assert.equal(received[1].authorization, "Bearer rotated-fixture-key");
  assert.equal(received[1].body.model, "rotated-fixture-model");
  delete env.OPENAI_API_KEY;
  await unavailable();
  assert.equal(received.length, 2);
  env.OPENAI_API_KEY = "fixture-key";
  upstreamStatus = 401;
  const rejected = await generate();
  assert.equal(rejected.status, 500);
  assert.deepEqual((await rejected.json()).error, {
    code: "internal_error",
    message: "The provider request failed",
  });
  assert.equal(received.length, 3); // No retry on authentication failure.
  upstreamStatus = 200;
  output = {
    ...demoWorkflow,
    steps: [
      { id: "escape", code: "redirect", url: "https://elsewhere.example" },
    ],
  };
  assert.equal((await generate()).status, 500);
  assert.deepEqual(await store.listWorkflows(project.id), []);
  assert.deepEqual(await store.listRuns(project.id), []);
});
