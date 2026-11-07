import assert from "node:assert/strict";
import { test } from "node:test";
import {
  translateWorkflow,
  type AgentToolPort,
  type Command,
  type WorkflowStep,
} from "@veriflow/core";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import {
  runAgentLoop,
  AgentError,
  type NextAgentTurn,
} from "../server/agent/index.ts";
import { createFixtureTools } from "../server/agent/fixtures.ts";

const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;
const tool = (call: unknown) => ({ kind: "tool", call });
function sequence(turns: unknown[]): NextAgentTurn {
  let index = 0;
  return async () => turns[index++] ?? { kind: "done" };
}
function recordingPort() {
  const calls: Command[] = [];
  let observations = 0;
  const port: AgentToolPort = {
    async execute(command) {
      calls.push(structuredClone(command));
      return { stepId: command.stepId, status: "passed" };
    },
    async observe() {
      observations++;
      return {
        url: demoProject.url,
        title: "fixture",
        text: "text",
        truncated: false,
        targets: [],
      };
    },
  };
  return { port, calls, observations: () => observations };
}

test("shared functional fixture translates through core and preserves observed pass/fail", async () => {
  for (const actual of ["90000", "100000"]) {
    const fixture = createFixtureTools(actual);
    const outcome = await runAgentLoop(
      {
        tools: fixture.port,
        next: sequence(
          demoWorkflow.steps.map((step) => tool({ tool: "execute", step })),
        ),
      },
      signal(),
    );
    assert.deepEqual(
      fixture.commands,
      translateWorkflow(demoWorkflow).commands,
    );
    assert.equal(
      outcome.steps.at(-1)?.status,
      actual === "90000" ? "passed" : "failed",
    );
    assert.equal(outcome.steps.at(-1)?.actual, actual);
    assert.equal(outcome.steps.at(-1)?.expected, "90000");
    assert.equal("outcome" in outcome, false);
  }
});

test("all workflow step forms use the shared translator", async () => {
  const steps: WorkflowStep[] = [
    ...demoWorkflow.steps,
    {
      id: "check",
      code: "check",
      target: { by: "label", value: "Terms" },
      timeoutMs: 100,
    },
    {
      id: "uncheck",
      code: "uncheck",
      target: { by: "label", value: "Terms" },
      timeoutMs: 100,
    },
  ];
  const fixture = recordingPort();
  await runAgentLoop(
    {
      tools: fixture.port,
      next: sequence(steps.map((step) => tool({ tool: "execute", step }))),
    },
    signal(),
  );
  assert.deepEqual(
    fixture.calls,
    translateWorkflow({ ...demoWorkflow, steps }).commands,
  );
});

test("every unknown call is validated before any browser dispatch", async () => {
  const invalid = [
    null,
    "click",
    { tool: "eval", script: "secret" },
    { tool: "observe", maxCharacters: 20001 },
    { tool: "observe", extra: true },
    {
      tool: "execute",
      step: { id: "x", code: "click", target: { by: "css", value: "button" } },
    },
    {
      tool: "execute",
      step: {
        id: "x",
        code: "redirect",
        url: "https://user:password@example.com",
      },
    },
    { tool: "execute", step: { ...demoWorkflow.steps[0], extra: true } },
  ];
  for (const call of invalid) {
    const fixture = recordingPort();
    await assert.rejects(
      runAgentLoop(
        { tools: fixture.port, next: sequence([tool(call)]) },
        signal(),
      ),
      code("invalid_tool_call"),
    );
    assert.equal(fixture.calls.length + fixture.observations(), 0);
  }
});

