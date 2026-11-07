const messages = {
  authentication_required:
    "A selected page shows an access prerequisite in its main content or dialog. Functionality has not been tested. Configure a reviewed sign-in workflow using secret references, or choose Check access restrictions to test the guard itself.",
  inspection_unavailable:
    "A selected page could not be inspected safely. Check its URL and permitted origins, then retry. No workflow targets were invented.",
  guard_not_observed:
    "No access restriction was observed in the selected page content. This does not prove the page is public. Supply an explicit guard expectation before testing access restrictions.",
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
  summary_unavailable:
    "A failure summary requires a finalized failed, blocked, errored or cancelled run",
  invalid_summary_input:
    "The report snapshot is invalid or exceeds summary limits",
  invalid_summary_output: "The provider returned an invalid failure summary",
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
