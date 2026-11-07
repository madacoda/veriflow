import type { SessionFactory } from "@veriflow/core";

/** Explicit development fixture only. No browser, network activity or fabricated media. */
export function createFakeSessionFactory(
  outcome: "passed" | "failed",
): SessionFactory {
  return {
    open: async (_options, signal) => {
      signal.throwIfAborted();
      let closed = false;
      return {
        execute: async (command, commandSignal) => {
          commandSignal.throwIfAborted();
          if (closed) throw new Error("Fixture session is closed");
          return command.action === "assert" && outcome === "failed"
            ? {
                stepId: command.stepId,
                status: "failed",
                failureKind: "assertion",
                reason:
                  "Configured fake assertion failure; no browser was used",
                expected: String(command.expectation.value),
                actual: "Fake mismatched value",
              }
            : {
                stepId: command.stepId,
                status: "passed",
                actual: "Configured fake success; no browser was used",
              };
        },
        evidence: async () => [],
        close: async () => {
          closed = true;
        },
      };
    },
  };
}
