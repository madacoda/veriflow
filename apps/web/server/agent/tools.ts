import {
  browserToolCallSchema,
  browserObservationSchema,
  targetSchema,
  httpUrlSchema,
  translateWorkflow,
  type AgentToolPort,
  type BrowserObservation,
  type BrowserToolCall,
  type StepResult,
} from "@veriflow/core";
import { DEFAULT_TIMEOUT_MS, withBudget } from "./budget.ts";
import { AgentError } from "./errors.ts";
import { canContinueAfter, observedResult } from "./results.ts";

export const DEFAULT_MAX_CALLS = 12;
export const MAX_CALLS = 100;

export type ToolRecord =
  | {
      call: Extract<BrowserToolCall, { tool: "observe" }>;
      observation: BrowserObservation;
    }
  | { call: Extract<BrowserToolCall, { tool: "execute" }>; result: StepResult };

/** A provider chooses a tool or stops; it cannot supply an outcome. */
export type NextAgentTurn = (
  history: readonly ToolRecord[],
  signal: AbortSignal,
) => Promise<unknown>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedObservation(
  value: unknown,
  maxCharacters: number,
): BrowserObservation {
  if (
    !object(value) ||
    // New browser sessions expose about:blank before their first navigation.
    (value.url !== "about:blank" &&
      !httpUrlSchema.safeParse(value.url).success) ||
    typeof value.url !== "string" ||
    value.url.length > 4096 ||
    typeof value.title !== "string" ||
    typeof value.text !== "string" ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.targets) ||
    !value.targets.every(
      (target: unknown) =>
        object(target) &&
        targetSchema.safeParse(target).success &&
        typeof target.value === "string" &&
        target.value.length > 0 &&
        target.value.length <= 1000,
    )
  )
    throw new AgentError("tool_failed");
  const observation = browserObservationSchema.safeParse({
    url: value.url,
    title: value.title.slice(0, 512),
    text: value.text.slice(0, maxCharacters),
    truncated:
      value.truncated ||
      value.text.length > maxCharacters ||
      value.title.length > 512 ||
      value.targets.length > 50,
    targets: value.targets
      .slice(0, 50)
      .map((target: unknown) => targetSchema.parse(target)),
    scope: value.scope,
    links: value.links,
    navigationStatus: value.navigationStatus,
    capturedAt: value.capturedAt,
  });
  if (!observation.success) throw new AgentError("tool_failed");
  return observation.data;
}

/** The coordinator supplies its session port and retains all finalization duties. */
export async function runAgentLoop(
  input: {
    next: NextAgentTurn;
    tools: AgentToolPort;
    maxCalls?: number;
    timeoutMs?: number;
  },
  signal: AbortSignal,
): Promise<{ history: ToolRecord[]; steps: StepResult[] }> {
  const maxCalls = input.maxCalls ?? DEFAULT_MAX_CALLS;
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > MAX_CALLS)
    throw new AgentError("validation_error");
  return withBudget(
    signal,
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    async (boundedSignal, checkActive) => {
      const history: ToolRecord[] = [];
      const steps: StepResult[] = [];
      const stepIds = new Set<string>();
      while (true) {
        checkActive();
        let turn: unknown;
        try {
          turn = await input.next(structuredClone(history), boundedSignal);
        } catch {
          checkActive();
          throw new AgentError("provider_failed");
        }
        checkActive();
        if (
          object(turn) &&
          turn.kind === "done" &&
          Object.keys(turn).length === 1
        )
          return { history, steps };
        if (
          !object(turn) ||
          turn.kind !== "tool" ||
          Object.keys(turn).length !== 2 ||
          !("call" in turn)
        )
          throw new AgentError("invalid_tool_call");
        const parsed = browserToolCallSchema.safeParse(turn.call);
        if (!parsed.success) throw new AgentError("invalid_tool_call");
        if (history.length >= maxCalls)
          throw new AgentError("call_limit_exceeded");
        const call = parsed.data;
        if (
          call.tool === "execute" &&
          (stepIds.has(call.step.id) ||
            (call.step.code === "redirect" &&
              !httpUrlSchema.safeParse(call.step.url).success))
        )
          throw new AgentError("invalid_tool_call");
        try {
          checkActive();
          if (call.tool === "observe") {
            const raw = await input.tools.observe(
              call.maxCharacters,
              boundedSignal,
            );
            checkActive();
            history.push({
              call,
              observation: boundedObservation(raw, call.maxCharacters),
            });
          } else {
            const command = translateWorkflow({
              schemaVersion: "1",
              id: "agent-tools",
              name: "Agent tools",
              steps: [call.step],
            }).commands[0];
            const raw = await withBudget(
              boundedSignal,
              command.timeoutMs,
              (stepSignal) => input.tools.execute(command, stepSignal),
            );
            checkActive();
            const result = observedResult(raw, call.step.id);
            stepIds.add(call.step.id);
            steps.push(result);
            history.push({ call, result });
            // Independent checks retain failures while allowing later coverage.
            // Duplicate IDs and the reviewed provider still prohibit retries.
            if (!canContinueAfter(call.step, result)) return { history, steps };
          }
        } catch (error) {
          checkActive();
          if (error instanceof AgentError) throw error;
          throw new AgentError("tool_failed");
        }
      }
    },
  );
}
