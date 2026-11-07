import assert from "node:assert/strict";
import { test } from "node:test";
import { browserToolCallSchema, workflowSchema } from "@veriflow/core";
import {
  demoContext,
  demoProject,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import {
  createDraftGenerator,
  createOpenAIDraftProvider,
  createOpenAIAgentTurn,
  runAgentLoop,
} from "../server/agent/index.ts";

// Deliberately opt-in: CI does not need credentials or contact the provider.
test(
  "REAL PROVIDER: OpenAI draft and first tool decision (no browser execution)",
  {
    skip: process.env.VERIFLOW_VERIFY_OPENAI !== "1",
    timeout: 120_000,
  },
  async () => {
    const options = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    };
    const input = {
      project: demoProject,
      request: {
        objective:
          "Verify SAVE10 changes total 100000 to exactly 90000. Navigate to the project URL, fill testId coupon-input, click testId apply-coupon, and assert testId order-total has exact text 90000.",
        attachmentIds: [demoContext.attachmentId],
        templateIds: ["functional-exact-total"],
      },
      documents: [demoContext],
    };
    const signal = AbortSignal.timeout(90_000);
    const draft = await createDraftGenerator({
      provider: createOpenAIDraftProvider(options),
    }).generate(input, signal);
    assert.equal(draft.provider, "model");
    assert.deepEqual(draft.sourceAttachmentIds, [demoContext.attachmentId]);
    workflowSchema.parse(draft.workflow);
    assert(
      draft.workflow.steps.some(
        (step) =>
          step.code === "assert" &&
          step.expectation.kind === "text" &&
          step.expectation.value === "90000",
      ),
    );
    const turn = (await createOpenAIAgentTurn(options, {
      project: demoProject,
      reviewedWorkflow: {
        projectId: demoProject.id,
        revision: 1,
        workflow: demoWorkflow,
      },
    })([], signal)) as {
      kind: string;
      call: unknown;
    };
    assert.equal(turn.kind, "tool");
    browserToolCallSchema.parse(turn.call);
  },
);

test(
  "REAL PROVIDER: independent failure continues through a labeled fake tool session",
  {
    skip: process.env.VERIFLOW_VERIFY_OPENAI !== "1",
    timeout: 120_000,
  },
  async () => {
    const workflow = workflowSchema.parse({
      ...demoWorkflow,
      steps: [
        {
          id: "requirement-check",
          code: "assertRequirement",
          requirementId: "REQ-1",
          requirement: "Coupon total must be 90000",
          target: { by: "testId", value: "order-total" },
          expectation: { kind: "text", value: "90000" },
        },
        { id: "layout-check", code: "assertLayout" },
      ],
    });
    const calls: string[] = [];
    const result = await runAgentLoop(
      {
        next: createOpenAIAgentTurn(
          {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
            timeoutMs: 30_000,
          },
          {
            project: demoProject,
            reviewedWorkflow: {
              projectId: demoProject.id,
              revision: 1,
              workflow,
            },
          },
        ),
        maxCalls: 6,
        timeoutMs: 90_000,
        tools: {
          async observe() {
            return {
              url: demoProject.url,
              title: "Labeled deterministic fixture",
              text: "Fake session: order total 100000; layout check available.",
              targets: [{ by: "testId", value: "order-total" }],
              truncated: false,
            };
          },
          async execute(command) {
            calls.push(command.stepId);
            return command.stepId === "requirement-check"
              ? {
                  stepId: command.stepId,
                  status: "failed",
                  failureKind: "assertion",
                  reason: "Fixture total differs",
                  expected: "90000",
                  actual: "100000",
                  requirement: {
                    id: "REQ-1",
                    text: "Coupon total must be 90000",
                  },
                }
              : { stepId: command.stepId, status: "passed" };
          },
        },
      },
      AbortSignal.timeout(100_000),
    );
    assert.deepEqual(calls, ["requirement-check", "layout-check"]);
    assert.deepEqual(
      result.steps.map((step) => step.status),
      ["failed", "passed"],
    );
    assert.equal(result.steps[0].actual, "100000");
    assert.equal("outcome" in result, false);
  },
);
