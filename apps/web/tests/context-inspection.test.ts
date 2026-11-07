import assert from "node:assert/strict";
import { test } from "node:test";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import type {
  BrowserObservation,
  BrowserSession,
  DraftGenerator,
  SessionFactory,
} from "@veriflow/core";
import { workflowSchema } from "@veriflow/core";
import {
  PageInspector,
  inspectionUrls,
} from "../server/context/inspect-pages.ts";
import { BrowserAdmission } from "../server/runs/browser-admission.ts";
import { createDraftGenerator } from "../server/agent/generate.ts";
import { errorResponse } from "../server/composition/http.ts";
import { AgentError } from "../server/agent/errors.ts";

const observation = (): BrowserObservation => ({
  url: demoProject.url,
  title: "Fixture",
  text: "Public content",
  scope: "main",
  truncated: false,
  targets: demoWorkflow.steps.flatMap((step) =>
    "target" in step && step.target ? [step.target] : [],
  ),
});
function fixture(read = async () => observation()) {
  let closed = 0;
  const session: BrowserSession = {
    execute: async (command) => ({ status: "passed", stepId: command.stepId }),
    observe: read,
    close: async () => {
      closed++;
    },
    evidence: async () => [],
  };
  const factory: SessionFactory = {
    open: async (options) => {
      assert.equal(options.purpose, "inspection");
      assert.equal(options.artifactDirectory, undefined);
      return session;
    },
  };
  return { factory, closed: () => closed };
}
const request = {
  objective: "Test this page",
  attachmentIds: [],
  templateIds: [],
};

test("inspection recovery messages identify uninspected pages without query values or invented outcomes", async () => {
  const response = errorResponse(
    new AgentError("inspection_unavailable", [
      {
        status: "unavailable",
        sourceUrl: "https://example.test/shop?token=private",
        capturedAt: new Date().toISOString(),
        reason: "policy_rejected",
      },
    ]),
  );
  assert.equal(response.status, 422);
  const text = await response.text();
  assert.match(text, /https:\/\/example.test\/shop/);
  assert.match(text, /not inspected \(policy_rejected\)/);
  assert.doesNotMatch(text, /token|private/);
});

test("inspection validates all destinations before browser/model dispatch", () => {
  assert.deepEqual(inspectionUrls(demoProject, request), [demoProject.url]);
  assert.throws(() =>
    inspectionUrls(demoProject, {
      ...request,
      pageUrls: ["https://elsewhere.example/"],
    }),
  );
  assert.throws(() =>
    inspectionUrls(demoProject, {
      ...request,
      pageUrls: Array.from(
        { length: 5 },
        (_, i) => new URL(`/page${i}`, demoProject.url).href,
      ),
    }),
  );
});

test("inspection observes scoped prerequisites, redacts URLs and closes without evidence", async () => {
  const fake = fixture(async () => ({
    ...observation(),
    url: demoProject.url + "?token=private#secret",
    text: "PLAYER ACCOUNT REQUIRED",
    passwordFieldVisible: true,
  }));
  const pages = await new PageInspector(
    fake.factory,
    new BrowserAdmission(1),
  ).inspect(demoProject, [demoProject.url], new AbortController().signal);
  assert.equal(fake.closed(), 1);
  assert.equal(pages[0].status, "observed");
  if (pages[0].status === "observed") {
    assert.equal(pages[0].observation.url, demoProject.url.split("?")[0]);
    assert.equal(pages[0].accessSignals.length, 2);
  }
  assert.ok(!JSON.stringify(pages).includes("private"));
});

test("inspection shares run admission and releases after cancellation and unavailable adapters", async () => {
  const admission = new BrowserAdmission(1);
  const release = admission.acquire("run");
  const controller = new AbortController();
  const fake = fixture(async () => {
    controller.abort();
    throw Error("private detail");
  });
  const inspector = new PageInspector(fake.factory, admission);
  await assert.rejects(
    inspector.inspect(demoProject, [demoProject.url], controller.signal),
    /capacity/,
  );
  release();
  release();
  await assert.rejects(
    inspector.inspect(demoProject, [demoProject.url], controller.signal),
    /cancelled/,
  );
  assert.equal(fake.closed(), 1);
  admission.acquire("run")();
});

