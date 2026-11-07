# G1: grounded workflow generation

Frozen with Dev 1 before consumer implementation. Ship the schema, runner and editor support together: accepting role targets while treating them as test IDs is not a valid intermediate release.

## Compatible workflow targets

Keep workflow version `1` and existing `label` / `testId` targets. Add `{ by: "role", role, value }`, where `value` is a nonempty bounded exact accessible name. Support the finite roles button, link, textbox, checkbox, radio, combobox, option, heading, tab, menuitem, switch and status. Execution must find exactly one visible matching element; ambiguity is a blocked prerequisite, never a first/nth selection. Preserve role/name through editing, saving, provider schemas and execution.

## Browser observations and inspection

`BrowserObservation.targets` becomes `readonly Target[]`. Optional metadata preserves legacy fake adapters: `scope` (main/dialog/body), bounded same-origin links, navigation HTTP status and capture time. Limit text to 20,000 characters, targets to 50 and links to 20. Names/labels are bounded; only exact verified targets may be supplied as usable locators. Existing URL and secret redaction applies before data reaches a provider or public response.

`PageInspection` discriminates observed and unavailable results. Both identify the requested source URL and capture time. Observed results include browser provenance, scope, text, targets, links and truncation. Unavailable results contain a fixed safe reason code, never an adapter exception. Access signals describe short scoped observations such as a sign-in prompt; they are not authorization verdicts. A shared sidebar login link or HTTP 200 cannot establish whether the main workflow is accessible. Expected guard checks and unmet login prerequisites are distinct.

The existing session factory accepts optional `purpose: "run" | "inspection"`, defaulting to run. Inspection permits navigation and observation only; it cannot fill secrets, click, submit or create artifact directories/files. It uses the same origin policy and browser admission budget as runs, with guaranteed cleanup on failure/cancellation. A generation request cannot bypass the production concurrency limit. One overall deadline covers admission, inspection, source extraction and model generation.

## Generation and regeneration

Generation defaults to inspecting the project URL. Optional explicit `pageUrls` add same-project-origin pages, with at most five distinct pages in total. No autonomous crawl. Invalid/off-origin input and cancellation prevent model dispatch; ordinary unavailable pages remain visible as uninspected context. Model input gains optional read-only page context; legacy fixture calls remain valid and must not claim browser inspection.

Optional `baseWorkflow` is a validated, bounded regeneration input. Enforce workflow schema and origin policy and treat all strings as untrusted data. The model returns a new unsaved draft; it never overwrites the source or silently removes its assertions. Saving still requires explicit review and the existing revision check. Inspection, model proposals and browser assertion outcomes must remain distinguishable in user-facing copy.

Passwords, secret values, cookies, session storage and private artifact paths must not enter prompts, diagnostics or inspection evidence. Authentication-dependent functionality without authenticated context must explain the missing prerequisite; observing a guard does not establish full functionality or secure authorization.

## Frozen acceptance fixtures

`packages/runner/unit/generation-context-target.ts` is an explicitly synthetic HTTP target, not a model or production-site claim.

| Fixture / check             | Required behavior                                                          |
| --------------------------- | -------------------------------------------------------------------------- |
| `/unique`                   | Exact role/name button can execute; label/testId compatibility remains.    |
| `/ambiguous`                | Two identical button names block; neither button is clicked.               |
| `/guarded`                  | Main account-required message is a scoped sign-in observation.             |
| `/public`                   | Sidebar login text does not classify the public Arena content as blocked.  |
| `/dialog`                   | Visible password dialog is distinguished from shared navigation text.      |
| `/unavailable`              | HTTP failure is uninspected context, not invented controls.                |
| `/slow`, off-origin URL     | Cancellation/validation prevents provider dispatch and releases admission. |
| concurrent run + inspection | Shared admission limit is enforced and released on all terminal paths.     |
| inspection purpose          | Mutations are rejected; no evidence files/directories are created.         |
| provider/editor round trip  | Exact role/name survives schema, review, save and execution.               |
| regeneration                | Input remains immutable; assertions retained; output stays unsaved.        |

Output format preferences, XLSX/PDF renderers and video capture are separate follow-ups.

## Intent and password-field clarification

The lead additionally approved `authentication`, labelled “Test the sign-in form”. It requires an observed password form and allows drafting form checks, not assuming an authenticated session. Input steps use reviewed `fillSecret` references rather than literal credentials; every binding must be configured before execution. An account-required notice without a form remains an unmet prerequisite for this mode.

`accessMode` is optional and defaults behaviorally to `functionality`. `guard` is an explicit user selection labelled “Check access restrictions”. It never decides an outcome: a guard observation cannot count as protected-feature success, and no observed guard cannot silently become a functionality pass. Functionality generation with an observed access prerequisite stops with actionable copy; unavailable inspection stops without inventing targets.

Optional `passwordFieldVisible` describes visible password inputs only within the chosen scope. Values are never read. Absence means not inspected; false does not establish that authentication is unnecessary. Credentials and secret bindings are outside observation DTOs.

## Verification and current limits

The opt-in `apps/web/tests/agent-grounded-live.test.ts` uses the configured real OpenAI provider and a synthetic local target. It inspects the target, generates and regenerates a draft, executes a known-pass run with PNG evidence, then proves a deliberately wrong expectation fails as an assertion. Run it with `VERIFLOW_VERIFY_OPENAI=1`; it is skipped in ordinary CI and never prints provider credentials. This is fixture evidence, not proof that an arbitrary external site works.

Browser and UI fixtures verify exact role/name targets, duplicate-target rejection, main/dialog scoping, zero inspection artifacts, shared admission, cancellation, preservation of unsaved edits and explicit replacement. Regeneration allocates a new workflow identity and keeps existing assertion steps unchanged.

A page snapshot cannot discover controls behind interactions, authenticate a session, cover all role permissions or establish security/compliance certification. Additional pages must be supplied explicitly. Existing origin and network restrictions remain enforced; a rejected dependency is not a failed functional assertion. On 7 November 2026, read-only inspection of the supplied Pixelogic Battle/Arena/Shop URLs was rejected by the existing browser policy. No game credentials or mutating actions were used. The UI must report these as uninspected and must not fabricate controls.

The existing generator template picker still supports the exact-total and supplied-requirement definitions. Other supported step types can be requested in the objective and reviewed in the editor, but the broader executable template catalog has separate parameter bindings. Dropdown selection, file upload, popups and iframe workflows are not implemented by this change. Report formats and recording preferences remain independent from mandatory browser assertions.
