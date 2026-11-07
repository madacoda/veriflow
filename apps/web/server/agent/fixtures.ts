import {
  translateWorkflow,
  type AgentToolPort,
  type BrowserObservation,
  type Command,
} from "@veriflow/core";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import type { DraftProvider } from "./generate.ts";
import type { SummaryProvider } from "./summary.ts";
import { checkCancellation } from "./errors.ts";

/** Deterministic hypothesis fixture, not a real model or observed root cause. */
export function createFixtureSummaryProvider(
  output: unknown = {
    analyses: [
      {
        stepIds: ["total"],
        evidenceIds: [],
        hypothesis: "The coupon discount may not have been applied.",
        nextCheck: "Inspect the calculation triggered by the coupon action.",
      },
    ],
  },
): SummaryProvider {
  return {
    kind: "fixture",
    async summarize(_input, signal) {
      checkCancellation(signal);
      return structuredClone(output);
    },
  };
}

/** Explicit opt-in fixture; production composition must inject a model provider. */
export function createFixtureProvider(
  output: unknown = demoWorkflow,
): DraftProvider {
  return {
    kind: "fixture",
    async generate(_input, signal) {
      checkCancellation(signal);
      return structuredClone(output);
    },
  };
}

/** No browser or capture is started. Assertions emulate only the shared fixture. */
export function createFixtureTools(actualTotal = "90000"): {
  port: AgentToolPort;
  commands: Command[];
} {
  const commands: Command[] = [];
  const observation: BrowserObservation = {
    url: demoProject.url,
    title: "Deterministic tool fixture",
    text: "Fixture checkout total: " + actualTotal,
    truncated: false,
    targets: [{ by: "testId", value: "order-total" }],
  };
  return {
    commands,
    port: {
      async observe(maxCharacters, signal) {
        checkCancellation(signal);
        return {
          ...structuredClone(observation),
          text: observation.text.slice(0, maxCharacters),
          truncated: observation.text.length > maxCharacters,
        };
      },
      async execute(command, signal) {
        checkCancellation(signal);
        commands.push(structuredClone(command));
        const known = translateWorkflow(demoWorkflow).commands.find(
          (item) => item.stepId === command.stepId,
        );
        if (!known || JSON.stringify(known) !== JSON.stringify(command))
          return {
            stepId: command.stepId,
            status: "blocked",
            failureKind: "prerequisite",
            reason: "This fixture supports only the shared functional workflow",
          };
        if (command.action !== "assert")
          return { stepId: command.stepId, status: "passed" };
        const expected = String(command.expectation.value);
        return expected === actualTotal
          ? {
              stepId: command.stepId,
              status: "passed",
              expected,
              actual: actualTotal,
            }
          : {
              stepId: command.stepId,
              status: "failed",
              failureKind: "assertion",
              expected,
              actual: actualTotal,
              reason: "Fixture total did not match",
            };
      },
    },
  };
}