test("generation receives observed targets, rejects invented targets and preserves regeneration checks", async () => {
  const fake = fixture();
  const pageContext = await new PageInspector(
    fake.factory,
    new BrowserAdmission(),
  ).inspect(demoProject, [demoProject.url], new AbortController().signal);
  const input: Parameters<DraftGenerator["generate"]>[0] = {
    project: demoProject,
    request: { ...request, baseWorkflow: demoWorkflow },
    documents: [],
    pageContext,
  };
  let output = structuredClone(demoWorkflow);
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      generate: async (received) => {
        assert.deepEqual(received.pageContext, pageContext);
        return output;
      },
    },
  });
  const before = structuredClone(input);
  const draft = await generator.generate(input, new AbortController().signal);
  assert.deepEqual(draft.pageContext, pageContext);
  assert.notEqual(draft.workflow.id, demoWorkflow.id);
  assert.deepEqual(input, before);
  output = {
    ...output,
    steps: output.steps.filter((step) => step.code !== "redirect"),
  };
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /invalid workflow draft/,
  );
  output = structuredClone(demoWorkflow);
  output.steps.unshift({
    id: "uninspected",
    code: "redirect",
    url: new URL("/not-inspected", demoProject.url).href,
    timeoutMs: 1000,
  });
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /invalid workflow draft/,
  );
  output = structuredClone(demoWorkflow);
  output = {
    ...output,
    steps: output.steps.filter((step) => step.code !== "assert"),
  };
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /invalid workflow draft/,
  );
  output = structuredClone(demoWorkflow);
  const step = output.steps.find((step) => "target" in step);
  if (step && "target" in step)
    step.target = { by: "role", role: "button", value: "Invented" };
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /invalid workflow draft/,
  );
});

test("auth prerequisites, unavailable pages and absent guards stop provider dispatch", async () => {
  let calls = 0;
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      generate: async () => {
        calls++;
        return demoWorkflow;
      },
    },
  });
  const fake = fixture(async () => ({
    ...observation(),
    text: "ACCOUNT REQUIRED",
  }));
  const pages = await new PageInspector(
    fake.factory,
    new BrowserAdmission(),
  ).inspect(demoProject, [demoProject.url], new AbortController().signal);
  const input = {
    project: demoProject,
    request,
    documents: [],
    pageContext: pages,
  };
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /access prerequisite/,
  );
  input.pageContext = await new PageInspector(
    undefined,
    new BrowserAdmission(),
  ).inspect(demoProject, [demoProject.url], new AbortController().signal);
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /could not be inspected/,
  );
  input.pageContext = await new PageInspector(
    fixture().factory,
    new BrowserAdmission(),
  ).inspect(demoProject, [demoProject.url], new AbortController().signal);
  await assert.rejects(
    generator.generate(
      { ...input, request: { ...request, accessMode: "guard" } },
      new AbortController().signal,
    ),
    /No access restriction/,
  );
  assert.equal(calls, 0);
});

test("explicit sign-in form intent is distinct from protected functionality and never embeds credential values", async () => {
  const target = { by: "label" as const, value: "Password" };
  const fake = fixture(async () => ({
    ...observation(),
    text: "Sign in",
    scope: "dialog",
    passwordFieldVisible: true,
    targets: [target],
  }));
  const pageContext = await new PageInspector(
    fake.factory,
    new BrowserAdmission(),
  ).inspect(demoProject, [demoProject.url], new AbortController().signal);
  let output = workflowSchema.parse({
    schemaVersion: "1",
    id: "signin-form",
    name: "Password form is visible",
    steps: [
      { id: "open", code: "redirect", url: demoProject.url },
      {
        id: "password",
        code: "assert",
        target,
        expectation: { kind: "visible", value: true },
      },
    ],
  });
  const generator = createDraftGenerator({
    provider: { kind: "fixture", generate: async () => output },
  });
  const input = { project: demoProject, request, documents: [], pageContext };
  await assert.rejects(
    generator.generate(input, new AbortController().signal),
    /access prerequisite/,
  );
  const authInput = {
    ...input,
    request: { ...request, accessMode: "authentication" as const },
  };
  const draft = await generator.generate(
    authInput,
    new AbortController().signal,
  );
  assert.match(draft.warnings.join(" "), /sign-in form only/);
  output.steps.splice(1, 0, {
    id: "input",
    code: "fill",
    target,
    value: "synthetic-forbidden-value",
    timeoutMs: 1000,
  });
  await assert.rejects(
    generator.generate(authInput, new AbortController().signal),
    /invalid workflow draft/,
  );
  output = {
    ...output,
    steps: output.steps.filter((step) => step.code !== "fill"),
  };
  const noForm = pageContext.map((page) =>
    page.status === "observed"
      ? {
          ...page,
          observation: { ...page.observation, passwordFieldVisible: false },
        }
      : page,
  );
  await assert.rejects(
    generator.generate(
      { ...authInput, pageContext: noForm },
      new AbortController().signal,
    ),
    /No visible password form/,
  );
});