test("call limit counts observations and execution; provider may finish exactly at the limit", async () => {
  const fixture = recordingPort();
  await assert.rejects(
    runAgentLoop(
      {
        tools: fixture.port,
        maxCalls: 2,
        next: sequence([
          tool({ tool: "observe" }),
          tool({ tool: "execute", step: demoWorkflow.steps[0] }),
          tool({ tool: "observe" }),
        ]),
      },
      signal(),
    ),
    code("call_limit_exceeded"),
  );
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.observations(), 1);
  const done = await runAgentLoop(
    {
      tools: fixture.port,
      maxCalls: 1,
      next: sequence([tool({ tool: "observe" })]),
    },
    signal(),
  );
  assert.equal(done.history.length, 1);
  for (const maxCalls of [0, -1, 1.5, 101, NaN, Infinity])
    await assert.rejects(
      runAgentLoop(
        { tools: fixture.port, maxCalls, next: sequence([]) },
        signal(),
      ),
      code("validation_error"),
    );
});

test("duplicate executed step IDs cannot rewrite observed history", async () => {
  const fixture = recordingPort();
  const turn = tool({ tool: "execute", step: demoWorkflow.steps[0] });
  await assert.rejects(
    runAgentLoop(
      { tools: fixture.port, next: sequence([turn, turn]) },
      signal(),
    ),
    code("invalid_tool_call"),
  );
  assert.equal(fixture.calls.length, 1);
});

test("failed assertions and blocked prerequisites stop before provider can override them", async () => {
  for (const status of ["failed", "blocked"] as const) {
    const fixture = recordingPort();
    fixture.port.execute = async (command) => ({
      stepId: command.stepId,
      status,
      reason: "Observed result",
      expected: "90000",
      actual: "100000",
    });
    let turns = 0;
    const result = await runAgentLoop(
      {
        tools: fixture.port,
        next: async () => {
          turns++;
          return turns === 1
            ? tool({ tool: "execute", step: demoWorkflow.steps[3] })
            : { kind: "done", outcome: "passed" };
        },
      },
      signal(),
    );
    assert.equal(turns, 1);
    assert.equal(result.steps[0].status, status);
  }
});

test("provider cannot declare outcomes or mutate previously observed results", async () => {
  const fixture = recordingPort();
  await assert.rejects(
    runAgentLoop(
      {
        tools: fixture.port,
        next: sequence([{ kind: "done", outcome: "passed" }]),
      },
      signal(),
    ),
    code("invalid_tool_call"),
  );
  let turn = 0;
  const result = await runAgentLoop(
    {
      tools: fixture.port,
      next: async (history) => {
        if (turn++ === 0)
          return tool({ tool: "execute", step: demoWorkflow.steps[0] });
        if (history[0] && "result" in history[0])
          Object.assign(history[0].result, { status: "failed" });
        return { kind: "done" };
      },
    },
    signal(),
  );
  assert.equal(result.steps[0].status, "passed");
});

test("observations are bounded including title and targets, and defaults reach injected port", async () => {
  const fixture = recordingPort();
  let requested = 0;
  fixture.port.observe = async (maxCharacters) => {
    requested = maxCharacters;
    return {
      url: demoProject.url,
      title: "t".repeat(600),
      text: "x".repeat(21000),
      truncated: false,
      targets: Array.from({ length: 101 }, () => ({
        by: "label",
        value: "button",
      })),
    };
  };
  const result = await runAgentLoop(
    { tools: fixture.port, next: sequence([tool({ tool: "observe" })]) },
    signal(),
  );
  assert.equal(requested, 8000);
  const record = result.history[0];
  assert.ok("observation" in record);
  assert.equal(record.observation.text.length, 8000);
  assert.equal(record.observation.title.length, 512);
  assert.equal(record.observation.targets.length, 100);
  assert.equal(record.observation.truncated, true);
});

