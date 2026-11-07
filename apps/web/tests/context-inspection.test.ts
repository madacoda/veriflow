import assert from "node:assert/strict";
import { test } from "node:test";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import type {
  BrowserObservation,
  BrowserSession,
  DraftGenerator,
  SessionFactory,
} from "@veriflow/core";
import {
  PageInspector,
  inspectionUrls,
} from "../server/context/inspect-pages.ts";
import { BrowserAdmission } from "../server/runs/browser-admission.ts";
import { createDraftGenerator } from "../server/agent/generate.ts";

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
