import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runWorkflow, workflowSchema, type Workflow } from "@veriflow/core";
import { PlaywrightSessionFactory } from "../src/browser-session.ts";
import { startCoverageTarget } from "../unit/coverage-target.ts";
import {
  buildTemplate,
  templateOptions,
} from "../../../apps/web/server/templates/coverage.ts";

let target: Awaited<ReturnType<typeof startCoverageTarget>>;
let root: string;
test.beforeAll(async () => {
  target = await startCoverageTarget();
  root = await mkdtemp(join(tmpdir(), "veriflow-coverage-"));
});
test.afterAll(async () => {
  await target.close();
  await rm(root, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
function draft(id: string, override: object = {}) {
  const defaults = templateOptions(target.origin).find(
    (t) => t.id === id,
  )!.defaults;
  return buildTemplate(id, { ...defaults, ...override }, randomUUID());
}
async function execute(workflow: Workflow, secrets = true) {
  return runWorkflow(
    {
      ...workflow,
      steps: workflow.steps.map((step) => ({
        ...step,
        timeoutMs: step.code === "accessibility" ? 15000 : 1500,
      })),
    },
    { runId: randomUUID(), allowedOrigins: [target.origin] },
    new PlaywrightSessionFactory({
      storageRoot: root,
      resolveSecret: secrets
        ? (name) =>
            ({ USERNAME: "fixture-user", PASSWORD: "fixture-password" })[
              name as "USERNAME" | "PASSWORD"
            ]
        : undefined,
    }),
    signal(),
  );
}
for (const id of [
  "functional-form",
  "functional-crud",
  "responsive-viewports",
  "security-input",
  "compliance-checklist",
  "accessibility-wcag",
  "regression-replay",
]) {
  test(`${id} executes real browser checks and captures evidence`, async () => {
    const result = await execute(draft(id));
    expect(result.status).toBe("passed");
    expect(result.steps.every((s) => s.status === "passed")).toBe(true);
    expect(result.evidence.length).toBe(result.steps.length);
  });
}
test("authentication, authorization and secret prerequisites use real sessions", async () => {
  const missing = await execute(draft("functional-auth"), false);
  expect(missing.status).toBe("blocked");
  const workflow = draft("functional-auth");
  workflow.steps.push(
    ...workflowSchema.parse({
      schemaVersion: "1",
      id: "access",
      name: "Access",
      steps: [
        {
          id: "private",
          code: "assertHttp",
          url: `${target.origin}/private`,
          statuses: [200],
        },
        {
          id: "admin",
          code: "assertHttp",
          url: `${target.origin}/admin`,
          statuses: [403],
        },
      ],
    }).steps,
  );
  const result = await execute(workflow);
  expect(result.status).toBe("passed");
  expect(JSON.stringify(result)).not.toContain("fixture-password");
  expect(JSON.stringify(result)).not.toContain("fixture-user");
  expect(result.evidence).toHaveLength(1);
  const denied = await execute(
    draft("security-access", {
      checks: [
        { url: `${target.origin}/private`, statuses: [401] },
        { url: `${target.origin}/admin`, statuses: [401] },
      ],
    }),
  );
  expect(denied.status).toBe("passed");
  const unexpected = await execute(
    draft("security-access", {
      checks: [{ url: target.origin, statuses: [401, 403] }],
    }),
  );
  expect(unexpected.status).toBe("failed");
  expect(unexpected.steps[0].failureKind).toBe("assertion");
});
test("responsive overflow fails at all three configured sizes", async () => {
  const result = await execute(
    draft("responsive-viewports", { url: `${target.origin}/?overflow=1` }),
  );
  expect(result.status).toBe("failed");
  expect(result.steps.filter((s) => s.status === "failed")).toHaveLength(3);
  expect(
    result.steps
      .flatMap((s) => s.findings ?? [])
      .every((f) => f.category === "responsive" && f.evidenceIds.length === 1),
  ).toBe(true);
});
test("axe reports actual violations as findings with screenshot ownership", async () => {
  const result = await execute(
    draft("accessibility-wcag", { url: `${target.origin}/?a11y=1` }),
  );
  expect(result.status).toBe("failed");
  expect(result.steps.at(-1)?.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "image-alt",
        category: "accessibility",
      }),
    ]),
  );
});
test("supplied requirements retain source references and independent results", async () => {
  const result = await execute(
    draft("compliance-checklist", {
      requirements: [
        {
          requirementId: "REQ-1",
          requirement: "Total must be discounted",
          source: "BRD section 4",
          target: { by: "testId", value: "order-total" },
          expectation: { kind: "text", value: "90000" },
        },
        {
          requirementId: "REQ-2",
          requirement: "No records initially",
          target: { by: "testId", value: "record" },
          expectation: { kind: "text", value: "No records" },
        },
      ],
    }),
  );
  expect(result.status).toBe("failed");
  expect(result.steps[1].requirement?.source).toBe("BRD section 4");
  expect(result.steps[2].status).toBe("passed");
});
test("unchanged saved revision regresses then passes after target-only fix; reports retain findings", async () => {
  // The web package loads as CJS in Playwright; finish linking its ESM fixtures first.
  await import("@veriflow/core/fixtures");
  const { createPlatform } =
    await import("../../../apps/web/server/composition/platform.ts");
  const platform = await createPlatform(
    join(root, "platform"),
    new PlaywrightSessionFactory({ storageRoot: join(root, "platform") }),
  );
  const project = await platform.store.createProject({
    title: "Regression fixture",
    url: target.origin,
  });
  const workflow = draft("functional-form");
  workflow.steps.forEach((step) => {
    step.timeoutMs = 3000;
  });
  const saved = await platform.store.saveWorkflow(project.id, {
    workflow,
    expectedRevision: null,
  });
  const runs = [];
  try {
    for (const buggy of [true, false]) {
      target.setBug(buggy);
      const run = await platform.coordinator.start(project.id, {
        workflowId: workflow.id,
        revision: saved.revision,
        viewport: { width: 390, height: 844 },
      });
      await platform.coordinator.wait(run.id);
      const actual = await platform.store.getRun(project.id, run.id);
      expect(actual.lifecycle).toBe("completed");
      expect(actual.outcome).toBe(buggy ? "failed" : "passed");
      expect(actual.viewport).toEqual({ width: 390, height: 844 });
      runs.push(actual);
    }
  } finally {
    target.setBug(false);
  }
  expect(runs[0].id).not.toBe(runs[1].id);
  expect(runs[0].evidence.artifacts[0].id).not.toBe(
    runs[1].evidence.artifacts[0].id,
  );
  expect(
    (await platform.store.report(project.id, runs[0].id)).run.outcome,
  ).toBe("failed");
  const a11y = draft("accessibility-wcag", { url: `${target.origin}/?a11y=1` });
  await platform.store.saveWorkflow(project.id, {
    workflow: a11y,
    expectedRevision: null,
  });
  const run = await platform.coordinator.start(project.id, {
    workflowId: a11y.id,
    revision: 1,
  });
  await platform.coordinator.wait(run.id);
  expect(
    (await platform.store.report(project.id, run.id)).findings.some(
      (f) => f.ruleId === "image-alt",
    ),
  ).toBe(true);
});
test("new command arguments and allowed origins remain enforced", async () => {
  expect(() =>
    workflowSchema.parse({
      schemaVersion: "1",
      id: "bad",
      name: "Bad",
      steps: [{ id: "x", code: "viewport", width: 0, height: 800 }],
    }),
  ).toThrow();
  const result = await execute(
    draft("security-access", {
      checks: [{ url: "http://127.0.0.1:1/", statuses: [401] }],
    }),
  );
  expect(result.status).toBe("blocked");
});

