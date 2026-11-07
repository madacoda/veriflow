# security

Security QA scenarios for target applications, including authorization and input validation.

Owned by the developer working on `feat/security`.

- `domain` holds entities, value objects and domain policies.
- `application` holds use cases and the narrow ports those use cases need.
- `infrastructure` implements ports using persistence, AI or browser tools.
- `presentation` adapts HTTP requests and responses to use cases.

The `index.ts` public entry point exports createEvaluation. Inject your evaluator from a thin Next.js route or composition function. Keep infrastructure out of domain and application imports. Coordinate cross-module contracts through a separate reviewed change.
