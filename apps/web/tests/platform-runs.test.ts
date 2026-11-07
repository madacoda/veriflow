import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionFactory } from "@veriflow/core";
import { demoWorkflow } from "@veriflow/core/fixtures";
import {
  PlatformStore,
  PlatformError,
} from "../server/projects/platform-store.ts";
import { PlatformHttp } from "../server/composition/http.ts";
import { RunCoordinator } from "../server/runs/coordinator.ts";
import { createFakeSessionFactory } from "../server/runs/fake-session.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "veriflow-run-"));
  const store = new PlatformStore(root);
  const project = await store.createProject({
    title: "Run fixture",
    url: "http://127.0.0.1:1111/demo",
  });
  await store.saveWorkflow(project.id, {
    workflow: {
      ...demoWorkflow,
      steps: [...demoWorkflow.steps, { ...demoWorkflow.steps[3], id: "after" }],
    },
    expectedRevision: null,
  });
  return {
    root,
    store,
    project,
    input: { workflowId: demoWorkflow.id, revision: 1 },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("observed failures block later steps and finalization waits for evidence then close", async (t) => {
  const { root, store, project, input } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: string[] = [];
  const fixture = createFakeSessionFactory("failed");
  const factory: SessionFactory = {
    open: async (options, signal) => {
      assert.deepEqual(options.allowedOrigins, ["http://127.0.0.1:1111"]);
      assert.equal(options.artifactDirectory, `runs/${options.runId}`);
      const session = await fixture.open(options, signal);
      return {
        execute: async (command, stepSignal) => {
          calls.push(command.stepId);
          return session.execute(command, stepSignal);
        },
        evidence: async () => {
          calls.push("evidence");
          return [];
        },
        close: async () => {
          calls.push("close");
          await session.close();
        },
      };
    },
  };
  const coordinator = new RunCoordinator(store, factory, "fake");
  const queued = await coordinator.start(project.id, input);
  assert.equal(queued.lifecycle, "queued");
  await coordinator.wait(queued.id);
  const result = await store.getRun(project.id, queued.id);
  assert.equal(result.adapter, "fake");
  assert.equal(result.lifecycle, "completed");
  assert.equal(result.outcome, "failed");
  assert.equal(result.steps.at(-1)?.status, "blocked");
  assert.equal(result.steps[3].expected, "90000");
  assert.deepEqual(calls, [
    "open",
    "coupon",
    "apply",
    "total",
    "evidence",
    "close",
  ]);
  assert.deepEqual(
    result.events.map((event) => event.sequence),
    result.events.map((_, index) => index + 1),
  );
  assert.equal(result.events.at(-1)?.type, "completed");
  assert.equal(result.evidence.capture, "unavailable");
  const terminal = await coordinator.cancel(project.id, result.id);
  assert.equal(terminal.lifecycle, "completed");
  assert.equal(terminal.cancelRequestedAt, undefined);
});

for (const failure of ["open", "execute", "evidence", "close"] as const) {
  test(`${failure} infrastructure errors cannot become failed assertions or passes`, async (t) => {
    const { root, store, project, input } = await setup();
    t.after(() => rm(root, { recursive: true, force: true }));
    let closed = false;
    const factory: SessionFactory = {
      open: async () => {
        if (failure === "open")
          throw new Error("sensitive provider diagnostics");
        return {
          execute: async (command) => {
            if (failure === "execute")
              throw new Error("sensitive browser details");
            return { stepId: command.stepId, status: "passed" };
          },
          evidence: async () => {
            if (failure === "evidence")
              throw new Error("sensitive storage path");
            return [];
          },
          close: async () => {
            closed = true;
            if (failure === "close")
              throw new Error("sensitive cleanup details");
          },
        };
      },
    };
    const coordinator = new RunCoordinator(store, factory, "fake");
    const queued = await coordinator.start(project.id, input);
    await coordinator.wait(queued.id);
    const result = await store.getRun(project.id, queued.id);
    assert.equal(result.lifecycle, "error");
    assert.equal(result.outcome, null);
    assert.equal(result.error?.code, "infrastructure_error");
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
    assert.equal(closed, failure !== "open");
  });
}

test(
  "cancellation remains nonterminal until cleanup finishes and is idempotent",
  { timeout: 5000 },
  async (t) => {
    const { root, store, project, input } = await setup();
    t.after(() => rm(root, { recursive: true, force: true }));
    const entered = deferred(),
      closing = deferred(),
      release = deferred();
    t.after(() => release.resolve());
    const factory: SessionFactory = {
      open: async () => ({
        execute: async (_command, signal) => {
          entered.resolve();
          return new Promise((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
          });
        },
        evidence: async () => [],
        close: async () => {
          closing.resolve();
          await release.promise;
        },
      }),
    };
    const coordinator = new RunCoordinator(store, factory, "fake");
    const queued = await coordinator.start(project.id, input);
    await entered.promise;
    const requested = await coordinator.cancel(project.id, queued.id);
    assert.equal(requested.lifecycle, "running");
    assert.ok(requested.cancelRequestedAt);
    await coordinator.cancel(project.id, queued.id);
    await closing.promise;
    assert.equal(
      (await store.getRun(project.id, queued.id)).lifecycle,
      "running",
    );
    release.resolve();
    await coordinator.wait(queued.id);
    const result = await store.getRun(project.id, queued.id);
    assert.equal(result.lifecycle, "cancelled");
    assert.equal(result.outcome, null);
    assert.ok(result.steps.every((step) => step.status === "blocked"));
    assert.equal(
      result.events.filter((event) => event.type === "cancellation_requested")
        .length,
      1,
    );
    assert.equal(
      (await coordinator.cancel(project.id, queued.id)).events.length,
      result.events.length,
    );
  },
);

test(
  "run time budget causes infrastructure error after cooperative cleanup",
  { timeout: 5000 },
  async (t) => {
    const { root, store, project, input } = await setup();
    t.after(() => rm(root, { recursive: true, force: true }));
    let closed = false;
    const entered = deferred();
    const deadline = new AbortController();
    const factory: SessionFactory = {
      open: async () => ({
        execute: async (_command, signal) => {
          entered.resolve();
          return new Promise((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
          });
        },
        evidence: async () => [],
        close: async () => {
          closed = true;
        },
      }),
    };
    const coordinator = new RunCoordinator(store, factory, "fake", 120000, {
      deadlineSignal: () => deadline.signal,
    });
    const queued = await coordinator.start(project.id, input);
    await entered.promise;
    deadline.abort(new DOMException("Run deadline expired", "TimeoutError"));
    await coordinator.wait(queued.id);
    const result = await store.getRun(project.id, queued.id);
    assert.equal(result.lifecycle, "error");
    assert.equal(result.outcome, null);
    assert.equal(closed, true);
  },
);

test("a deadline before allocation creates no session and remains an infrastructure error", async (t) => {
  const { root, store, project, input } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  let opened = false;
  const factory: SessionFactory = {
    open: async () => {
      opened = true;
      throw new Error("Must not allocate");
    },
  };
  const coordinator = new RunCoordinator(store, factory, "fake", 120000, {
    deadlineSignal: () =>
      AbortSignal.abort(new DOMException("Deadline", "TimeoutError")),
  });
  const queued = await coordinator.start(project.id, input);
  await coordinator.wait(queued.id);
  const result = await store.getRun(project.id, queued.id);
  assert.equal(opened, false);
  assert.equal(result.lifecycle, "error");
  assert.equal(result.outcome, null);
});

test(
  "the production deadline expires with cleanup required only for an allocated session",
  { timeout: 5000 },
  async (t) => {
    const { root, store, project, input } = await setup();
    t.after(() => rm(root, { recursive: true, force: true }));
    let opened = false,
      closed = false;
    const factory: SessionFactory = {
      open: async () => {
        opened = true;
        return {
          execute: async (_command, signal) =>
            new Promise((_, reject) => {
              if (signal.aborted) reject(signal.reason);
              else
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
            }),
          evidence: async () => [],
          close: async () => {
            closed = true;
          },
        };
      },
    };
    const coordinator = new RunCoordinator(store, factory, "fake", 20);
    const queued = await coordinator.start(project.id, input);
    await coordinator.wait(queued.id);
    const result = await store.getRun(project.id, queued.id);
    assert.equal(result.lifecycle, "error");
    assert.equal(result.outcome, null);
    assert.equal(closed, opened);
  },
);

for (const failure of ["none", "storage"] as const) {
  test(
    `pre-allocation cancellation with ${failure} failure preserves the correct lifecycle`,
    { timeout: 5000 },
    async (t) => {
      const { root, store, project, input } = await setup();
      t.after(() => rm(root, { recursive: true, force: true }));
      const reached = deferred(),
        proceed = deferred();
      t.after(() => proceed.resolve());
      const updateRun = store.updateRun.bind(store);
      let firstUpdate = true,
        opened = false;
      store.updateRun = async (...args) => {
        if (firstUpdate) {
          firstUpdate = false;
          reached.resolve();
          await proceed.promise;
          if (failure === "storage")
            throw new Error("Simulated storage fault during cancellation");
        }
        return updateRun(...args);
      };
      const factory: SessionFactory = {
        open: async () => {
          opened = true;
          throw new Error("Must not allocate");
        },
      };
      const coordinator = new RunCoordinator(store, factory, "fake");
      const queued = await coordinator.start(project.id, input);
      await reached.promise;
      await coordinator.cancel(project.id, queued.id);
      proceed.resolve();
      await coordinator.wait(queued.id);
      const result = await store.getRun(project.id, queued.id);
      assert.equal(opened, false);
      assert.equal(
        result.lifecycle,
        failure === "none" ? "cancelled" : "error",
      );
      assert.equal(result.outcome, null);
    },
  );
}

test(
  "atomic admission bounds simultaneous starts and holds capacity through cancellation cleanup",
  { timeout: 5000 },
  async (t) => {
    const { root, store, project, input } = await setup();
    t.after(() => rm(root, { recursive: true, force: true }));
    const entered = deferred(),
      proceed = deferred(),
      closing = deferred(),
      finishClose = deferred();
    t.after(() => {
      proceed.resolve();
      finishClose.resolve();
    });
    let opens = 0;
    const factory: SessionFactory = {
      open: async () => {
        const first = opens++ === 0;
        return {
          execute: async (command) => {
            if (first) {
              entered.resolve();
              await proceed.promise;
            }
            return { stepId: command.stepId, status: "passed" };
          },
          evidence: async () => [],
          close: async () => {
            if (first) {
              closing.resolve();
              await finishClose.promise;
            }
          },
        };
      },
    };
    const coordinator = new RunCoordinator(store, factory, "fake", 120000, {
      maxConcurrentRuns: 1,
    });
    const starts = await Promise.allSettled(
      Array.from({ length: 4 }, () => coordinator.start(project.id, input)),
    );
    const accepted = starts.filter((result) => result.status === "fulfilled");
    assert.equal(accepted.length, 1);
    starts
      .filter((result) => result.status === "rejected")
      .forEach((result) => {
        assert.ok(result.reason instanceof PlatformError);
        assert.equal(result.reason.status, 503);
      });
    const run = accepted[0].value;
    await entered.promise;
    assert.equal(opens, 1);
    assert.equal((await store.listRuns(project.id)).length, 1);
    await coordinator.cancel(project.id, run.id);
    proceed.resolve();
    await closing.promise;
    const response = await new PlatformHttp(store, coordinator).runsPOST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      project.id,
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "adapter_unavailable");
    assert.equal((await store.getRun(project.id, run.id)).lifecycle, "running");
    finishClose.resolve();
    await coordinator.wait(run.id);
    assert.equal(
      (await store.getRun(project.id, run.id)).lifecycle,
      "cancelled",
    );
    const next = await coordinator.start(project.id, input);
    await coordinator.wait(next.id);
    assert.equal((await store.getRun(project.id, next.id)).outcome, "passed");
    assert.equal(opens, 2);
  },
);