test("incorrect target validation and broken CRUD updates produce failed assertions", async () => {
  const input = await execute(
    draft("security-input", { url: `${target.origin}/?accept-invalid=1` }),
  );
  expect(input.status).toBe("failed");
  expect(input.steps.at(-1)?.failureKind).toBe("assertion");
  const crud = await execute(
    draft("functional-crud", { url: `${target.origin}/?broken-update=1` }),
  );
  expect(crud.status).toBe("failed");
  expect(crud.steps.find((s) => s.stepId === "updated")?.status).toBe("failed");
  expect(crud.steps.find((s) => s.stepId === "delete")?.status).toBe("blocked");
});

test("secrets reflected by the target are redacted from assertion results and media", async () => {
  const workflow = draft("functional-auth");
  workflow.steps.push(
    ...workflowSchema.parse({
      schemaVersion: "1",
      id: "echo",
      name: "Echo",
      steps: [
        {
          id: "echo",
          code: "assert",
          target: { by: "testId", value: "secret-echo" },
          expectation: { kind: "text", value: "intentionally different" },
        },
      ],
    }).steps,
  );
  const result = await execute(workflow);
  expect(result.status).toBe("failed");
  expect(result.steps.at(-1)?.actual).toBe("[REDACTED]");
  expect(result.evidence).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("fixture-password");
});
