import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateWorkflow, type Workflow } from "@veriflow/core";
import { demoProject } from "@veriflow/core/fixtures";
import { PlaywrightSessionFactory } from "../../../packages/runner/src/browser-session.ts";
import { startGenerationContextTarget } from "../../../packages/runner/unit/generation-context-target.ts";
import { PageInspector } from "../server/context/inspect-pages.ts";
import { BrowserAdmission } from "../server/runs/browser-admission.ts";
import {
  createDraftGenerator,
  createOpenAIDraftProvider,
} from "../server/agent/index.ts";

test(
  "live OpenAI grounded draft and regeneration execute a known-pass and known-fail fixture",
  { skip: process.env.VERIFLOW_VERIFY_OPENAI !== "1", timeout: 100000 },
  async (t) => {
    const target = await startGenerationContextTarget();
    const root = await mkdtemp(join(tmpdir(), "veriflow-grounded-live-"));
    t.after(async () => {
      await target.close();
      await rm(root, { recursive: true, force: true });
    });
    const signal = AbortSignal.timeout(90000);
    const factory = new PlaywrightSessionFactory({ storageRoot: root });
    const project = {
      ...demoProject,
      url: target.origin + "/unique",
      allowedOrigins: [target.origin],
    };
    const pageContext = await new PageInspector(
      factory,
      new BrowserAdmission(1),
    ).inspect(project, [project.url], signal);
    assert.equal(pageContext[0].status, "observed");
    const generator = createDraftGenerator({
      provider: createOpenAIDraftProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      }),
    });
    const request = {
      objective:
        "Navigate to the checkout fixture, fill Coupon with SAVE10, click Apply coupon, then assert Coupon result text equals Applied. Only this page, using observed targets. Do not assert the previous Not applied state after clicking.",
      attachmentIds: [],
      templateIds: [],
    };
    const input = { project, request, documents: [], pageContext };
    const draft = await generator.generate(input, signal);
    const regenerated = await generator.generate(
      { ...input, request: { ...request, baseWorkflow: draft.workflow } },
      signal,
    );
    assert.equal(regenerated.provider, "model");
    const execute = async (workflow: Workflow, id: string) => {
      const session = await factory.open(
        { runId: id, allowedOrigins: project.allowedOrigins },
        signal,
      );
      try {
        const results = [];
        for (const command of translateWorkflow(workflow).commands) {
          const result = await session.execute(command, signal);
          results.push(result);
          if (result.status !== "passed") break;
        }
        const evidence = await session.evidence();
        assert.ok(evidence.some((item) => item.kind === "screenshot"));
        return results;
      } finally {
        await session.close();
      }
    };
    const passed = await execute(regenerated.workflow, "live-known-pass");
    assert.equal(passed.length, regenerated.workflow.steps.length);
    assert.ok(passed.every((result) => result.status === "passed"));
    const failing = structuredClone(regenerated.workflow);
    const check = failing.steps.find(
      (step) => step.code === "assert" && step.expectation.kind === "text",
    );
    assert.ok(check && check.code === "assert");
    check.expectation = {
      kind: "text",
      value: "Deliberately incorrect fixture expectation",
    };
    check.timeoutMs = 500;
    const failed = await execute(failing, "live-known-fail");
    assert.equal(failed.at(-1)?.status, "failed");
    assert.equal(failed.at(-1)?.failureKind, "assertion");
  },
);
