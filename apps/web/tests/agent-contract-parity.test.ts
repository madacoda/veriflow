import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runWorkflow,
  workflowSchema,
  type AgentToolPort,
  type StepResult,
  type WorkflowStep,
} from "@veriflow/core";
import {
  demoContext,
  demoProject,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import {
  AgentError,
  createDraftGenerator,
  createOpenAIAgentTurn,
  runAgentLoop,
  type NextAgentTurn,
  type ToolRecord,
} from "../server/agent/index.ts";
import {
  MAX_FINDING_EVIDENCE_IDS,
  MAX_RESULT_FINDINGS,
} from "../server/agent/results.ts";

// Deterministic fake providers, sessions and HTTP transports; no live browser or API.
const active = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;
const requirementStep = workflowSchema.parse({
  ...demoWorkflow,
  steps: [
    {
      id: "check requirement 1",
      code: "assertRequirement",
      requirementId: "REQ 1: discount",
      requirement: "SAVE10 reduces the total to 90000",
      source: "fixture-story",
      target: { by: "testId", value: "order-total" },
      expectation: { kind: "text", value: "90000" },
    },
  ],
}).steps[0];
const layoutStep = workflowSchema.parse({
  ...demoWorkflow,
  steps: [{ id: "layout", code: "assertLayout" }],
}).steps[0];
const workflow = workflowSchema.parse({
  ...demoWorkflow,
  steps: [requirementStep, layoutStep],
});
const requirement = {
  id: "REQ 1: discount",
  text: "SAVE10 reduces the total to 90000",
  source: "fixture-story",
};
const finding = {
  id: "fixture-finding",
  category: "compliance" as const,
  ruleId: requirement.id,
  severity: "medium" as const,
  message: requirement.text,
  stepId: requirementStep.id,
  evidenceIds: ["fixture-evidence"],
};
const failed = (): StepResult => ({
  stepId: requirementStep.id,
  status: "failed",
  failureKind: "assertion",
  reason: "Observed total differs",
  expected: "90000",
  actual: "100000",
  findings: [structuredClone(finding)],
  requirement: structuredClone(requirement),
});
function sequence(steps: readonly WorkflowStep[]): NextAgentTurn {
  let index = 0;
  return async () =>
    index < steps.length
      ? { kind: "tool", call: { tool: "execute", step: steps[index++] } }
      : { kind: "done" };
}
function port(result: (id: string) => StepResult): AgentToolPort {
  return {
    async execute(command) {
      return result(command.stepId);
    },
    async observe() {
      throw new Error("Unexpected fixture observation");
    },
  };
}
function providerFixture(
  decisions: { name: string; args: unknown }[],
  steps = workflow.steps,
) {
  const requests: { messages: { content: string }[] }[] = [];
  const next = createOpenAIAgentTurn(
    {
      apiKey: "fixture-credential-not-a-real-key",
      model: "fixture-model",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        const decision = decisions[requests.length - 1];
        assert.ok(decision, "Unexpected provider request");
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "fixture-call",
                      type: "function",
                      function: {
                        name: decision.name,
                        arguments: JSON.stringify(decision.args),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
    {
      project: demoProject,
      reviewedWorkflow: {
        projectId: demoProject.id,
        revision: 1,
        workflow: { ...workflow, steps },
      },
    },
  );
  return { next, requests };
}

test("requirement-only generated drafts retain trusted source provenance and coverage warnings", async () => {
  const draft = await createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate() {
        return { ...workflow, steps: [requirementStep] };
      },
    },
  }).generate(
    {
      project: demoProject,
      request: {
        objective: "Check supplied requirement",
        attachmentIds: [demoContext.attachmentId],
        templateIds: ["requirements-acceptance"],
      },
      documents: [demoContext],
    },
    active(),
  );
  assert.deepEqual(draft.workflow.steps, [requirementStep]);
  assert.equal(draft.provider, "fixture");
  assert.deepEqual(draft.sourceAttachmentIds, [demoContext.attachmentId]);
  assert.match(draft.warnings.join(" "), /no model was called/);
  assert.match(
    draft.warnings.join(" "),
    /coverage against the supplied requirement sources/,
  );
  assert.match(draft.warnings.join(" "), /not a certification/);
});

