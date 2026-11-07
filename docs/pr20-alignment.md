# PR 20 alignment review

Reviewed [PR #20](https://github.com/madacoda/veriflow/pull/20) at `8e35b67` against the local generation HTTP integration `e476a51` and remote main `750ad35`. Work is prepared locally on `codex/pr20-alignment`; the GitHub PR remains unchanged and draft.

## Findings and corrections

1. **Generation choices did not match server support.** The global catalog includes 15 definitions, while generation accepts only `functional-exact-total` and `requirements-acceptance`. The additive `generationTemplateIds` response field is derived from the same policy used for server validation. The UI filters its generation selector using that field. The nine deterministic parameter-bound templates remain available separately across all six categories.
2. **Draft source validation allowed inconsistent provenance.** The server either assembles all requested attachments or rejects the request, and returns deduplicated requested source IDs. The client now rejects missing, extra or duplicate source references. The mocked success test now follows this contract instead of silently omitting an attachment.
3. **Requirement generation rejected the native requirement step.** The existing output guard accepted only `assert`, even though current workflows also support `assertRequirement`. Both now satisfy the assertion prerequisite; text-context and allowed-origin checks are preserved. This is covered with an explicitly labeled fixture provider.

The PR's separate preview/open/save actions, preservation of edits on errors, request cancellation on project unmount, and separate fixture mode remain intact. Its shadcn/Tailwind setup is included. Current main's browser-test loading and external axe fixes, failure-summary module, and the local Webpack dev-server fix are retained. No runtime provider is silently enabled and no live model call is claimed.

## Acceptance and evidence

- Frozen Bun install, lint, formatting, type checks and production build passed.
- 246 unit tests passed; the two opt-in live OpenAI checks were skipped.
- All 51 Chromium tests passed with isolated storage on port 1122. This includes existing six-category execution, exact known-fail/known-pass browser outcomes, evidence ownership and report downloads.
- The new real-route UI test verifies the 15-entry catalog, two supported generation choices, attachment submission, explicit unconfigured-provider 503, unchanged unsaved input, and no saved workflow or run.
- The same panel passed automated axe WCAG checks and viewport checks at 1440, 768 and 390 pixels. The mobile screenshot is captured by `dashboard-draft-reports.spec.ts`.
- Mock HTTP checks are explicitly separate from real HTTP checks and cover malformed drafts, mismatched source references, recovery and explicit editor replacement without saving.

The final `bun run test:dev` check passed after restart: two browser tabs retained unsaved form state for 30 seconds after catalog/API requests, with no reloads or runtime errors. Production still needs trusted generation-provider configuration. The AI session bridge and report-summary composition remain separate integrations.
