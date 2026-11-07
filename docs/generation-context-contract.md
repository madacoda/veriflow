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
