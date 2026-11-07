import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReport } from "@veriflow/core/fixtures";
import {
  AgentError,
  createFailureSummarizer,
  createOpenAISummaryProvider,
} from "../server/agent/index.ts";
import type { OpenAIProviderOptions } from "../server/agent/openai.ts";

// HTTP fixtures only: no credential is read and no network request is made.
const output = () => ({
  analyses: [
    {
      stepIds: ["total"],
      evidenceIds: [demoReport.run.evidence.artifacts[0].id],
      hypothesis: "The discount may not have been applied.",
      nextCheck: "Inspect the coupon action calculation.",
    },
  ],
});
const response = (content: unknown = output()) => ({
  id: "fixture-response",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content:
          typeof content === "string" ? content : JSON.stringify(content),
      },
    },
  ],
});
const active = () => new AbortController().signal;
function transport(body: unknown = response(), status = 200) {
  const requests: Record<string, unknown>[] = [];
  const options: OpenAIProviderOptions = {
    apiKey: "fixture-credential-not-a-real-key",
    model: "fixture-model",
    fetch: async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
      assert.equal(init?.redirect, "error");
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  return { options, requests };
}
const summarize = (options: OpenAIProviderOptions) =>
  createFailureSummarizer({
    provider: createOpenAISummaryProvider(options),
  }).summarize(structuredClone(demoReport), active());

test("OpenAI summary HTTP fixture receives only projected observations and returns trusted model provenance", async () => {
  const http = transport();
  const before = structuredClone(demoReport);
  const summary = await summarize(http.options);
  assert.equal(summary.provider, "model");
  assert.match(summary.text, /recorded outcome: failed/);
  assert.match(
    summary.text,
    /AI interpretation; hypotheses and suggested checks are unverified/,
  );
  assert.deepEqual(demoReport, before);
  assert.equal(http.requests.length, 1);
  const body = http.requests[0];
  assert.equal(body.store, false);
  assert.equal(body.n, 1);
  assert.equal(body.max_completion_tokens, 4096);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.tools, undefined);
  const messages = body.messages as { role: string; content: string }[];
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /untrusted data/);
  const input = JSON.parse(messages[1].content);
  assert.equal(input.runId, demoReport.run.id);
  assert.equal(input.steps[0].expected, "90000");
  assert.equal(input.steps[0].actual, "100000");
  assert.equal(input.steps.length, 1);
  assert.equal(input.evidence[0].id, demoReport.run.evidence.artifacts[0].id);
  assert.doesNotMatch(
    JSON.stringify(body),
    /fixture-credential|artifactPath|SAVE10|127\.0\.0\.1/,
  );
});

for (const [name, value] of Object.entries({
  malformedJson: response("{broken"),
  invalidReferences: response({
    analyses: [
      { ...output().analyses[0], evidenceIds: ["another-run-evidence"] },
    ],
  }),
  forgedOutcome: response({ ...output(), outcome: "passed" }),
  refused: {
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: null,
          refusal: "private provider reason",
        },
      },
    ],
  },
  truncated: {
    choices: [
      {
        finish_reason: "length",
        message: { role: "assistant", content: JSON.stringify(output()) },
      },
    ],
  },
  unsolicitedTool: {
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify(output()),
          tool_calls: [{ id: "unexpected" }],
        },
      },
    ],
  },
  multipleChoices: { choices: [...response().choices, ...response().choices] },
  oversized: response("x".repeat(16_001)),
})) {
  test(`OpenAI summary HTTP fixture rejects ${name}`, async () => {
    const http = transport(value);
    await assert.rejects(
      summarize(http.options),
      (error: unknown) =>
        error instanceof AgentError &&
        ["provider_failed", "invalid_summary_output"].includes(error.code),
    );
    assert.equal(http.requests.length, 1);
  });
}

for (const status of [401, 429, 500]) {
  test(`OpenAI summary HTTP ${status} is safe and never retried`, async () => {
    const http = transport(
      { error: { message: "fixture-credential private-body" } },
      status,
    );
    await assert.rejects(summarize(http.options), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "provider_failed");
      assert.doesNotMatch(error.message, /private|credential/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(http.requests.length, 1);
  });
}

test("summary provider requires explicit model/key configuration", () => {
  for (const options of [
    {},
    { apiKey: "fixture" },
    { model: "fixture-model" },
  ]) {
    assert.throws(
      () => createOpenAISummaryProvider(options),
      (error: unknown) =>
        error instanceof AgentError && error.code === "adapter_unavailable",
    );
  }
});

test("invalid summary input is rejected before HTTP and HTTP cancellation reaches the transport", async () => {
  const http = transport();
  const bad = structuredClone(demoReport);
  bad.run.projectId = "another-project";
  await assert.rejects(
    createFailureSummarizer({
      provider: createOpenAISummaryProvider(http.options),
    }).summarize(bad, active()),
  );
  assert.equal(http.requests.length, 0);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let transportSignal: AbortSignal | null | undefined;
  const provider = createOpenAISummaryProvider({
    ...http.options,
    fetch: async (_url, init) => {
      transportSignal = init?.signal;
      started();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error("Fixture transport aborted"));
        if (transportSignal?.aborted) abort();
        else transportSignal?.addEventListener("abort", abort, { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = createFailureSummarizer({ provider }).summarize(
    demoReport,
    controller.signal,
  );
  await ready;
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof AgentError && error.code === "cancelled",
  );
  assert.equal(transportSignal?.aborted, true);
});
