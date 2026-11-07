# Versioned template catalog

Owner: Dev 2. Reviewer: Dev 3. Dev 1 owns shared contracts, composition and merging.

`listTemplates()` returns independent snapshots of six `TemplateDefinition` values under the existing v1 contract. `resolveTemplates(ids)` preserves selection order, deduplicates IDs and rejects unknown entries with fixed `AgentError("template_unavailable")`. The shared `functional-exact-total@1.0.0` definition and workflow fixture remain unchanged.

| ID at version 1.0.0         | Category                        | Required capabilities                                 | Inputs and generation availability                                                                                                                                                      |
| --------------------------- | ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `functional-exact-total`    | Functional                      | navigate, fill, click, assert, screenshot             | Shared SAVE10 checkout fixture prerequisites. Draft generation supported.                                                                                                               |
| `responsive-layout`         | Responsive                      | navigate, viewport, assert, screenshot                | 2–8 bounded viewport sizes and 1–20 exact test IDs. Generation unavailable until shared steps can express viewport and layout checks.                                                   |
| `security-passive-baseline` | Basic security                  | navigate, security                                    | Selected HTTPS, Content-Security-Policy or X-Content-Type-Options checks on authorized origins. Generation unavailable until shared steps represent these checks. No attack payloads.   |
| `requirements-acceptance`   | Supplied-requirement compliance | navigate, fill, click, setChecked, assert, screenshot | At least one nonblank text source through request attachment IDs and matching context documents. Draft generation supported with at least one browser assertion and a coverage warning. |
| `accessibility-page-audit`  | Accessibility                   | navigate, accessibility, screenshot                   | Selected rule tags and an accessibility adapter such as axe. Generation unavailable until shared steps represent audits.                                                                |
| `regression-saved-revision` | Regression                      | navigate, fill, click, setChecked, assert, screenshot | Project-owned saved workflow ID and positive revision. Draft generation unavailable; use the coordinator's existing pinned-revision execution path.                                     |

Definitions describe prerequisites; they do not advertise installed executors or completed checks. Missing execution capabilities must produce blocked results in the coordinator/executor. Browser observations determine outcomes. Definition and parameter examples are not evidence of viewport, security or accessibility execution.

## Generation and parameters

The existing `generationRequestSchema` accepts template IDs and attachment IDs, but has no template parameter bindings or saved-revision loading contract. Parameter schemas describe bounded inputs for future integration; this module does not accept or execute them. Dev 1 must define any shared binding/step changes with affected consumers, and Dev 3 supplies and verifies the executors. No dependency or shared schema is introduced here.

`prepareGenerationInput` uses `resolveGenerationTemplates` to reject unsupported categories before provider dispatch. A mixed selection containing any unavailable category rejects as a whole. The direct OpenAI provider shares this input validation, so caller-supplied template metadata cannot bypass the catalog. Errors expose only the existing fixed `template_unavailable` code/message; the definitions supply prerequisite details for consumers. Image context remains explicitly unsupported by generation.

Requirement-based drafts use the existing text extraction/context path. Requested sources must match context exactly. At least one nonblank text document is required, and output without a browser assertion rejects as `invalid_provider_output`. The generator adds trusted source IDs, provider provenance and a warning to check coverage against supplied requirements. These structural checks cannot establish that every requirement is covered; a reviewer must inspect the editable draft before saving. They do not establish legal, regulatory or accessibility certification. Generation never saves or overwrites workflows.

Regression means rerunning the exact reviewed revision with new run/evidence records. The coordinator loads and pins the revision and checks capabilities of its actual steps. The definition lists the current workflow language's capability envelope; it does not load storage, regenerate a replacement workflow or manage session lifetime.

## Fixtures and versioning

`functionalTemplateFixture()` preserves the original shared functional fixture. `templateDefinitionFixtures()` supplies independent examples for all six definitions, labeled `provider: fixture` with an explicit no-execution warning. Only functional and supplied-requirement examples contain workflows. Regression references a saved fixture revision. Unsupported categories have parameter examples only, never fabricated executable workflows or outcomes.

Each catalog ID resolves to one current version. This v1 generation request cannot select a historical version. Keep published meanings stable; review version changes with Dev 1 and affected consumers, and require a shared version-selection/persistence contract before offering multiple versions under one ID. Existing saved workflow revisions remain the execution source of truth.

Credential-free verification covers the catalog contract, shared-fixture compatibility, defensive copies, explicit fixture labeling, unavailable-category rejection before provider/HTTP dispatch, missing source prerequisites and assertion-free requirement output. Run the full gate in `REVIEW.md` before review.
