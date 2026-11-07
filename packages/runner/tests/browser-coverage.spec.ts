import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  runWorkflow,
  workflowSchema,
  type Workflow,
  type ProjectRecord,
  type WorkflowRevision,
  type RunRecord,
  type ReportSnapshot,
} from "@veriflow/core";
import { PlaywrightSessionFactory } from "../src/browser-session.ts";
import { startCoverageTarget } from "../unit/coverage-target.ts";
import { startBuiltPlatform } from "../unit/built-platform.ts";
import { fixtureHeaders } from "../unit/auth-fixture.ts";

let target: Awaited<ReturnType<typeof startCoverageTarget>>;
let root: string;
let platform: Awaited<ReturnType<typeof startBuiltPlatform>>;
let templatePath: string;
let templates: { id: string; defaults: Record<string, unknown> }[];
// Includes browser work and PNG finalization; tiny fixture budgets race under load.
const stepTimeoutMs = 10_000;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "veriflow-coverage-"));
  target = await startCoverageTarget();
  platform = await startBuiltPlatform(join(root, "platform"));
  const { project } = await request<{ project: ProjectRecord }>(
    "/api/projects",
    {
      title: "Browser coverage fixture",
      url: target.origin,
    },
  );
  templatePath = `/api/projects/${project.id}/templates`;
  ({ templates } = await request<{ templates: typeof templates }>(
    templatePath,
  ));
});
test.afterAll(async () => {
  try {
    await platform?.close();
  } finally {
    try {
      await target?.close();
    } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  }
});
const signal = () => new AbortController().signal;
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(platform.origin + path, {
    headers: fixtureHeaders(platform.origin),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...fixtureHeaders(platform.origin),
          },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.ok, `${path}: HTTP ${response.status}`).toBe(true);
  return response.json();
}
async function draft(id: string, override: object = {}): Promise<Workflow> {
  const defaults = templates.find((template) => template.id === id)!.defaults;
  const { workflow } = await request<{ workflow: unknown }>(templatePath, {
    templateId: id,
    parameters: { ...defaults, ...override },
  });
  return workflowSchema.parse(workflow);
}
async function completedRun(
  projectPath: string,
  id: string,
): Promise<RunRecord> {
  const path = `${projectPath}/runs/${id}`;
  let lastRun: RunRecord | undefined;
  try {
    await expect
      .poll(
        async () => {
          lastRun = (await request<{ run: RunRecord }>(path)).run;
          return !["queued", "running"].includes(lastRun.lifecycle);
        },
        { timeout: 45000 },
      )
      .toBe(true);
    expect(
      lastRun,
      `Run ${id} must complete; see its observed-run attachment`,
    ).toMatchObject({ lifecycle: "completed" });
    return lastRun!;
  } catch (error) {
    if (lastRun) {
      await test.info().attach(`observed-run-${id}.json`, {
        body: Buffer.from(JSON.stringify(lastRun, null, 2)),
        contentType: "application/json",
      });
    }
    throw error;
  }
}
async function execute(workflow: Workflow, secrets = true) {
  return runWorkflow(
    {
      ...workflow,
      steps: workflow.steps.map((step) => ({
        ...step,
        timeoutMs: step.code === "accessibility" ? 15000 : stepTimeoutMs,
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
    const result = await execute(await draft(id));
    expect(result.status).toBe("passed");
    expect(result.steps.every((s) => s.status === "passed")).toBe(true);
    expect(result.evidence.length).toBe(result.steps.length);
  });
}
test("authentication, authorization and secret prerequisites use real sessions", async () => {
  const missing = await execute(await draft("functional-auth"), false);
  expect(missing.status).toBe("blocked");
  const workflow = await draft("functional-auth");
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
    await draft("security-access", {
      checks: [
        { url: `${target.origin}/private`, statuses: [401] },
        { url: `${target.origin}/admin`, statuses: [401] },
      ],
    }),
  );
  expect(denied.status).toBe("passed");
  const unexpected = await execute(
    await draft("security-access", {
      checks: [{ url: target.origin, statuses: [401, 403] }],
    }),
  );
  expect(unexpected.status).toBe("failed");
  expect(unexpected.steps[0].failureKind).toBe("assertion");
});
test("responsive overflow fails at all three configured sizes", async () => {
  const result = await execute(
    await draft("responsive-viewports", {
      url: `${target.origin}/?overflow=1`,
    }),
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
    await draft("accessibility-wcag", { url: `${target.origin}/?a11y=1` }),
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
    await draft("compliance-checklist", {
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
  test.setTimeout(90000);
  const { project } = await request<{ project: ProjectRecord }>(
    "/api/projects",
    {
      title: "Regression fixture",
      url: target.origin,
    },
  );
  const projectPath = `/api/projects/${project.id}`;
  const workflow = await draft("functional-form");
  workflow.steps.forEach((step) => {
    step.timeoutMs = stepTimeoutMs;
  });
  const { workflow: saved } = await request<{ workflow: WorkflowRevision }>(
    `${projectPath}/workflows`,
    { workflow, expectedRevision: null },
  );
  const runs = [];
  try {
    for (const buggy of [true, false]) {
      target.setBug(buggy);
      const { run } = await request<{ run: RunRecord }>(`${projectPath}/runs`, {
        workflowId: workflow.id,
        revision: saved.revision,
        viewport: { width: 390, height: 844 },
      });
      const actual = await completedRun(projectPath, run.id);
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
    (
      await request<{ snapshot: ReportSnapshot }>(
        `${projectPath}/runs/${runs[0].id}/report`,
      )
    ).snapshot.run.outcome,
  ).toBe("failed");
  const a11y = await draft("accessibility-wcag", {
    url: `${target.origin}/?a11y=1`,
  });
  await request(`${projectPath}/workflows`, {
    workflow: a11y,
    expectedRevision: null,
  });
  const { run } = await request<{ run: RunRecord }>(`${projectPath}/runs`, {
    workflowId: a11y.id,
    revision: 1,
  });
  await completedRun(projectPath, run.id);
  expect(
    (
      await request<{ snapshot: ReportSnapshot }>(
        `${projectPath}/runs/${run.id}/report`,
      )
    ).snapshot.findings.some((f) => f.ruleId === "image-alt"),
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
  const workflow = await draft("security-access", {
    checks: [{ url: target.origin, statuses: [401] }],
  });
  // The route rejects off-origin template inputs; edit the draft to independently
  // verify the browser's own origin policy at execution time.
  const step = workflow.steps[0];
  expect(step.code).toBe("assertHttp");
  if (step.code !== "assertHttp") throw new Error("Expected HTTP assertion");
  step.url = "http://127.0.0.1:1/";
  const result = await execute(workflow);
  expect(result.status).toBe("blocked");
});

test("incorrect target validation and broken CRUD updates produce failed assertions", async () => {
  test.setTimeout(60000);
  const input = await execute(
    await draft("security-input", {
      url: `${target.origin}/?accept-invalid=1`,
    }),
  );
  expect(input.status).toBe("failed");
  expect(input.steps.at(-1)?.failureKind).toBe("assertion");
  const crud = await execute(
    await draft("functional-crud", {
      url: `${target.origin}/?broken-update=1`,
    }),
  );
  expect(crud.status).toBe("failed");
  expect(crud.steps.find((s) => s.stepId === "updated")?.status).toBe("failed");
  expect(crud.steps.find((s) => s.stepId === "delete")?.status).toBe("blocked");
});

test("secrets reflected by the target are redacted from assertion results and media", async () => {
  const workflow = await draft("functional-auth");
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