test("agent and deterministic execution retain identical independent failures and metadata", async () => {
  const result = (id: string): StepResult =>
    id === requirementStep.id
      ? failed()
      : { stepId: id, status: "passed", findings: [] };
  const tools = port(result);
  const deterministic = await runWorkflow(
    workflow,
    { runId: "fixture-run", allowedOrigins: demoProject.allowedOrigins },
    {
      async open() {
        return {
          ...tools,
          async evidence() {
            return [];
          },
          async close() {},
        };
      },
    },
    active(),
  );
  const agent = await runAgentLoop(
    { next: sequence(workflow.steps), tools },
    active(),
  );
  assert.deepEqual(agent.steps, deterministic.steps);
  assert.deepEqual(
    agent.steps.map((step) => step.status),
    ["failed", "passed"],
  );
  assert.equal(deterministic.status, "failed");
  assert.equal("outcome" in agent, false);
});

test("adapter and provider mutations cannot rewrite nested findings, references or requirements", async () => {
  const raw = failed();
  let turn = 0;
  const result = await runAgentLoop(
    {
      tools: port(() => raw),
      next: async (history) => {
        if (turn++ === 0)
          return {
            kind: "tool",
            call: { tool: "execute", step: requirementStep },
          };
        const record = history[0];
        assert.ok("result" in record);
        assert.deepEqual(record.result, failed());
        Object.assign(record.result.requirement!, { text: "changed by model" });
        Object.assign(record.result.findings![0], {
          evidenceIds: ["changed"],
          message: "changed",
        });
        Object.assign(raw.requirement!, { id: "changed by adapter" });
        Object.assign(raw.findings![0], { evidenceIds: ["adapter-changed"] });
        return { kind: "done" };
      },
    },
    active(),
  );
  assert.deepEqual(result.steps, [failed()]);
  assert.deepEqual(result.history[0], {
    call: { tool: "execute", step: requirementStep },
    result: failed(),
  });
});

test("findings preserve all shared categories and optional metadata without inventing fields", async () => {
  for (const category of [
    "functionality",
    "functional",
    "responsive",
    "security",
    "compliance",
    "accessibility",
    "regression",
  ] as const) {
    const withoutStep = { ...finding };
    delete (withoutStep as { stepId?: string }).stepId;
    const raw: StepResult = {
      stepId: requirementStep.id,
      status: "passed",
      findings: [{ ...withoutStep, category, evidenceIds: [] }],
      requirement: { id: requirement.id, text: requirement.text },
    };
    const result = await runAgentLoop(
      { next: sequence([requirementStep]), tools: port(() => raw) },
      active(),
    );
    assert.deepEqual(result.steps[0], raw);
    assert.equal("source" in result.steps[0].requirement!, false);
    assert.equal("stepId" in result.steps[0].findings![0], false);
  }
});

test("malformed, foreign-step and oversized metadata reject before any later provider turn", async () => {
  const invalid = [
    { findings: null },
    { findings: {} },
    { findings: [null] },
    { findings: [{ ...finding, category: "invented" }] },
    { findings: [{ ...finding, severity: ["high"] }] },
    { findings: [{ ...finding, id: " " }] },
    { findings: [{ ...finding, ruleId: "r".repeat(129) }] },
    { findings: [{ ...finding, message: "m".repeat(20_001) }] },
    { findings: [{ ...finding, stepId: "another-step" }] },
    { findings: [{ ...finding, evidenceIds: "fixture-evidence" }] },
    { findings: [{ ...finding, evidenceIds: [" "] }] },
    { findings: [{ ...finding, evidenceIds: ["same", "same"] }] },
    {
      findings: [
        {
          ...finding,
          evidenceIds: Array.from(
            { length: MAX_FINDING_EVIDENCE_IDS + 1 },
            (_, i) => `e-${i}`,
          ),
        },
      ],
    },
    { findings: [finding, finding] },
    {
      findings: Array.from({ length: MAX_RESULT_FINDINGS + 1 }, (_, i) => ({
        ...finding,
        id: `f-${i}`,
      })),
    },
    { requirement: null },
    { requirement: [] },
    { requirement: { ...requirement, id: " " } },
    { requirement: { ...requirement, text: "r".repeat(2001) } },
    { requirement: { ...requirement, source: "s".repeat(257) } },
  ];
  for (const metadata of invalid) {
    let turns = 0;
    await assert.rejects(
      runAgentLoop(
        {
          next: async () => {
            turns++;
            return {
              kind: "tool",
              call: { tool: "execute", step: requirementStep },
            };
          },
          tools: port(() => ({ ...failed(), ...metadata }) as never),
        },
        active(),
      ),
      code("tool_failed"),
    );
    assert.equal(turns, 1);
  }
});

