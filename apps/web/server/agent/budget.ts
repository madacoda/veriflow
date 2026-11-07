import { AgentError, checkCancellation } from "./errors.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;

/** Deadline includes provider waits and tools, even if an adapter ignores abort. */
export async function withBudget<T>(
  parent: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    throw new AgentError("validation_error");
  checkCancellation(parent);
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(
      parent.reason instanceof AgentError
        ? parent.reason
        : new AgentError("cancelled"),
    );
  parent.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new AgentError("timeout")),
    timeoutMs,
  );
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        checkCancellation(controller.signal);
        const result = await operation(controller.signal);
        checkCancellation(controller.signal);
        return result;
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
