import type {
  WorkflowRepository,
  StoredWorkflow,
  Workflow,
  WorkflowGenerator,
  Project,
  Command,
  Evidence,
  ExecutionSession,
  SessionFactory,
  SessionOptions,
  StepResult,
  QaEvaluator,
  Evaluation,
} from "@veriflow/core";

export class FakeWorkflowRepository implements WorkflowRepository {
  private readonly entries = new Map<string, StoredWorkflow>();
  async get(
    projectId: string,
    workflowId: string,
  ): Promise<StoredWorkflow | null> {
    return structuredClone(
      this.entries.get(JSON.stringify([projectId, workflowId])) ?? null,
    );
  }
  async save(
    projectId: string,
    workflow: Workflow,
    expectedRevision: number | null,
  ): Promise<StoredWorkflow> {
    const key = JSON.stringify([projectId, workflow.id]);
    const current = this.entries.get(key);
    if ((current?.revision ?? null) !== expectedRevision)
      throw new Error("Revision conflict");
    const saved = structuredClone({
      projectId,
      workflow,
      revision: (current?.revision ?? 0) + 1,
    });
    this.entries.set(key, saved);
    return structuredClone(saved);
  }
}
export class FakeWorkflowGenerator implements WorkflowGenerator {
  constructor(private readonly output: unknown) {}
  async generate(_project: Project, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    return structuredClone(this.output);
  }
}

export class FakeSession implements ExecutionSession {
  readonly commands: Command[] = [];
  closed = false;
  constructor(
    private readonly results: Readonly<Record<string, StepResult>> = {},
  ) {}
  async execute(command: Command, signal: AbortSignal): Promise<StepResult> {
    signal.throwIfAborted();
    if (this.closed) throw new Error("Session is closed");
    this.commands.push(structuredClone(command));
    return (
      this.results[command.stepId] ?? {
        stepId: command.stepId,
        status: "passed",
      }
    );
  }
  async evidence(): Promise<readonly Evidence[]> {
    return [];
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}
export class FakeSessionFactory implements SessionFactory {
  readonly sessions: FakeSession[] = [];
  constructor(
    private readonly results: Readonly<Record<string, StepResult>> = {},
  ) {}
  async open(
    _options: SessionOptions,
    signal: AbortSignal,
  ): Promise<ExecutionSession> {
    signal.throwIfAborted();
    const session = new FakeSession(this.results);
    this.sessions.push(session);
    return session;
  }
}
export class FakeEvaluator implements QaEvaluator {
  constructor(
    private readonly result: Evaluation = {
      status: "blocked",
      findings: [],
      reason: "Provide a scenario-specific fake result",
    },
  ) {}
  async evaluate(
    _input: Parameters<QaEvaluator["evaluate"]>[0],
    signal: AbortSignal,
  ): Promise<Evaluation> {
    signal.throwIfAborted();
    return structuredClone(this.result);
  }
}
