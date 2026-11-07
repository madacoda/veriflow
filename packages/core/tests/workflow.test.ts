import assert from "node:assert/strict";
import { test } from "node:test";
import { translateWorkflow } from "../src/index.js";

const workflow = {
  schemaVersion: "1",
  id: "example",
  name: "Form workflow",
  steps: [
    { id: "open", code: "redirect", url: "https://example.com" },
    {
      id: "name",
      code: "fill",
      target: { by: "label", value: "Name" },
      value: "",
    },
    { id: "accept", code: "check", target: { by: "testId", value: "terms" } },
    {
      id: "decline",
      code: "uncheck",
      target: { by: "testId", value: "marketing" },
      timeoutMs: 1000,
    },
  ],
};

test("translation preserves order, step identity, values and checkbox intent", () => {
  const original = structuredClone(workflow);
  const plan = translateWorkflow(workflow);
  assert.deepEqual(plan.commands, [
    {
      stepId: "open",
      timeoutMs: 30000,
      action: "navigate",
      url: "https://example.com",
    },
    {
      stepId: "name",
      timeoutMs: 30000,
      action: "fill",
      target: { by: "label", value: "Name" },
      value: "",
    },
    {
      stepId: "accept",
      timeoutMs: 30000,
      action: "setChecked",
      target: { by: "testId", value: "terms" },
      checked: true,
    },
    {
      stepId: "decline",
      timeoutMs: 1000,
      action: "setChecked",
      target: { by: "testId", value: "marketing" },
      checked: false,
    },
  ]);
  assert.deepEqual(workflow, original);
  assert.deepEqual(translateWorkflow(workflow), plan);
});

test("rejects invalid documents before translation", () => {
  for (const input of [
    null,
    { ...workflow, schemaVersion: "2" },
    { ...workflow, steps: [] },
    { ...workflow, steps: [workflow.steps[0], workflow.steps[0]] },
    { ...workflow, steps: [{ id: "x", code: "eval", script: "alert(1)" }] },
    {
      ...workflow,
      steps: [{ id: "x", code: "redirect", url: "javascript:alert(1)" }],
    },
    {
      ...workflow,
      steps: [{ ...workflow.steps[1], target: { by: "css", value: "#name" } }],
    },
    { ...workflow, steps: [{ ...workflow.steps[1], timeoutMs: -1 }] },
    { ...workflow, steps: [{ ...workflow.steps[1], extra: true }] },
  ])
    assert.throws(() => translateWorkflow(input));
});