test("invalid adapter results and private failures cannot masquerade as success", async () => {
  for (const raw of [
    null,
    { status: "passed", stepId: "wrong" },
    { status: "passed", stepId: "open", failureKind: "infrastructure" },
    { status: "failed", stepId: "open" },
    { status: "invented", stepId: "open" },
  ]) {
    const fixture = recordingPort();
    fixture.port.execute = async () => raw as never;
    await assert.rejects(
      runAgentLoop(
        {
          tools: fixture.port,
          next: sequence([
            tool({ tool: "execute", step: demoWorkflow.steps[0] }),
          ]),
        },
        signal(),
      ),
      code("tool_failed"),
    );
  }
  const fixture = recordingPort();
  fixture.port.observe = async () => {
    throw new Error("secret /private/path");
  };
  await assert.rejects(
    runAgentLoop(
      { tools: fixture.port, next: sequence([tool({ tool: "observe" })]) },
      signal(),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "tool_failed");
      assert.doesNotMatch(error.message, /secret|private/);
      return true;
    },
  );
});

test("cancel before dispatch, cancel pending provider, and total provider deadline are bounded", async () => {
  const fixture = recordingPort();
  const cancelled = new AbortController();
  cancelled.abort();
  let turns = 0;
  await assert.rejects(
    runAgentLoop(
      {
        tools: fixture.port,
        next: async () => {
          turns++;
          return { kind: "done" };
        },
      },
      cancelled.signal,
    ),
    code("cancelled"),
  );
  assert.equal(turns, 0);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let nextSignal: AbortSignal | undefined;
  const next: NextAgentTurn = async (_history, bounded) => {
    nextSignal = bounded;
    started();
    return new Promise(() => {});
  };
  const controller = new AbortController();
  const pending = runAgentLoop(
    { tools: fixture.port, next },
    controller.signal,
  );
  await ready;
  controller.abort("secret");
  await assert.rejects(pending, code("cancelled"));
  assert.equal(nextSignal?.aborted, true);
  await assert.rejects(
    runAgentLoop({ tools: fixture.port, next, timeoutMs: 10 }, signal()),
    code("timeout"),
  );
  assert.equal(fixture.calls.length + fixture.observations(), 0);
});

test("cancellation stops noncooperative tools and never finalizes coordinator session", async () => {
  const fixture = recordingPort();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let toolSignal: AbortSignal | undefined;
  let release!: (value: { stepId: string; status: "passed" }) => void;
  fixture.port.execute = async (_command, bounded) => {
    toolSignal = bounded;
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  Object.assign(fixture.port, {
    close() {
      assert.fail("coordinator owns close");
    },
    evidence() {
      assert.fail("coordinator owns evidence");
    },
  });
  const controller = new AbortController();
  const pending = runAgentLoop(
    {
      tools: fixture.port,
      next: sequence([
        tool({ tool: "execute", step: demoWorkflow.steps[0] }),
        tool({ tool: "observe" }),
      ]),
    },
    controller.signal,
  );
  await ready;
  controller.abort();
  await assert.rejects(pending, code("cancelled"));
  assert.equal(toolSignal?.aborted, true);
  release({ stepId: "open", status: "passed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.observations(), 0);
});

test("per-step and total deadlines abort pending tools even when adapters ignore signals", async () => {
  for (const stepTimeout of [10, 10000]) {
    const fixture = recordingPort();
    let toolSignal: AbortSignal | undefined;
    fixture.port.execute = async (_command, bounded) => {
      toolSignal = bounded;
      return new Promise(() => {});
    };
    await assert.rejects(
      runAgentLoop(
        {
          tools: fixture.port,
          timeoutMs: 20,
          next: sequence([
            tool({
              tool: "execute",
              step: { ...demoWorkflow.steps[0], timeoutMs: stepTimeout },
            }),
          ]),
        },
        signal(),
      ),
      code("timeout"),
    );
    assert.equal(toolSignal?.aborted, true);
  }
});

test("elapsed deadline prevents dispatch even before a delayed timer callback runs", async () => {
  const fixture = recordingPort();
  await assert.rejects(
    runAgentLoop(
      {
        tools: fixture.port,
        timeoutMs: 5,
        next: async () => {
          const until = performance.now() + 10;
          while (performance.now() < until) {
            /* Simulate synchronous provider work. */
          }
          return tool({ tool: "observe" });
        },
      },
      signal(),
    ),
    code("timeout"),
  );
  assert.equal(fixture.observations(), 0);
});
