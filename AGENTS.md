# Team task boundaries

Read docs/developer-handoff.md before making changes. It is the authoritative full-MVP allocation with a seven-hour demonstration milestone.
Read REVIEW.md for task ownership, isolated checkouts and the serial merge protocol. Dev 1 is the sole lead orchestrator and assigns tasks to all four developers, including their own integration work. Only the lead merges after review and verification.

- Dev 1 owns integration, core contract changes, shared configuration and deployment.
- Dev 2 owns AI generation, template definitions, context extraction and the bounded agent loop.
- Dev 3 owns browser execution and evidence capture.
- Dev 4 owns product UI, report rendering and the seeded demo. Dev 1 owns report HTTP/storage adapters.
- Each task must include acceptance criteria and verification evidence.
- Keep the existing Next.js monolith and Bun setup unless the team explicitly changes that decision.
- Preserve existing workflow compatibility when extending step types.
- Validate model tool arguments before execution. Browser assertions determine outcomes.
- Do not log credentials or embed them in workflows or evidence.
- Use fake adapters for independent tests and identify them clearly.
- Prioritize the known-pass/known-fail vertical slice by 14:00 WIB.
- After that gate, focus on reliability, review, recordings and judging preparation.
- Coordinate changes to shared contracts with the integration owner.
