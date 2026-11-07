import assert from "node:assert/strict";
import { test } from "node:test";
import {
  demoContext,
  demoProject,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import { workflowSchema } from "@veriflow/core";
import {
  AgentError,
  createDraftGenerator,
  createOpenAIDraftProvider,
  createOpenAIAgentTurn,
  runAgentLoop,
} from "../server/agent/index.ts";
import { createFixtureTools } from "../server/agent/fixtures.ts";
import type { OpenAIProviderOptions } from "../server/agent/openai.ts";

// Explicit HTTP fixtures. No environment credential is read and no network request is made.
const task = () => ({
  project: structuredClone(demoProject),
  request: {
    objective: "Verify SAVE10 gives total 90000",
    attachmentIds: [demoContext.attachmentId],
    templateIds: ["functional-exact-total"],
  },
  documents: [structuredClone(demoContext)],
});
const active = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;
const message = (value: unknown = demoWorkflow) => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: [
    {
      type: "output_text",
      text: typeof value === "string" ? value : JSON.stringify(value),
      annotations: [],
    },
  ],
});
const call = (name: string, args: unknown) => ({
  type: "function_call",
  call_id: "fixture-call",
  name,
  arguments: JSON.stringify(args),
});
const response = (...output: unknown[]) => ({
  id: "fixture-response",
  object: "response",
  status: "completed",
  output,
});
function transport(responses: unknown[], status = 200) {
  const requests: Record<string, unknown>[] = [];
  const options: OpenAIProviderOptions = {
    apiKey: "fixture-credential-not-a-real-key",
    model: "fixture-model",
    fetch: async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(init?.redirect, "error");
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify(
          responses[Math.min(requests.length - 1, responses.length - 1)],
        ),
        {
          status,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  };
  return { options, requests };
}

test("OpenAI HTTP fixture returns a validated editable draft with model provenance and derived strict schema", async () => {
  const http = transport([response(message())]);
  const draft = await createDraftGenerator({
    provider: createOpenAIDraftProvider(http.options),
  }).generate(task(), active());
  workflowSchema.parse(draft.workflow);
  assert.equal(draft.provider, "model");
  assert.deepEqual(draft.sourceAttachmentIds, [demoContext.attachmentId]);
  assert.match(draft.warnings[0], /Review/);
  draft.workflow.name = "Edited";
  assert.equal(demoWorkflow.name, "Discount updates total");
  const body = http.requests[0];
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 4096);
  assert.equal(body.model, "fixture-model");
  const format = (body.text as { format: Record<string, unknown> }).format;
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert(!JSON.stringify(format).includes('"format":"uri"'));
  const user = (body.input as { role: string; content: string }[])[0];
  assert.equal(user.role, "user");
  const data = JSON.parse(user.content);
  assert.equal(data.documents[0].attachmentId, demoContext.attachmentId);
  assert.equal(data.templates[0].version, "1.0.0");
  assert(!JSON.stringify(body).includes(http.options.apiKey!));
});

for (const [name, value] of Object.entries({
  refusal: response({
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "refusal", refusal: "private provider detail" }],
  }),
  incomplete: {
    ...response(message()),
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  },
  failed: {
    ...response(message()),
    status: "failed",
    error: { message: "private detail" },
  },
  empty: response(),
  multipleMessages: response(message(), message()),
  malformedJson: response(message("{broken")),
  extraWorkflowFields: response(
    message({ ...demoWorkflow, provider: "fixture" }),
  ),
  oversized: response(message("x".repeat(200_001))),
})) {
  test(`OpenAI HTTP fixture rejects ${name} without a fake fallback`, async () => {
    const http = transport([value]);
    await assert.rejects(
      createDraftGenerator({
        provider: createOpenAIDraftProvider(http.options),
      }).generate(task(), active()),
      (error: unknown) =>
        error instanceof AgentError &&
        ["provider_failed", "invalid_provider_output"].includes(error.code) &&
        !error.message.includes("private"),
    );
    assert.equal(http.requests.length, 1);
  });
}

test("OpenAI configuration is explicit, bounded, and independent of environment defaults", () => {
  for (const options of [
    {},
    { apiKey: "fixture" },
    { model: "fixture-model" },
    { apiKey: "", model: "fixture-model" },
  ])
    assert.throws(
      () => createOpenAIDraftProvider(options),
      code("adapter_unavailable"),
    );
  for (const limits of [
    { timeoutMs: 0 },
    { timeoutMs: 120001 },
    { maxOutputTokens: 0 },
    { maxOutputTokens: 8193 },
  ])
    assert.throws(
      () =>
        createOpenAIDraftProvider({
          apiKey: "fixture",
          model: "fixture-model",
          ...limits,
        }),
      code("validation_error"),
    );
});

for (const status of [401, 429, 500]) {
  test(`OpenAI HTTP ${status} is safe and never retried`, async () => {
    const http = transport(
      [
        {
          error: {
            message: "fixture-credential-not-a-real-key private detail",
            code: "fixture_error",
          },
        },
      ],
      status,
    );
    const provider = createOpenAIDraftProvider(http.options);
    await assert.rejects(
      provider.generate({ ...task(), templates: [] }, active()),
      (error: unknown) =>
        code("provider_failed")(error) &&
        !(error as Error).message.includes("private") &&
        !(error as Error).cause,
    );
    assert.equal(http.requests.length, 1);
  });
}

