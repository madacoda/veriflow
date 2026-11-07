import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow, translateWorkflow } from "@veriflow/core";
import { FakeSessionFactory } from "../src/testing.js";

const workflow = {
  schemaVersion: "1",
  id: "fixture",
  name: "Fixture",
  steps: [
    { id: "open", code: "redirect", url: "https://example.com" },
    {
      id: "verify",
      code: "assert",
      target: { by: "label", value: "Terms" },
      expectation: { kind: "checked", value: true },
    },
  ],
};
const options = { runId: "run-1", allowedOrigins: ["https://example.com"] };

test("isolates sessions, translates assertions and closes every run", async () => {
  const factory = new FakeSessionFactory();
  const signal = new AbortController().signal;
  assert.equal(
    (await runWorkflow(workflow, options, factory, signal)).status,
    "passed",
  );
  await runWorkflow(workflow, { ...options, runId: "run-2" }, factory, signal);
  assert.equal(factory.sessions.length, 2);
  assert.ok(factory.sessions.every((session) => session.closed));
  assert.equal(translateWorkflow(workflow).commands[1].action, "assert");
  await factory.sessions[0].close();
});
test("failed steps block later execution", async () => {
  const factory = new FakeSessionFactory({
    open: { stepId: "open", status: "failed", reason: "Fixture failure" },
  });
  const result = await runWorkflow(
    workflow,
    options,
    factory,
    new AbortController().signal,
  );
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ["failed", "blocked"],
  );
  assert.equal(factory.sessions[0].commands.length, 1);
  assert.equal(factory.sessions[0].closed, true);
});
test("pre-cancelled runs do not allocate sessions", async () => {
  const factory = new FakeSessionFactory();
  await assert.rejects(
    runWorkflow(workflow, options, factory, AbortSignal.abort()),
  );
  assert.equal(factory.sessions.length, 0);
});
test("adapter exceptions still close the session", async () => {
  let closed = false;
  const result = await runWorkflow(
    workflow,
    options,
    {
      open: async () => ({
        execute: async () => {
          throw new Error("adapter failure");
        },
        evidence: async () => [],
        close: async () => {
          closed = true;
        },
      }),
    },
    new AbortController().signal,
  );
  assert.equal(result.status, "failed");
  assert.equal(closed, true);
});
test("cancellation during a step blocks remaining steps and closes session", async () => {
  const controller = new AbortController();
  let closed = false;
  const result = await runWorkflow(
    workflow,
    options,
    {
      open: async () => ({
        execute: async () => {
          controller.abort();
          throw controller.signal.reason;
        },
        evidence: async () => [],
        close: async () => {
          closed = true;
        },
      }),
    },
    controller.signal,
  );
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ["blocked", "blocked"],
  );
  assert.equal(closed, true);
});