test("a failed persisted admission releases its reservation", async (t) => {
  const { root, store, project, input } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  const createRun = store.createRun.bind(store);
  let failOnce = true;
  store.createRun = async (...args) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("Simulated persistence failure");
    }
    return createRun(...args);
  };
  const coordinator = new RunCoordinator(
    store,
    createFakeSessionFactory("passed"),
    "fake",
    120000,
    { maxConcurrentRuns: 1 },
  );
  await assert.rejects(coordinator.start(project.id, input), /persistence/);
  const next = await coordinator.start(project.id, input);
  await coordinator.wait(next.id);
  assert.equal((await store.getRun(project.id, next.id)).outcome, "passed");
});

for (const failure of ["open", "evidence"] as const) {
  test(
    `${failure} failure during cancellation cannot be reported as cleanly cancelled`,
    { timeout: 5000 },
    async (t) => {
      const { root, store, project, input } = await setup();
      t.after(() => rm(root, { recursive: true, force: true }));
      const reached = deferred(),
        proceed = deferred();
      t.after(() => proceed.resolve());
      let closed = false;
      const factory: SessionFactory = {
        open: async () => {
          if (failure === "open") {
            reached.resolve();
            await proceed.promise;
            throw new Error("Partial allocation finalization is uncertain");
          }
          return {
            execute: async (command) => ({
              stepId: command.stepId,
              status: "passed",
            }),
            evidence: async () => {
              reached.resolve();
              await proceed.promise;
              throw new Error("Evidence could not finalize");
            },
            close: async () => {
              closed = true;
            },
          };
        },
      };
      const coordinator = new RunCoordinator(store, factory, "fake");
      const queued = await coordinator.start(project.id, input);
      await reached.promise;
      await coordinator.cancel(project.id, queued.id);
      proceed.resolve();
      await coordinator.wait(queued.id);
      const result = await store.getRun(project.id, queued.id);
      assert.equal(result.lifecycle, "error");
      assert.equal(result.outcome, null);
      assert.equal(result.error?.code, "infrastructure_error");
      assert.equal(closed, failure === "evidence");
    },
  );
}

test("missing adapter returns an explicit error and never creates a fake run", async (t) => {
  const { root, store, project, input } = await setup();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    new RunCoordinator(store).start(project.id, input),
    /not configured/,
  );
  assert.deepEqual(await store.listRuns(project.id), []);
});

test(
  "cleanup failure during cancellation remains an infrastructure error",
  { timeout: 5000 },
  async (t) => {
    const { root, store, project, input } = await setup();
    t.after(() => rm(root, { recursive: true, force: true }));
    const entered = deferred();
    const factory: SessionFactory = {
      open: async () => ({
        execute: async (_command, signal) => {
          entered.resolve();
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
        evidence: async () => [],
        close: async () => {
          throw new Error("Cleanup did not succeed");
        },
      }),
    };
    const coordinator = new RunCoordinator(store, factory, "fake");
    const queued = await coordinator.start(project.id, input);
    await entered.promise;
    await coordinator.cancel(project.id, queued.id);
    await coordinator.wait(queued.id);
    const result = await store.getRun(project.id, queued.id);
    assert.equal(result.lifecycle, "error");
    assert.equal(result.outcome, null);
    assert.equal(result.error?.code, "infrastructure_error");
  },
);