for (const step of [
  requirementStep,
  layoutStep,
  demoWorkflow.steps[3],
  demoWorkflow.steps[2],
]) {
  for (const outcome of [
    { status: "failed", failureKind: "assertion" },
    { status: "failed", failureKind: "infrastructure" },
    { status: "blocked", failureKind: "prerequisite" },
    { status: "blocked", failureKind: "assertion" },
    { status: "blocked", failureKind: "cancelled" },
    { status: "failed" },
  ] as const) {
    test(`${step.code} ${outcome.status}/${outcome.failureKind ?? "legacy"} continuation keeps the recorded outcome`, async () => {
      const following = { ...layoutStep, id: "next-check" };
      const calls: string[] = [];
      const result = await runAgentLoop(
        {
          next: sequence([step, following]),
          tools: port((id) => {
            calls.push(id);
            return id === step.id
              ? { stepId: id, reason: "Observed failure", ...outcome }
              : { stepId: id, status: "passed" };
          }),
        },
        active(),
      );
      const independent =
        ["assertRequirement", "assertLayout"].includes(step.code) &&
        outcome.status === "failed" &&
        outcome.failureKind === "assertion";
      assert.deepEqual(
        calls,
        independent ? [step.id, following.id] : [step.id],
      );
      assert.equal(result.steps[0].status, outcome.status);
      assert.equal(result.steps[0].failureKind, outcome.failureKind);
    });
  }
}

test("OpenAI continues reviewed independent checks and finishes with failed results intact", async () => {
  const http = providerFixture([
    ...workflow.steps.map((step) => ({ name: "execute", args: { step } })),
    { name: "finish", args: {} },
  ]);
  const result = await runAgentLoop(
    {
      next: http.next,
      tools: port((id) =>
        id === requirementStep.id
          ? failed()
          : {
              stepId: id,
              status: "failed",
              failureKind: "assertion",
              reason: "Overflow",
            },
      ),
    },
    active(),
  );
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ["failed", "failed"],
  );
  assert.equal(http.requests.length, 3);
  const last = JSON.parse(http.requests[2].messages[1].content);
  assert.equal(last.nextStepIndex, 2);
  assert.deepEqual(last.history[0].result, failed());
  assert.match(http.requests[2].messages[0].content, /never retry/);
});

test("OpenAI cannot retry or early-finish after an independent failure", async () => {
  for (const decision of [
    { name: "execute", args: { step: requirementStep } },
    { name: "finish", args: {} },
  ]) {
    const http = providerFixture([decision]);
    await assert.rejects(
      http.next(
        [
          {
            call: { tool: "execute", step: requirementStep },
            result: failed(),
          },
        ],
        active(),
      ),
      code("invalid_tool_call"),
    );
    assert.equal(http.requests.length, 1);
  }
});

test("OpenAI rejects stopped or malformed history before HTTP dispatch", async () => {
  for (const result of [
    { ...failed(), status: "blocked" },
    { ...failed(), failureKind: "infrastructure" },
    { ...failed(), failureKind: undefined },
    { ...failed(), findings: [{ ...finding, stepId: "foreign-step" }] },
  ]) {
    const http = providerFixture([{ name: "observe", args: {} }]);
    await assert.rejects(
      http.next(
        [
          {
            call: { tool: "execute", step: requirementStep },
            result,
          } as ToolRecord,
        ],
        active(),
      ),
      code("validation_error"),
    );
    assert.equal(http.requests.length, 0);
  }
});
