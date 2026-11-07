import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import type { BrowserSession, SessionFactory } from "@veriflow/core";
import { createPlatform } from "../server/composition/platform.ts";

test("platform generation and runs use one admission pool and inspection never persists run artifacts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-shared-inspection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const inspecting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let inspections = 0;
  const factory: SessionFactory = {
    open: async (options) => {
      if (options.purpose === "inspection") {
        inspections++;
        assert.equal(options.artifactDirectory, undefined);
      }
      const session: BrowserSession = {
        execute: async (command) => ({
          status: "passed",
          stepId: command.stepId,
        }),
        evidence: async () => [],
        close: async () => {},
        observe: async () => {
          entered();
          await blocked;
          return {
            url: demoProject.url,
            title: "Fixture",
            text: "Checkout",
            truncated: false,
            scope: "main",
            targets: demoWorkflow.steps.flatMap((step) =>
              "target" in step && step.target ? [step.target] : [],
            ),
          };
        },
      };
      return session;
    },
  };
  const { http, store, coordinator } = await createPlatform(
    root,
    factory,
    "browser",
    {
      runOptions: { maxConcurrentRuns: 1 },
      draftProvider: {
        kind: "fixture",
        generate: async (input) => {
          assert.equal(input.pageContext?.[0].status, "observed");
          return demoWorkflow;
        },
      },
    },
  );
  const project = await store.createProject({
    title: "Shared pool fixture",
    url: demoProject.url,
  });
  await store.saveWorkflow(project.id, {
    workflow: demoWorkflow,
    expectedRevision: null,
  });
  const generation = http.generatePOST(
    new Request("http://localhost/generate", {
      method: "POST",
      body: JSON.stringify({ objective: "Check checkout" }),
    }),
    project.id,
  );
  try {
    await inspecting;
    await assert.rejects(
      coordinator.start(project.id, {
        workflowId: demoWorkflow.id,
        revision: 1,
      }),
      /capacity/,
    );
  } finally {
    release();
  }
  assert.equal((await generation).status, 200);
  assert.equal(inspections, 1);
  assert.equal((await store.listRuns(project.id)).length, 0);
  const run = await coordinator.start(project.id, {
    workflowId: demoWorkflow.id,
    revision: 1,
  });
  await coordinator.wait(run.id);
  assert.equal((await store.getRun(project.id, run.id)).lifecycle, "completed");
});
