const messages = {
  adapter_unavailable: "A generation provider is not configured",
  validation_error: "Generation input or execution limits are invalid",
  invalid_provider_output: "The provider returned an invalid workflow draft",
  provider_failed: "The provider request failed",
  invalid_tool_call: "The requested browser tool or its arguments are invalid",
  call_limit_exceeded: "The browser tool call limit was reached",
  cancelled: "The operation was cancelled",
  timeout: "The operation exceeded its time limit",
  tool_failed: "The browser tool failed or returned an invalid result",
  unsupported_format: "This attachment format or image input is not supported",
  extraction_failed: "The attachment could not be extracted safely",
  context_mismatch: "Attachment context does not match the requested sources",
  attachment_unavailable: "The requested attachment is unavailable",
  template_unavailable: "The requested template is unavailable",
} as const;

/** Only fixed messages cross the server boundary; never expose adapter errors. */
export class AgentError extends Error {
  constructor(public readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "AgentError";
  }
}

export function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof AgentError
      ? signal.reason
      : new AgentError("cancelled");
  }
}