test("OpenAI context overflow and unsupported images fail before HTTP dispatch", async () => {
  const http = transport([response(message())]);
  const input = task();
  input.documents = [0, 1, 2].map((n) => ({
    kind: "text",
    attachmentId: "source-" + n,
    text: "x".repeat(100000),
  }));
  input.request.attachmentIds = input.documents.map((d) => d.attachmentId);
  await assert.rejects(
    createOpenAIDraftProvider(http.options).generate(
      { ...input, templates: [] },
      active(),
    ),
    code("validation_error"),
  );
  const image = {
    ...task(),
    documents: [
      {
        kind: "image" as const,
        attachmentId: demoContext.attachmentId,
        mediaType: "image/png" as const,
      },
    ],
  };
  assert.throws(
    () => createOpenAIAgentTurn(http.options, image),
    code("unsupported_format"),
  );
  assert.equal(http.requests.length, 0);
});

test(
  "OpenAI HTTP cancellation and deadline abort the transport without retries",
  { timeout: 5000 },
  async () => {
    for (const mode of ["cancel", "deadline"]) {
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let aborted = false;
      let dispatched = false;
      const options: OpenAIProviderOptions = {
        apiKey: "fixture",
        model: "fixture-model",
        timeoutMs: mode === "deadline" ? 30 : 120000,
        fetch: async (_url, init) => {
          dispatched = true;
          started();
          return new Promise((_resolve, reject) => {
            const onAbort = () => {
              aborted = true;
              reject(new Error("private transport detail"));
            };
            if (init?.signal?.aborted) onAbort();
            else
              init?.signal?.addEventListener("abort", onAbort, { once: true });
          });
        },
      };
      const controller = new AbortController();
      const operation = createOpenAIDraftProvider(options).generate(
        { ...task(), templates: [] },
        controller.signal,
      );
      const rejected = assert.rejects(
        operation,
        code(mode === "cancel" ? "cancelled" : "timeout"),
      );
      if (mode === "cancel") {
        await ready;
        controller.abort();
      }
      await rejected;
      // A tight deadline can expire before HTTP allocation on a loaded runner.
      if (dispatched) assert.equal(aborted, true);
    }
  },
);

for (const [name, item] of Object.entries({
  unknown: call("evaluate", { script: "forbidden" }),
  malformed: { ...call("observe", {}), arguments: "{" },
  override: call("observe", { tool: "execute", step: demoWorkflow.steps[0] }),
  extra: call("observe", { maxCharacters: 1000, script: "forbidden" }),
  forgedOutcome: call("finish", { outcome: "passed" }),
  invalidStep: call("execute", { step: { id: "eval", code: "eval" } }),
  credentials: call("execute", {
    step: {
      id: "open",
      code: "redirect",
      url: "https://user:secret@example.com",
    },
  }),
  origin: call("execute", {
    step: { id: "open", code: "redirect", url: "https://elsewhere.example" },
  }),
})) {
  test(`OpenAI tool argument fixture rejects ${name}`, async () => {
    const http = transport([response(item)]);
    await assert.rejects(
      createOpenAIAgentTurn(http.options, task())([], active()),
      code("invalid_tool_call"),
    );
  });
}

test("OpenAI parallel calls are rejected and cannot dispatch browser actions", async () => {
  const http = transport([
    response(
      call("observe", {}),
      call("execute", { step: demoWorkflow.steps[0] }),
    ),
  ]);
  const tools = createFixtureTools();
  await assert.rejects(
    runAgentLoop(
      { next: createOpenAIAgentTurn(http.options, task()), tools: tools.port },
      active(),
    ),
    code("provider_failed"),
  );
  assert.equal(tools.commands.length, 0);
  assert.equal(http.requests[0].parallel_tool_calls, false);
  assert.equal(http.requests[0].tool_choice, "required");
});

test("OpenAI decisions use shared dispatch and cannot override a failed assertion", async () => {
  const http = transport([
    ...demoWorkflow.steps.map((step) => response(call("execute", { step }))),
    response(call("finish", {})),
  ]);
  const tools = createFixtureTools("100000");
  const result = await runAgentLoop(
    { next: createOpenAIAgentTurn(http.options, task()), tools: tools.port },
    active(),
  );
  assert.equal(result.steps.at(-1)?.status, "failed");
  assert.equal(result.steps.at(-1)?.actual, "100000");
  assert.equal(http.requests.length, demoWorkflow.steps.length);
  assert.equal(tools.commands.length, demoWorkflow.steps.length);
  const data = JSON.parse(
    (http.requests[1].input as { content: string }[])[0].content,
  );
  assert.equal(data.history[0].result.status, "passed");
});

test("OpenAI repeated observations obey the whole-loop call limit", async () => {
  const http = transport([response(call("observe", { maxCharacters: 1000 }))]);
  const tools = createFixtureTools();
  let observations = 0;
  const port = {
    ...tools.port,
    observe: async (n: number, s: AbortSignal) => {
      observations++;
      return tools.port.observe(n, s);
    },
  };
  await assert.rejects(
    runAgentLoop(
      {
        next: createOpenAIAgentTurn(http.options, task()),
        tools: port,
        maxCalls: 1,
      },
      active(),
    ),
    code("call_limit_exceeded"),
  );
  assert.equal(observations, 1);
  assert.equal(http.requests.length, 2);
});

test("OpenAI finish is only a stop decision and a new turn has isolated input", async () => {
  const http = transport([response(call("finish", {}))]);
  const input = task();
  const next = createOpenAIAgentTurn(http.options, input);
  input.request.objective = "Changed later";
  assert.deepEqual(await next([], active()), { kind: "done" });
  const data = JSON.parse(
    (http.requests[0].input as { content: string }[])[0].content,
  );
  assert.equal(data.task.request.objective, "Verify SAVE10 gives total 90000");
});
